// The `dependents` body of a catalog *_IN_USE conflict (MEDICATION_IN_USE, EMBODIMENT_IN_USE,
// GUIDELINE_IN_USE, EMBODIMENT_CONCENTRATION_IN_USE), read back in words.
//
// The API sends only non-zero counts keyed by what is in the way (catalog-dependencies.ts on the
// API side). The error sentence alone says "still in use"; the counts are what tell a caregiver
// whether that is one stray schedule they can remove or forty logged doses they must not.

const NOUNS: Record<string, [singular: string, plural: string]> = {
  interventions: ['logged dose', 'logged doses'],
  schedules: ['schedule', 'schedules'],
  reactions: ['recorded reaction', 'recorded reactions'],
  embodiments: ['form', 'forms'],
  guidelines: ['dosing guideline', 'dosing guidelines'],
  advisories: ['alert', 'alerts'],
};

/** The `dependents` object of a failed request, or null when the body carries none. */
export function dependentsFrom(err: unknown): Record<string, number> | null {
  const raw = (err as any)?.error?.dependents;
  if (!raw || typeof raw !== 'object') return null;
  const counts = Object.entries(raw).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0,
  );
  return counts.length ? Object.fromEntries(counts) : null;
}

/** "Still used by 3 logged doses and 1 schedule." — or null when there is nothing to say. */
export function dependentsText(dependents: Record<string, number> | null): string | null {
  if (!dependents) return null;
  const parts = Object.entries(dependents)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => {
      // An unknown key still gets counted rather than dropped: a dependency type the API adds later
      // is still something in the way.
      const [one, many] = NOUNS[key] ?? ['other record', 'other records'];
      return `${n} ${n === 1 ? one : many}`;
    });
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Still used by ${list}.`;
}
