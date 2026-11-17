/**
 * When a recorded weight is too old to dose from — the one rule behind the `stale_weight`
 * advisory (advisories.md), the timeline/dashboard `weightPrompt` (api.md) and the hub header's
 * stale-weight pill (frontend.md). Shared so the three can never disagree.
 *
 * The threshold scales with the patient's age at the moment of the check (a dose's `occurredAt`,
 * not today): a dose within about 10% is treated as equivalent, so a weight is flagged at roughly
 * half the time a patient of that age takes to grow 10% — about 5% worst-case drift, except the
 * under-3-months tier, held at a week (about 8%) on purpose (advisories.md → "Stale weight", which
 * has the figures and sources). For a growing child a stale weight errs toward under-dosing, so
 * this is a nudge, not an alarm.
 */

/** Age tiers, youngest first: under `maxAgeMonths` (calendar months) → `thresholdDays`. */
export const STALE_WEIGHT_TIERS: readonly { maxAgeMonths: number; thresholdDays: number }[] = [
  { maxAgeMonths: 3, thresholdDays: 7 },
  { maxAgeMonths: 6, thresholdDays: 14 },
  { maxAgeMonths: 12, thresholdDays: 30 },
  { maxAgeMonths: 24, thresholdDays: 60 },
  { maxAgeMonths: 5 * 12, thresholdDays: 90 },
  { maxAgeMonths: 18 * 12, thresholdDays: 180 },
];

/** Adults (18+), and any patient whose birth date is missing or unreadable. */
export const ADULT_STALE_WEIGHT_DAYS = 365;

/**
 * Whole calendar months from an ISO birth date (`YYYY-MM-DD`) to `at`, in UTC, or null when the
 * date is missing, unparseable or after `at`.
 */
function ageInMonthsAt(dateOfBirth: string | null | undefined, at: Date): number | null {
  if (!dateOfBirth) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (Number.isNaN(at.getTime())) return null;
  let months = (at.getUTCFullYear() - y) * 12 + (at.getUTCMonth() - mo);
  if (at.getUTCDate() < d) months -= 1;
  return months < 0 ? null : months;
}

/** Days a weight stays usable for a patient born on `dateOfBirth`, judged at `at`. */
export function staleWeightThresholdDays(dateOfBirth: string | null | undefined, at: Date): number {
  const months = ageInMonthsAt(dateOfBirth, at);
  if (months === null) return ADULT_STALE_WEIGHT_DAYS;
  return STALE_WEIGHT_TIERS.find((t) => months < t.maxAgeMonths)?.thresholdDays ?? ADULT_STALE_WEIGHT_DAYS;
}

/**
 * Whether the latest weight (epoch seconds, or null if never recorded) is stale at `at`, and how
 * many whole days old it is. Never recorded is always stale.
 */
export function weightStaleness(
  latestWeightRecordedAt: number | null | undefined,
  dateOfBirth: string | null | undefined,
  at: Date,
): { stale: boolean; daysSince: number | null; thresholdDays: number } {
  const thresholdDays = staleWeightThresholdDays(dateOfBirth, at);
  if (latestWeightRecordedAt == null) return { stale: true, daysSince: null, thresholdDays };
  const daysSince = Math.floor((Math.floor(at.getTime() / 1000) - latestWeightRecordedAt) / 86_400);
  return { stale: daysSince > thresholdDays, daysSince, thresholdDays };
}
