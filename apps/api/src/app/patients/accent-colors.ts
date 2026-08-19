import { PatientAccentColor } from '@salud/shared/types';

/**
 * The fixed app palette (data-model.md → Patient).
 *
 * Tokens, never hex: the stored value is `'teal'`, so retuning what teal *looks like* is a CSS
 * change in `apps/web/src/styles.css` rather than a data migration. The order below is also the
 * tie-break order for assignment, which is what makes a fresh household's first patients land on
 * visibly different colors instead of on whatever the map iterated first.
 */
export const PATIENT_ACCENT_COLORS = [
  'teal',
  'amber',
  'violet',
  'rose',
  'lime',
  'sky',
  'fuchsia',
  'indigo',
] as const satisfies readonly PatientAccentColor[];

// Both directions, so adding a token to the union without adding it here (or the reverse) fails
// the build rather than silently shrinking the palette the server can assign from.
type _EveryTokenIsAssignable = (typeof PATIENT_ACCENT_COLORS)[number] extends PatientAccentColor
  ? true
  : never;
type _EveryTokenIsAssigned = PatientAccentColor extends (typeof PATIENT_ACCENT_COLORS)[number]
  ? true
  : never;
const _paletteIsComplete: [_EveryTokenIsAssignable, _EveryTokenIsAssigned] = [true, true];
void _paletteIsComplete;

export function isAccentColor(value: unknown): value is PatientAccentColor {
  return typeof value === 'string' && (PATIENT_ACCENT_COLORS as readonly string[]).includes(value);
}

/**
 * The token the caller's household is using least, palette order breaking ties (api.md → Patients).
 * Scoped to the requester's accessible patients rather than globally: the color's job is telling
 * *this* caregiver's patients apart on *this* caregiver's screens, and another household's choices
 * are invisible here.
 */
export function leastUsedAccentColor(inUse: readonly (string | null | undefined)[]): PatientAccentColor {
  const counts = new Map<PatientAccentColor, number>(
    PATIENT_ACCENT_COLORS.map((token) => [token, 0]),
  );
  for (const value of inUse) {
    if (isAccentColor(value)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  let best: PatientAccentColor = PATIENT_ACCENT_COLORS[0];
  for (const token of PATIENT_ACCENT_COLORS) {
    if ((counts.get(token) ?? 0) < (counts.get(best) ?? 0)) best = token;
  }
  return best;
}

/**
 * The color for a patient row written before this column existed. Derived from the id so it is
 * stable across reads and across the two dialects — a color that changed between page loads would
 * be worse than no color at all, given what it is guarding against. New patients never reach this
 * path; `create` always stores an explicit token.
 */
export function fallbackAccentColor(patientId: string): PatientAccentColor {
  let hash = 0;
  for (let i = 0; i < patientId.length; i++) {
    hash = (hash * 31 + patientId.charCodeAt(i)) >>> 0;
  }
  return PATIENT_ACCENT_COLORS[hash % PATIENT_ACCENT_COLORS.length];
}

export function resolveAccentColor(stored: string | null | undefined, patientId: string): PatientAccentColor {
  return isAccentColor(stored) ? stored : fallbackAccentColor(patientId);
}
