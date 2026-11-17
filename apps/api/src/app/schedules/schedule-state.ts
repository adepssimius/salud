import { eq } from 'drizzle-orm';
import { MissedDoseAction, MissedDoseCourseEffect, MissedDoseState } from '@salud/shared/types';
import { interventionSchedules, interventions, scheduleSkips } from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { nextExplicitTime } from './schedule-view';

// A schedule's live state — next due, completion, adherence counts and the current missed dose —
// computed in one place from its timing, its instruction, its doses and its skips (data-model.md →
// InterventionSchedule → "Missed-dose instruction"; api.md → Intervention schedules → "Missed
// doses"). Every write that can move it (create, PATCH, log, link, skip, a dose filed against the
// schedule from the dose form) persists `nextDueAt`/`status` through `persistScheduleState`.
//
// Plain functions over a db handle, like schedule-view.ts: InterventionsService needs them too,
// and InterventionsModule cannot import SchedulesModule (schedules → interventions already).
//
// Two ways the next dose follows the doses given:
//   - **restart** — no instruction, or "take late and restart the clock": the next dose is one
//     interval after the last dose (or the next fixed time after it). Exactly the behaviour every
//     schedule had before instructions existed.
//   - **grid** — every other instruction: the plan's own slots are consumed in order, one per dose
//     given or slot skipped, so a late dose covers the slot it was late for and the times stay put.

const HOUR = 3600;
const MAX_SLOTS = 5000;

export interface ScheduleTiming {
  startAt: number; // epoch seconds
  frequencyHours: number | null;
  explicitTimes: string[] | null;
  timeZone: string | null;
  endAt: number | null;
  endAfterOccurrences: number | null;
  status: 'active' | 'paused' | 'completed';
  action: MissedDoseAction | null;
  cutoffHours: number | null;
  courseEffect: MissedDoseCourseEffect | null;
}

export interface ScheduleState {
  nextDueAt: number | null;
  /** The course is over: every dose given, or past its (effective) end. */
  completed: boolean;
  expectedCount: number;
  loggedCount: number;
  skippedCount: number;
  missed: number;
  remainingOccurrences: number | null;
  overdue: boolean;
  /** When the last planned dose falls; null when open-ended or nothing is next (data-model.md). */
  courseEndsAt: number | null;
  missedDose: MissedDoseState | null;
}

export function timingFromRow(row: any): ScheduleTiming {
  return {
    startAt: normalizeTs(row.startAt)!,
    frequencyHours: row.frequencyHours ?? null,
    explicitTimes: row.explicitTimes ? (typeof row.explicitTimes === 'string' ? JSON.parse(row.explicitTimes) : row.explicitTimes) : null,
    timeZone: row.timeZone ?? null,
    endAt: normalizeTs(row.endAt),
    endAfterOccurrences: row.endAfterOccurrences ?? null,
    status: row.status,
    action: row.missedDoseAction ?? null,
    cutoffHours: row.missedDoseCutoffHours ?? null,
    courseEffect: row.missedDoseCourseEffect ?? null,
  };
}

const isGrid = (action: MissedDoseAction | null) => action != null && action !== 'take_late_restart';

/** The first planned moment at-or-after `from` (or strictly after), by the schedule's timing. */
function slotFrom(t: ScheduleTiming, from: number, strictlyAfter: boolean): number | null {
  if (t.frequencyHours) return strictlyAfter ? from + t.frequencyHours * HOUR : from;
  if (t.explicitTimes?.length) {
    return Math.floor(nextExplicitTime(t.explicitTimes, new Date(from * 1000), strictlyAfter, t.timeZone).getTime() / 1000);
  }
  return null;
}

/** The plan's slots from `startAt`, in order, up to `limit` (inclusive) and at most `max` of them. */
function gridSlots(t: ScheduleTiming, limit: number, max: number): number[] {
  const out: number[] = [];
  let cursor = slotFrom(t, t.startAt, false);
  while (cursor != null && cursor <= limit && out.length < Math.min(max, MAX_SLOTS)) {
    out.push(cursor);
    cursor = slotFrom(t, cursor, true);
  }
  return out;
}

/** How many planned slots fall from `startAt` to `limit` (inclusive), at most `max`. */
function countSlots(t: ScheduleTiming, limit: number, max: number): number {
  if (limit < t.startAt) return 0;
  if (t.frequencyHours) return Math.min(max, Math.floor((limit - t.startAt) / (t.frequencyHours * HOUR)) + 1);
  return gridSlots(t, limit, max).length;
}

/** The plan's k-th slot (0-based), ignoring every end condition. */
function gridSlot(t: ScheduleTiming, k: number): number | null {
  if (t.frequencyHours) return t.startAt + k * t.frequencyHours * HOUR;
  const slots = gridSlots(t, Infinity, k + 1);
  return slots.length > k ? slots[k] : null;
}

/**
 * Where the course effectively ends, in slots and in time:
 *   - a count course (`endAfterOccurrences` N): "end on date" ends at its N-th planned slot however
 *     many were given; otherwise it runs until N doses are given, so each skip adds a slot.
 *   - a date course (`endAt`): "finish every dose" moves the end one slot per skip; otherwise the
 *     date stands.
 */
function effectiveEnd(t: ScheduleTiming, skipped: number): { slotCap: number; endAt: number } {
  let slotCap = Infinity;
  let endAt = t.endAt ?? Infinity;
  if (t.endAfterOccurrences != null) {
    slotCap = t.courseEffect === 'end_on_date' ? t.endAfterOccurrences : t.endAfterOccurrences + skipped;
    if (t.courseEffect === 'end_on_date') endAt = Math.min(endAt, gridSlot(t, t.endAfterOccurrences - 1) ?? Infinity);
  }
  if (t.endAt != null && t.courseEffect === 'finish_every_dose' && skipped > 0) {
    const within = countSlots(t, t.endAt, Infinity);
    endAt = gridSlot(t, within - 1 + skipped) ?? t.endAt;
  }
  return { slotCap, endAt };
}

/**
 * The state of a schedule at `now`, from its timing and the epoch-second times of its doses (by
 * `performedAt`) and of its skipped slots.
 */
export function computeScheduleState(t: ScheduleTiming, doses: number[], skips: number[], now: number): ScheduleState {
  const loggedCount = doses.length;
  const skippedCount = skips.length;
  const covered = loggedCount + skippedCount;
  const end = effectiveEnd(t, skippedCount);

  const expectedCount = countSlots(t, Math.min(now, end.endAt), end.slotCap);

  let next: number | null;
  if (isGrid(t.action)) {
    next = gridSlot(t, covered);
  } else {
    const anchor = Math.max(doses.length ? Math.max(...doses) : -Infinity, skips.length ? Math.max(...skips) : -Infinity);
    next = Number.isFinite(anchor) ? slotFrom(t, anchor, true) : slotFrom(t, t.startAt, false);
  }

  let completed = false;
  if (t.endAfterOccurrences != null) {
    const done = t.courseEffect === 'end_on_date' ? covered : loggedCount;
    if (done >= t.endAfterOccurrences) completed = true;
  }
  if (next != null && next > end.endAt) completed = true;
  if (completed || t.status !== 'active') next = null;

  const overdue = next != null && next < now;
  let missedDose: MissedDoseState | null = null;
  if (overdue && next != null) {
    let nextSlotAt = isGrid(t.action) ? gridSlot(t, covered + 1) : slotFrom(t, next, true);
    if (nextSlotAt != null && nextSlotAt > end.endAt) nextSlotAt = null;
    const takeLate = t.action === 'take_late_keep_times' || t.action === 'take_late_restart';
    missedDose = {
      slotAt: next,
      nextSlotAt,
      action: t.action,
      pastCutoff: takeLate && t.cutoffHours != null && nextSlotAt != null && nextSlotAt - now <= t.cutoffHours * HOUR,
      doubleNextDue: t.action === 'double_next',
    };
  }

  const remainingOccurrences =
    t.endAfterOccurrences == null
      ? null
      : Math.max(0, t.endAfterOccurrences - (t.courseEffect === 'end_on_date' ? covered : loggedCount));

  const courseEndsAt = next != null ? lastPlannedDose(t, next, isGrid(t.action) ? next : Math.max(next, now), remainingOccurrences, end.endAt) : null;

  return {
    nextDueAt: next,
    completed,
    expectedCount,
    loggedCount,
    skippedCount,
    missed: Math.max(0, expectedCount - loggedCount - skippedCount),
    remainingOccurrences,
    overdue,
    courseEndsAt,
    missedDose,
  };
}

/**
 * The course's last planned dose, counted on from the next one: `remaining` doses for a count
 * course, the last slot at or before `endAt` for a date course, whichever comes first. `from` is
 * where the count starts — the next slot itself on a grid, or now when a late dose under "restart
 * the clock" moves every dose after it. Null for an open-ended course: the app never invents an end.
 */
function lastPlannedDose(t: ScheduleTiming, next: number, from: number, remaining: number | null, endAt: number): number | null {
  if (remaining == null && !Number.isFinite(endAt)) return null;
  const more = remaining == null ? Infinity : Math.max(0, remaining - 1);
  if (from > endAt) return next <= endAt ? next : null;
  if (t.frequencyHours) {
    const step = t.frequencyHours * HOUR;
    return from + Math.min(more, Math.floor((endAt - from) / step)) * step;
  }
  let last = from;
  for (let i = 0; i < Math.min(more, MAX_SLOTS); i++) {
    const n = slotFrom(t, last, true);
    if (n == null || n > endAt) break;
    last = n;
  }
  return last;
}

/** The doses (by `performedAt`) and skipped slots of a schedule, as epoch seconds, ascending. */
export async function loadScheduleEvents(db: any, scheduleId: string): Promise<{ doses: number[]; skips: number[] }> {
  const doseRows: any[] = await db.select().from(interventions).where(eq(interventions.scheduleId, scheduleId));
  const skipRows: any[] = await db.select().from(scheduleSkips).where(eq(scheduleSkips.scheduleId, scheduleId));
  return {
    doses: doseRows.map((r) => normalizeTs(r.performedAt)!).sort((a, b) => a - b),
    skips: skipRows.map((r) => normalizeTs(r.slotAt)!).sort((a, b) => a - b),
  };
}

export async function scheduleStateFor(db: any, row: any, now = Math.floor(Date.now() / 1000)): Promise<ScheduleState> {
  const { doses, skips } = await loadScheduleEvents(db, row.id);
  return computeScheduleState(timingFromRow(row), doses, skips, now);
}

/**
 * Write the schedule's `nextDueAt` and, when the course has run out, `status: 'completed'`. A
 * paused or completed schedule keeps its status (the caregiver set it) and has no next due.
 */
export async function persistScheduleState(db: any, scheduleId: string): Promise<void> {
  const rows: any[] = await db.select().from(interventionSchedules).where(eq(interventionSchedules.id, scheduleId)).limit(1);
  if (!rows.length) return;
  const row = rows[0];
  const state = await scheduleStateFor(db, row);
  const updates: Record<string, any> = { nextDueAt: state.nextDueAt != null ? new Date(state.nextDueAt * 1000) : null };
  if (row.status === 'active' && state.completed) updates.status = 'completed';
  await db.update(interventionSchedules).set(updates).where(eq(interventionSchedules.id, scheduleId));
}
