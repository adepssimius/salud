/**
 * One dose amount written three ways — mg, mL, pill count — and the arithmetic between them.
 *
 * Shared by the API (which derives `amountMg` when a dose arrives as a volume or a pill count) and
 * the dose form (which fills the boxes from each other), so the form and the saved dose can never
 * disagree about what 10 mL of a 32 mg/mL suspension is (frontend.md → "Dose entry"; api.md →
 * Interventions). This converts the caregiver's own amount; guideline math stays server-side.
 *
 * Every function returns null rather than guessing when it lacks the figure it needs.
 */

/** Two decimals, with binary-float dust (0.30000000000000004) removed. */
function round2(n: number): number {
  return Number((Math.round(n * 100) / 100).toFixed(2));
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Round a volume to something a caregiver can actually draw: the graduations printed on a
 * paediatric oral syringe are 0.1 mL at and above 1 mL, and 0.05 mL below it (api.md → "mL
 * derivation"). toFixed(2) before Number() so float dust never reaches the wire.
 */
export function toDrawableMl(ml: number): number {
  const step = ml >= 1 ? 0.1 : 0.05;
  return Number((Math.round(ml / step) * step).toFixed(2));
}

export function mgFromMl(ml: number | null | undefined, concentrationMgPerMl: number | null | undefined): number | null {
  if (ml == null || !Number.isFinite(ml) || ml < 0 || !positive(concentrationMgPerMl)) return null;
  return round2(ml * concentrationMgPerMl);
}

export function mlFromMg(mg: number | null | undefined, concentrationMgPerMl: number | null | undefined): number | null {
  if (mg == null || !Number.isFinite(mg) || mg < 0 || !positive(concentrationMgPerMl)) return null;
  return toDrawableMl(mg / concentrationMgPerMl);
}

export function mgFromPills(pills: number | null | undefined, strengthMgPerUnit: number | null | undefined): number | null {
  if (pills == null || !Number.isFinite(pills) || pills < 0 || !positive(strengthMgPerUnit)) return null;
  return round2(pills * strengthMgPerUnit);
}

/** The partial-pill fractions the dose form offers, in order. */
export const PILL_FRACTIONS: readonly { label: string; value: number }[] = [
  { label: '¼', value: 1 / 4 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 1 / 2 },
  { label: '⅔', value: 2 / 3 },
  { label: '¾', value: 3 / 4 },
];

/** How close a count must be to a whole + offered fraction to be read as that count. */
const PILL_TOLERANCE = 0.02;

/**
 * Split a pill count into its whole part and one of PILL_FRACTIONS (fraction 0 = none), or null
 * when it is not within PILL_TOLERANCE of any such count.
 */
export function splitPillCount(pills: number): { whole: number; fraction: number } | null {
  if (!Number.isFinite(pills) || pills < 0) return null;
  let whole = Math.floor(pills);
  let rest = pills - whole;
  if (rest > 1 - PILL_TOLERANCE) {
    whole += 1;
    rest = 0;
  }
  if (rest < PILL_TOLERANCE) return { whole, fraction: 0 };
  const match = PILL_FRACTIONS.find((f) => Math.abs(rest - f.value) < PILL_TOLERANCE);
  return match ? { whole, fraction: match.value } : null;
}

/**
 * The pill count that mg amounts to, snapped to a whole number plus an offered fraction — or null
 * when it doesn't land near one, rather than a count that would misstate the dose.
 */
export function pillsFromMg(mg: number | null | undefined, strengthMgPerUnit: number | null | undefined): number | null {
  if (mg == null || !Number.isFinite(mg) || mg < 0 || !positive(strengthMgPerUnit)) return null;
  const split = splitPillCount(mg / strengthMgPerUnit);
  return split ? split.whole + split.fraction : null;
}

/** "1 ½", "⅓", "2" — the decimal itself for anything that isn't a whole plus an offered fraction. */
export function formatPillCount(pills: number): string {
  const split = splitPillCount(pills);
  if (!split) return `${round2(pills)}`;
  const frac = PILL_FRACTIONS.find((f) => f.value === split.fraction)?.label ?? '';
  if (!frac) return `${split.whole}`;
  return split.whole ? `${split.whole} ${frac}` : frac;
}

/** The embodiment figures the conversion needs; both may be null (creams, unit type "other"). */
export interface DoseAmountEmbodiment {
  concentrationMgPerMl: number | null;
  strengthMgPerUnit: number | null;
}

/**
 * The mg a dose amounts to when it was given as a volume or a pill count: mL first, then pills.
 * The single derivation the API saves and the dose-checks preview judges (api.md → Interventions).
 */
export function deriveAmountMg(
  embodiment: DoseAmountEmbodiment | null | undefined,
  amounts: { amountMl?: number | null; pillCount?: number | null },
): number | null {
  if (!embodiment) return null;
  return (
    mgFromMl(amounts.amountMl, embodiment.concentrationMgPerMl) ??
    mgFromPills(amounts.pillCount, embodiment.strengthMgPerUnit)
  );
}

/** Below this fraction of a `underDose: 'flagged'` guideline's dose, a dose is `below_full_dose`. */
export const FULL_DOSE_MARGIN = 0.9;
