import { InterventionSchedule } from '@salud/shared/types';
import { localDaysBetween, scheduleSlots } from '../episodes/episode-course';

// How far through a course we are, in calendar days in the viewer's zone — shared by the schedule
// page's day tiles and the episode page's "Keeping up" card so the two can never disagree
// (frontend.md → Schedule detail; Episode detail → "Are we keeping up"). The end is always the
// API's `adherence.courseEndsAt`, which already carries any push from missed, late or skipped
// doses (data-model.md → ScheduleAdherence); this module never invents an end.

export interface DayTile {
  value: string;
  label: string;
}

/** "4 days since start", or "2 days until start" for a course not begun. */
export function sinceStart(s: InterventionSchedule, now: number): DayTile {
  const days = localDaysBetween(s.startAt, now);
  if (days < 0) return { value: String(-days), label: -days === 1 ? 'day until start' : 'days until start' };
  return { value: String(days), label: days === 1 ? 'day since start' : 'days since start' };
}

/**
 * Days to the local day of the last planned dose (`adherence.courseEndsAt`). Done or paused say
 * so instead of a count; an open-ended schedule has no tile. Never negative: an overdue last dose
 * is due today.
 */
export function untilDone(s: InterventionSchedule, now: number): DayTile | null {
  if (s.status === 'completed') return { value: 'Done', label: 'course complete' };
  if (s.endAt == null && s.endAfterOccurrences == null) return null;
  if (s.status === 'paused') return { value: 'Paused', label: 'resumes where it stopped' };
  const end = s.adherence.courseEndsAt;
  if (end == null) return null;
  const days = Math.max(0, localDaysBetween(now, end));
  if (days === 0) return { value: 'Today', label: 'last dose' };
  return { value: String(days), label: days === 1 ? 'day until done' : 'days until done' };
}

/**
 * The last dose as the schedule was set up: the N-th planned slot of a count course, the last slot
 * on or before `endAt` of a date course, whichever comes first. Null when open-ended.
 */
export function plannedLastDose(s: InterventionSchedule): number | null {
  if (s.endAt == null && s.endAfterOccurrences == null) return null;
  const slots = scheduleSlots(s, s.startAt, s.endAt ?? Infinity);
  return slots.length ? slots[slots.length - 1] : null;
}

/**
 * When the course's end has moved later than planned — by doses given late under "restart the
 * clock", or skipped under "give every dose" — the planned last dose and how many calendar days
 * later it now falls. Null when it hasn't moved by a day, or there is no projected end.
 */
export function endShift(s: InterventionSchedule): { plannedAt: number; endsAt: number; days: number } | null {
  const endsAt = s.adherence?.courseEndsAt ?? null;
  const plannedAt = plannedLastDose(s);
  if (endsAt == null || plannedAt == null) return null;
  const days = localDaysBetween(plannedAt, endsAt);
  return days > 0 ? { plannedAt, endsAt, days } : null;
}
