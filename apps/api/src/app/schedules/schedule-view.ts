import { eq } from 'drizzle-orm';
import { InterventionSchedule } from '@salud/shared/types';
import { scheduleStateFor } from './schedule-state';
import { interventions } from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { serverTimeZone, zonedDate, zonedWallTimeToInstant } from './zoned-time';

// The read model of an `intervention_schedules` row — the mapping and the computed adherence —
// as plain functions over a db handle rather than SchedulesService methods. The episode read
// (GET /api/episodes/:id) returns its schedules in this same shape, and EpisodesModule cannot
// import SchedulesModule: schedules → interventions → episodes is already a dependency chain.

/**
 * The next `HH:MM` slot of `times` at-or-after `from` (or strictly after, when advancing past a
 * just-logged dose). Slots are wall-clock times in `timeZone`, the schedule's own zone
 * (data-model.md → InterventionSchedule.timeZone) — never the API server's clock, which is UTC on
 * the cluster. `null` (a row that predates the column) falls back to the server's zone.
 */
export function nextExplicitTime(times: string[], from: Date, strictlyAfter: boolean, timeZone: string | null): Date {
  const zone = timeZone ?? serverTimeZone();
  const sorted = [...times].sort();
  const fromMs = from.getTime();
  const start = zonedDate(fromMs, zone);
  // Walk calendar days in the schedule's zone, starting on `from`'s own local date: no slot on an
  // earlier local date can fall at or after `from`.
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + dayOffset));
    for (const t of sorted) {
      const [h, m] = t.split(':').map(Number);
      const candidateMs = zonedWallTimeToInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m, zone);
      const ok = strictlyAfter ? candidateMs > fromMs : candidateMs >= fromMs;
      if (ok) return new Date(candidateMs);
    }
  }
  // Unreachable with valid HH:MM input; fail safe rather than throw mid-schedule-math.
  return new Date(fromMs + 24 * 60 * 60 * 1000);
}

export async function scheduleLoggedCount(db: any, scheduleId: string): Promise<number> {
  const rows = await db.select().from(interventions).where(eq(interventions.scheduleId, scheduleId));
  return rows.length;
}

export async function toScheduleView(db: any, row: any): Promise<InterventionSchedule> {
  const state = await scheduleStateFor(db, row);
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
    timeZone: row.timeZone ?? null,
    missedDoseAction: row.missedDoseAction ?? null,
    missedDoseCutoffHours: row.missedDoseCutoffHours ?? null,
    missedDoseCourseEffect: row.missedDoseCourseEffect ?? null,
    missedDoseNote: row.missedDoseNote ?? null,
    missedDose: state.missedDose,
    startAt: normalizeTs(row.startAt)!,
    endAfterOccurrences: row.endAfterOccurrences ?? null,
    endAt: normalizeTs(row.endAt),
    notes: row.notes ?? null,
    status: row.status,
    // From the computed state, which is what the stored column is persisted from on every write.
    nextDueAt: state.nextDueAt,
    createdByUserId: row.createdByUserId,
    createdAt: normalizeTs(row.createdAt)!,
    updatedAt: normalizeTs(row.updatedAt)!,
    adherence: {
      expectedCount: state.expectedCount,
      loggedCount: state.loggedCount,
      skippedCount: state.skippedCount,
      missed: state.missed,
      remainingOccurrences: state.remainingOccurrences,
      overdue: state.overdue,
    },
  };
}
