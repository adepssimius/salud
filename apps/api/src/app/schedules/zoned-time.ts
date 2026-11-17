// Wall-clock ↔ instant conversion for an IANA time zone, on Node's built-in ICU data — no date
// library (the same stance as apps/web/src/app/core/relative-time.ts). Used by fixed-time
// schedules: "08:00" means 08:00 in the schedule's own zone, never the API server's
// (data-model.md → InterventionSchedule.timeZone).

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The zone this process resolves on its own — what a schedule with no stored zone falls back to. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(instantMs: number, timeZone: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as unknown as WallParts;
}

/** The zone's UTC offset in ms at `instantMs` (local = instant + offset). */
function offsetMs(instantMs: number, timeZone: string): number {
  const w = wallParts(instantMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant at which the wall clock in `timeZone` reads year-month-day hour:minute.
 * Across a DST change: a time that occurs twice (fall back) resolves to the first occurrence; a
 * time that never occurs (spring forward, e.g. 02:30) moves forward by the gap (to 03:30).
 */
export function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const local = Date.UTC(year, month - 1, day, hour, minute);
  // Offsets a day either side bracket at most one transition (zones never change twice a day).
  const before = offsetMs(local - DAY_MS, timeZone);
  const after = offsetMs(local + DAY_MS, timeZone);
  const valid = [local - before, local - after].filter(
    (t, i) => offsetMs(t, timeZone) === (i === 0 ? before : after),
  );
  if (valid.length) return Math.min(...valid);
  // In the gap: neither offset reproduces this wall time. Keep the pre-transition offset, which
  // lands the same distance past the jump.
  return local - before;
}

/** The calendar date (in `timeZone`) that `instantMs` falls on. */
export function zonedDate(instantMs: number, timeZone: string): { year: number; month: number; day: number } {
  const w = wallParts(instantMs, timeZone);
  return { year: w.year, month: w.month, day: w.day };
}
