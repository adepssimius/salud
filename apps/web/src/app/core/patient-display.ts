import { weightStaleness } from '@salud/shared/types';

/**
 * Small patient-header derivations shared by the patient hub and anything else that shows a
 * patient's identity line.
 *
 * Age is computed client-side here because the only age the API produces is on the ER Brief
 * (`ErBriefHeaderPatient.ageYears`/`ageMonths`), which is a clinical document with its own
 * response shape — nothing hands an age back with a plain `Patient`.
 */

/** Whole months between two dates, ignoring the time of day. */
function monthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
}

/**
 * "4y 3m" / "7 months" / "3 weeks" — weighted toward the precision that matters at the age in
 * question, the way a caregiver says it out loud. Returns null for an unparseable date rather than
 * rendering "NaN" on a clinical header.
 */
export function formatAge(dateOfBirth: string | null | undefined, now: Date = new Date()): string | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(dob.getTime()) || dob > now) return null;

  const months = monthsBetween(dob, now);
  if (months < 1) {
    const days = Math.floor((now.getTime() - dob.getTime()) / 86_400_000);
    if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
    const weeks = Math.floor(days / 7);
    return `${weeks} weeks`;
  }
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;

  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return remainder ? `${years}y ${remainder}m` : `${years}y`;
}

/**
 * The same rule the dosing engine and the timeline's `weightPrompt` apply — never recorded, or
 * older than the patient's age-scaled threshold (`weightStaleness` in `@salud/shared/types`;
 * advisories.md → stale_weight). `latestWeightRecordedAt` is epoch seconds.
 */
export function isWeightStale(
  latestWeightRecordedAt: number | null | undefined,
  dateOfBirth: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return weightStaleness(latestWeightRecordedAt, dateOfBirth, now).stale;
}

/** Days since the last recorded weight, or null when there has never been one. */
export function weightAgeDays(latestWeightRecordedAt: number | null | undefined, now: Date = new Date()): number | null {
  if (latestWeightRecordedAt == null) return null;
  return Math.floor((Math.floor(now.getTime() / 1000) - latestWeightRecordedAt) / 86_400);
}
