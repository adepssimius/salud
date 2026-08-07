// Human-readable relative time for handoff surfaces — "2h 15m ago", "in 1h 40m", "can give now".
//
// Two rules shape this:
//  - A half-awake caregiver can act on an elapsed interval; they cannot act on "8/6/26, 11:14 PM"
//    without doing arithmetic first, which is exactly the work P1 (product.md) says the app should
//    do instead of them. frontend.md → "Dashboard": "Times on this page are relative, not absolute."
//  - The granularity is deliberately asymmetric. Under a day is the handoff window, where the
//    caregiver is scanning and precision drives a decision, so units stay compact and carry two
//    components ("2h 15m ago"). Over a day is context, where prose reads better — matching the
//    code-status card's existing "set 14 months ago" (frontend.md → Code status card).
//
// No date library: none is a root dependency, this is integer arithmetic on epoch seconds, and the
// web bundle is already over its size budget (ISSUES.md #11). No Angular pipe either — this module
// has no Angular imports; components call it from a method, same as core/event-display.ts.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY; // matches the coarse floor(days/30) the retired formatRelativeAge used
const YEAR = 12 * MONTH;

const now = () => Math.floor(Date.now() / 1000);

/** "2h" or "2h 15m" — minutes suppressed when they're zero. */
function hoursAndMinutes(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / HOUR);
  const m = Math.floor((totalSeconds % HOUR) / MINUTE);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** The coarse ladder shared by both directions, past the one-day mark: "13 days", "14 months", "2 years". */
function coarseSpan(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / DAY);
  if (days < 30) return days === 1 ? '1 day' : `${days} days`;
  const months = Math.floor(totalSeconds / MONTH);
  if (months < 24) return months === 1 ? '1 month' : `${months} months`;
  const years = Math.floor(totalSeconds / YEAR);
  return years === 1 ? '1 year' : `${years} years`;
}

/**
 * How long ago a past moment was: "just now", "45m ago", "2h 15m ago", "3 days ago", "14 months ago".
 * A timestamp in the future floors to "just now" rather than reading as a negative duration — that
 * can happen with a forward-dated entry, and there's nothing useful to say beyond "not yet elapsed".
 */
export function timeAgo(epochSeconds: number, nowSeconds: number = now()): string {
  const delta = nowSeconds - epochSeconds;
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${hoursAndMinutes(delta)} ago`;
  return `${coarseSpan(delta)} ago`;
}

/**
 * How far off a future moment is: "in less than a minute", "in 1h 40m", "in 3 days". A timestamp in
 * the past floors to "now".
 */
export function timeUntil(epochSeconds: number, nowSeconds: number = now()): string {
  const delta = epochSeconds - nowSeconds;
  if (delta <= 0) return 'now';
  if (delta < MINUTE) return 'in less than a minute';
  if (delta < HOUR) return `in ${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `in ${hoursAndMinutes(delta)}`;
  return `in ${coarseSpan(delta)}`;
}

/**
 * Direction-aware relative time — past reads "…ago", future reads "in …". For fields that can be
 * either side of now, like a schedule's next-due time (overdue vs. upcoming).
 */
export function relativeTime(epochSeconds: number, nowSeconds: number = now()): string {
  return epochSeconds <= nowSeconds ? timeAgo(epochSeconds, nowSeconds) : timeUntil(epochSeconds, nowSeconds);
}

/**
 * The dose countdown. `null` in, `null` out — a medication with no guideline interval has no
 * countdown, and that is correct, not missing data (api.md → GET /api/dashboard). A time that has
 * already elapsed reads "can give now", never a negative duration.
 */
export function nextDoseLabel(nextAllowedAt: number | null, nowSeconds: number = now()): string | null {
  if (nextAllowedAt === null) return null;
  if (nextAllowedAt <= nowSeconds) return 'can give now';
  return `next dose ${timeUntil(nextAllowedAt, nowSeconds)}`;
}
