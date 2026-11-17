import { eq } from 'drizzle-orm';
import { InterventionSchedule, ScheduleAdherence } from '@salud/shared/types';
import { interventions } from '../../db/schema';
import { normalizeTs } from '../persistence/time';

// The read model of an `intervention_schedules` row — the mapping and the computed adherence —
// as plain functions over a db handle rather than SchedulesService methods. The episode read
// (GET /api/episodes/:id) returns its schedules in this same shape, and EpisodesModule cannot
// import SchedulesModule: schedules → interventions → episodes is already a dependency chain.

/**
 * The next `HH:MM` slot of `times` at-or-after `from` (or strictly after, when advancing past a
 * just-logged dose). Slots are read on the server's clock, not the household's — a known gap; the
 * episode page computes its per-day expectations in the browser's local time instead.
 */
export function nextExplicitTime(times: string[], from: Date, strictlyAfter: boolean): Date {
  const sorted = [...times].sort();
  const fromMs = from.getTime();
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    for (const t of sorted) {
      const [h, m] = t.split(':').map(Number);
      const candidate = new Date(from);
      candidate.setDate(from.getDate() + dayOffset);
      candidate.setHours(h, m, 0, 0);
      const ok = strictlyAfter ? candidate.getTime() > fromMs : candidate.getTime() >= fromMs;
      if (ok) return candidate;
    }
  }
  // Unreachable with valid HH:MM input; fail safe rather than throw mid-schedule-math.
  return new Date(fromMs + 24 * 60 * 60 * 1000);
}

/**
 * How many occurrences were due by `now` — counted from `startAt` and **capped at the course's
 * end** (data-model.md → ScheduleAdherence): no slot after `endAt` counts, and never more than
 * `endAfterOccurrences`. Without the cap a finished course kept accruing "missed" doses forever.
 */
export function expectedOccurrences(row: any, now: Date = new Date()): number {
  // Whole seconds throughout, the API's own resolution — Postgres keeps milliseconds on one
  // column and not another, and a sub-second gap must not drop the slot that sits exactly on endAt.
  const startSec = normalizeTs(row.startAt)!;
  const endAtSec = normalizeTs(row.endAt);
  const limitSec = Math.min(Math.floor(now.getTime() / 1000), endAtSec ?? Infinity);
  const cap = row.endAfterOccurrences != null ? row.endAfterOccurrences : Infinity;
  let expected = 0;
  if (limitSec >= startSec) {
    if (row.frequencyHours) {
      expected = Math.floor((limitSec - startSec) / (row.frequencyHours * 3600)) + 1;
    } else if (row.explicitTimes) {
      const times: string[] = typeof row.explicitTimes === 'string' ? JSON.parse(row.explicitTimes) : row.explicitTimes;
      let cursor = nextExplicitTime(times, new Date(startSec * 1000), false);
      while (cursor.getTime() <= limitSec * 1000 && expected < cap && expected < 2000) {
        expected++;
        cursor = nextExplicitTime(times, cursor, true);
      }
    }
  }
  return Math.min(expected, cap);
}

export async function scheduleLoggedCount(db: any, scheduleId: string): Promise<number> {
  const rows = await db.select().from(interventions).where(eq(interventions.scheduleId, scheduleId));
  return rows.length;
}

export async function computeScheduleAdherence(db: any, row: any): Promise<ScheduleAdherence> {
  const loggedCount = await scheduleLoggedCount(db, row.id);
  const expectedCount = expectedOccurrences(row);
  const remainingOccurrences =
    row.endAfterOccurrences != null ? Math.max(0, row.endAfterOccurrences - loggedCount) : null;
  const nextDueTs = normalizeTs(row.nextDueAt);
  const overdue = row.status === 'active' && nextDueTs != null && nextDueTs < Math.floor(Date.now() / 1000);
  return {
    expectedCount,
    loggedCount,
    missed: Math.max(0, expectedCount - loggedCount),
    remainingOccurrences,
    overdue,
  };
}

export async function toScheduleView(db: any, row: any): Promise<InterventionSchedule> {
  return {
    id: row.id,
    patientId: row.patientId,
    type: row.type,
    medicationId: row.medicationId ?? null,
    medicationEmbodimentId: row.medicationEmbodimentId ?? null,
    episodeId: row.episodeId ?? null,
    conditionId: row.conditionId ?? null,
    label: row.label,
    doseMg: row.doseMg ?? null,
    doseMl: row.doseMl ?? null,
    pillCount: row.pillCount ?? null,
    bodyLocation: row.bodyLocation ?? null,
    side: row.side ?? null,
    dressingType: row.dressingType ?? null,
    frequencyHours: row.frequencyHours ?? null,
    explicitTimes: row.explicitTimes ? JSON.parse(row.explicitTimes) : null,
    startAt: normalizeTs(row.startAt)!,
    endAfterOccurrences: row.endAfterOccurrences ?? null,
    endAt: normalizeTs(row.endAt),
    notes: row.notes ?? null,
    status: row.status,
    nextDueAt: normalizeTs(row.nextDueAt),
    createdByUserId: row.createdByUserId,
    createdAt: normalizeTs(row.createdAt)!,
    updatedAt: normalizeTs(row.updatedAt)!,
    adherence: await computeScheduleAdherence(db, row),
  };
}
