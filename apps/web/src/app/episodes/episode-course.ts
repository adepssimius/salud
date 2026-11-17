import { InterventionSchedule, TimelineEntry } from '@salud/shared/types';

// The arithmetic behind the episode page's "Keeping up" section (frontend.md → Episode detail):
// which doses count toward a schedule, how many were due, how far along the course is, when the
// next dose is due, and what each day of the episode expected. Pure functions over epoch seconds
// with `now` passed in, so every rule here is testable without a clock or a component.
//
// Days are the *browser's* local days. That is deliberate: "did we keep up on Tuesday" is a
// question about the viewer's Tuesday, so this page computes its own per-day expected counts on
// the browser's clock rather than reading `adherence.expectedCount`. The server reads fixed-time
// slots ("08:00") in the schedule's own `timeZone` (data-model.md → InterventionSchedule), so the
// two agree whenever the viewer is in the schedule's zone.

const HOUR = 3600;

/** Local midnight of the day containing `sec`, as epoch seconds. */
export function localDayStart(sec: number): number {
  const d = new Date(sec * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Local midnight of the following day — DST-safe, unlike adding 86 400. */
export function nextLocalDayStart(sec: number): number {
  const d = new Date(localDayStart(sec) * 1000);
  d.setDate(d.getDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

/** Whole local calendar days from `a`'s day to `b`'s day (0 when the same day). */
export function localDaysBetween(a: number, b: number): number {
  const da = new Date(localDayStart(a) * 1000);
  const db = new Date(localDayStart(b) * 1000);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86_400_000);
}

/** "2026-11-07" in local time — a stable key for grouping by day. */
export function localDayKey(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function explicitSlotsOnDay(times: string[], dayStart: number): number[] {
  return [...times]
    .sort()
    .map((t) => {
      const [h, m] = t.split(':').map(Number);
      const d = new Date(dayStart * 1000);
      d.setHours(h, m, 0, 0);
      return Math.floor(d.getTime() / 1000);
    });
}

/**
 * Every slot the schedule planned in `[from, to]`, in order. Slots run from `startAt` on the
 * schedule's grid (`frequencyHours` apart, or each `explicitTimes` slot on each local day), stop
 * at `endAt`, and never number more than `endAfterOccurrences` — the same cap the API's
 * `expectedCount` applies (data-model.md → ScheduleAdherence).
 */
export function scheduleSlots(s: InterventionSchedule, from: number, to: number): number[] {
  const end = Math.min(to, s.endAt ?? Infinity);
  const cap = s.endAfterOccurrences ?? Infinity;
  const out: number[] = [];
  if (end < s.startAt) return out;
  if (s.frequencyHours) {
    const step = s.frequencyHours * HOUR;
    for (let k = 0; k < cap; k++) {
      const t = s.startAt + k * step;
      if (t > end) break;
      if (t >= from) out.push(t);
    }
    return out;
  }
  if (s.explicitTimes?.length) {
    let index = 0;
    for (let day = localDayStart(s.startAt), guard = 0; day <= end && index < cap && guard < 3660; day = nextLocalDayStart(day), guard++) {
      for (const t of explicitSlotsOnDay(s.explicitTimes, day)) {
        if (t < s.startAt) continue;
        if (t > end || index >= cap) break;
        index++;
        if (t >= from) out.push(t);
      }
    }
  }
  return out;
}

const meta = (e: TimelineEntry): any => (e.display as any)?.metadata ?? {};
const scheduleIdOf = (e: TimelineEntry): string | null => (e.display as any)?.scheduleId ?? null;

/**
 * Whether a dose counts toward this schedule: it is linked to it (`scheduleId`). Nothing else
 * counts — adherence is defined on linked doses only, on this page as everywhere (api.md →
 * Intervention schedules → "Linking existing doses").
 */
export function countsToward(s: InterventionSchedule, e: TimelineEntry): boolean {
  return e.kind === 'intervention' && scheduleIdOf(e) === s.id;
}

/**
 * A dose the schedule's own "Link existing doses" would offer: no schedule, the schedule's type,
 * its medicine (and embodiment, when it names one), inside its window. The page counts these only
 * to say they exist and link through to where they can be linked — never toward compliance.
 */
export function isLinkCandidate(s: InterventionSchedule, e: TimelineEntry): boolean {
  if (e.kind !== 'intervention' || scheduleIdOf(e) || e.type !== s.type) return false;
  if (s.type === 'medication_dose') {
    if (meta(e).medicationId !== s.medicationId) return false;
    if (s.medicationEmbodimentId && meta(e).medicationEmbodimentId !== s.medicationEmbodimentId) return false;
  }
  return e.timestamp >= s.startAt && (s.endAt == null || e.timestamp <= s.endAt);
}

export interface ScheduleProgress {
  /** Doses linked to the schedule — the API's `loggedCount`, for this episode's doses. */
  given: number;
  /** Doses in this episode the schedule could take but that are not linked to it. */
  unlinked: number;
  /** Slots due by now. */
  due: number;
  /** Due slots not covered — never negative; extra doses do not bank against future slots. */
  short: number;
  /** Slots the caregiver deliberately skipped (`adherence.skippedCount`) — not missed. */
  skipped: number;
  /** "17 of 28 doses" — only when `endAfterOccurrences` is set. */
  doses: { given: number; total: number } | null;
  /** "day 9 of 14" — only when `endAt` is set. */
  days: { day: number; total: number } | null;
  state: 'active' | 'paused' | 'complete';
  /** When the next dose is due — the schedule's own `nextDueAt`; null when paused or complete. */
  nextDueAt: number | null;
  lastGivenAt: number | null;
}

export function scheduleProgress(
  s: InterventionSchedule,
  entries: TimelineEntry[],
  now: number,
): ScheduleProgress {
  const counted = entries.filter((e) => countsToward(s, e)).sort((a, b) => a.timestamp - b.timestamp);
  const given = counted.length;
  const due = scheduleSlots(s, s.startAt, now).length;
  const lastGivenAt = counted.length ? counted[counted.length - 1].timestamp : null;

  const doses = s.endAfterOccurrences != null ? { given, total: s.endAfterOccurrences } : null;
  let days: ScheduleProgress['days'] = null;
  if (s.endAt != null) {
    const total = localDaysBetween(s.startAt, s.endAt) + 1;
    const day = Math.max(0, Math.min(total, localDaysBetween(s.startAt, now) + 1));
    days = { day: now < s.startAt ? 0 : day, total };
  }

  let state: ScheduleProgress['state'] = s.status === 'paused' ? 'paused' : 'active';
  if (s.status === 'completed' || (doses && given >= doses.total) || (s.endAt != null && now > s.endAt)) {
    state = 'complete';
  }

  return {
    given,
    unlinked: entries.filter((e) => isLinkCandidate(s, e)).length,
    due,
    short: Math.max(0, due - given),
    skipped: s.adherence?.skippedCount ?? 0,
    doses,
    days,
    state,
    // The schedule's own next-due time, so this page and the schedule page never disagree; linking
    // a dose recomputes it server-side (api.md → "Linking existing doses").
    nextDueAt: state === 'active' ? s.nextDueAt : null,
    lastGivenAt,
  };
}

export interface DayCell {
  key: string;
  dayStart: number;
  /** Day 1 is the episode's first day. */
  dayNumber: number;
  count: number;
  /** What the schedules expected that day; null when no schedule covers it (no judgement). */
  expected: number | null;
  /** Slots deliberately skipped that day — they cover their slot, so they never make it short. */
  skipped: number;
  /**
   * Fewer given (plus skipped) than expected, on a day that is over (or today, once no slot is
   * left). A record of the day, which the page shows as a caution, never an alarm.
   */
  short: boolean;
  isToday: boolean;
}

/**
 * One cell per local day of the episode, from its first day to its last (or today). With no
 * schedules each cell is a plain count of the episode's interventions — no target, no judgement
 * (P6). With schedules, a cell counts the doses linked to them and compares that with the slots
 * the schedules planned that day; today is never "short" while a slot is still to come.
 */
export function dayStrip(
  startedAt: number,
  endedAt: number | null,
  schedules: InterventionSchedule[],
  entries: TimelineEntry[],
  now: number,
  /** Skipped slot times per schedule id (only schedules that have any). */
  skips: Map<string, number[]> = new Map(),
): DayCell[] {
  const last = endedAt ?? now;
  const interventionsOnly = entries.filter((e) => e.kind === 'intervention');
  const cells: DayCell[] = [];
  const todayKey = localDayKey(now);
  let dayNumber = 1;
  for (let day = localDayStart(startedAt), guard = 0; day <= last && guard < 1000; day = nextLocalDayStart(day), guard++, dayNumber++) {
    const next = nextLocalDayStart(day);
    const onDay = interventionsOnly.filter((e) => e.timestamp >= day && e.timestamp < next);
    const key = localDayKey(day);
    const isToday = key === todayKey;
    if (!schedules.length) {
      cells.push({ key, dayStart: day, dayNumber, count: onDay.length, expected: null, skipped: 0, short: false, isToday });
      continue;
    }
    const count = onDay.filter((e) => schedules.some((s) => countsToward(s, e))).length;
    let expected = 0;
    let skipped = 0;
    let slotsLeftToday = false;
    for (const s of schedules) {
      const slots = scheduleSlots(s, day, next - 1);
      expected += slots.length;
      skipped += (skips.get(s.id) ?? []).filter((t) => t >= day && t < next).length;
      if (isToday && slots.some((t) => t > now)) slotsLeftToday = true;
    }
    const over = !isToday || !slotsLeftToday;
    cells.push({
      key,
      dayStart: day,
      dayNumber,
      count,
      expected: expected || null,
      skipped,
      short: expected > 0 && count + skipped < expected && over && day <= now,
      isToday,
    });
  }
  return cells;
}

// ── The log ────────────────────────────────────────────────────────────────────────────────

export interface LogDay {
  key: string;
  dayStart: number;
  entries: TimelineEntry[];
}

export type LogItem =
  | { kind: 'day'; day: LogDay }
  /** Consecutive days that held nothing but the same routine dose, folded into one line. */
  | { kind: 'run'; key: string; days: LogDay[]; count: number; first: number; last: number; sample: TimelineEntry };

/**
 * A routine dose: an ordinary medication dose — not flagged atypical, and not the entry that
 * started or ended the episode. Its key is the medicine and embodiment, so a run never folds two
 * different treatments into one line.
 */
export function routineKey(e: TimelineEntry, isMarker: (e: TimelineEntry) => boolean): string | null {
  if (e.kind !== 'intervention' || e.type !== 'medication_dose' || isMarker(e)) return null;
  const m = meta(e);
  if (m.isAtypical) return null;
  return `${m.medicationId ?? ''}|${m.medicationEmbodimentId ?? ''}`;
}

/**
 * The log, newest day first, each day's entries newest first. Two or more consecutive days whose
 * entries are all the same routine dose collapse into one expandable run; any day holding
 * anything else — an observation, an atypical dose, the start — stays a day of its own.
 */
export function buildLog(entries: TimelineEntry[], isMarker: (e: TimelineEntry) => boolean): LogItem[] {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  const days: LogDay[] = [];
  for (const e of sorted) {
    const key = localDayKey(e.timestamp);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else days.push({ key, dayStart: localDayStart(e.timestamp), entries: [e] });
  }

  const dayRoutine = (d: LogDay): string | null => {
    const keys = new Set(d.entries.map((e) => routineKey(e, isMarker)));
    if (keys.size !== 1) return null;
    const [k] = [...keys];
    return k;
  };

  const items: LogItem[] = [];
  let i = 0;
  while (i < days.length) {
    const k = dayRoutine(days[i]);
    let j = i + 1;
    if (k) while (j < days.length && dayRoutine(days[j]) === k) j++;
    if (k && j - i >= 2) {
      const run = days.slice(i, j);
      const all = run.flatMap((d) => d.entries);
      items.push({
        kind: 'run',
        key: `run-${run[0].key}`,
        days: run,
        count: all.length,
        first: all[all.length - 1].timestamp,
        last: all[0].timestamp,
        sample: all[0],
      });
    } else {
      for (let x = i; x < j; x++) items.push({ kind: 'day', day: days[x] });
    }
    i = j;
  }
  return items;
}
