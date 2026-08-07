import { LengthUnit, TempUnit, TimelineEntry, UserProfile, WeightUnit } from '@salud/shared/types';

// Human-readable formatting for observation entries and timeline events.
//
// Two rules shape everything here:
//  - Values are stored canonically (kg, cm, bpm, %) except temperature, which keeps the unit it was
//    entered in. Display converts to the viewer's preference — product.md:49, "User preference
//    defines display unit; graphs normalize to the preferred unit."
//  - Preferences are OPTIONAL. The public /brief/:token route has no signed-in viewer, so every
//    function falls back to canonical units rather than assuming a user exists.

export interface DisplayUnits {
  temp: TempUnit;
  weight: WeightUnit;
  length: LengthUnit;
}

export const CANONICAL_UNITS: DisplayUnits = { temp: 'C', weight: 'kg', length: 'cm' };

export function unitsFor(user: UserProfile | null | undefined): DisplayUnits {
  if (!user) return CANONICAL_UNITS;
  return {
    temp: user.preferredTempUnit ?? 'C',
    weight: user.preferredWeightUnit ?? 'kg',
    length: user.preferredLengthUnit ?? 'cm',
  };
}

const LB_PER_KG = 2.2046226218;
const KG_PER_ST = 6.35029318;
const CM_PER_IN = 2.54;

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Convert a temperature from the unit it was recorded in to the unit to display it in. */
export function convertTemp(value: number, from: TempUnit, to: TempUnit): number {
  if (from === to) return round(value, 1);
  return to === 'F' ? round((value * 9) / 5 + 32, 1) : round(((value - 32) * 5) / 9, 1);
}

/** Canonical kg → the display unit. */
export function fromKg(kg: number, to: WeightUnit): number {
  if (to === 'lb') return round(kg * LB_PER_KG, 1);
  if (to === 'st') return round(kg / KG_PER_ST, 2);
  return round(kg, 2);
}

/** Canonical cm → the display unit. */
export function fromCm(cm: number, to: LengthUnit): number {
  return to === 'in' ? round(cm / CM_PER_IN, 1) : round(cm, 1);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && !isNaN(v);

/**
 * One observation entry as a short human phrase — "Temp 101.2 °F (oral)", "11.34 kg", "Pain 7/10".
 * Replaces the raw `JSON.stringify(metadata)` that used to reach caregivers and triage staff.
 */
export function entrySummary(
  entry: { type: string; metadata?: any },
  units: DisplayUnits = CANONICAL_UNITS,
): string {
  const m = entry.metadata ?? {};
  const note = m.note ? ` — ${m.note}` : '';

  switch (entry.type) {
    case 'temperature': {
      if (!isNum(m.value)) return `Temp —${note}`;
      // Stored as entered, so the recorded unit is the source, not an assumption.
      const from: TempUnit = m.unit === 'F' ? 'F' : 'C';
      const shown = convertTemp(m.value, from, units.temp);
      const method = m.method && m.method !== 'unknown' ? ` (${m.method})` : '';
      return `Temp ${shown} °${units.temp}${method}${note}`;
    }
    case 'heart_rate':
      return `HR ${m.bpm ?? '—'} bpm${note}`;
    case 'respiratory_rate':
      return `RR ${m.breathsPerMin ?? '—'} breaths/min${note}`;
    case 'oxygen_saturation':
      return `SpO2 ${m.percent ?? '—'}%${note}`;
    case 'pain_score':
      return `Pain ${m.score ?? '—'}/10${note}`;
    case 'weight':
      return isNum(m.kg) ? `${fromKg(m.kg, units.weight)} ${units.weight}${note}` : `Weight —${note}`;
    case 'height':
      return isNum(m.cm) ? `${fromCm(m.cm, units.length)} ${units.length}${note}` : `Height —${note}`;
    case 'lesion_size': {
      const dims = [m.lengthCm, m.widthCm, m.depthCm]
        .filter(isNum)
        .map((v) => fromCm(v, units.length))
        .join(' × ');
      const side = m.side && m.side !== 'n/a' ? ` (${m.side})` : '';
      const where = m.bodyLocation ? ` · ${m.bodyLocation}` : '';
      return `${dims || '—'} ${units.length}${where}${side}${note}`;
    }
    case 'symptom':
      return `${m.tag ?? '—'}${m.severity ? ` — ${m.severity}` : ''}${note}`;
    case 'tag':
      return `#${m.tag ?? '—'}${note}`;
    case 'note': {
      const text: string = m.text ?? '';
      return text.length > 60 ? `${text.slice(0, 60)}…` : text;
    }
    case 'photo': {
      // The image itself is rendered separately; this is the caption beside it.
      const side = m.side && m.side !== 'n/a' ? ` (${m.side})` : '';
      const size = isNum(m.sizeCm) ? ` · ${fromCm(m.sizeCm, units.length)} ${units.length}` : '';
      return `photo${m.bodyLocation ? ` · ${m.bodyLocation}` : ''}${side}${size}${note}`;
    }
    default:
      return entry.type;
  }
}

/** A whole timeline event (observation, intervention, or advisory) as one line. */
export function describeEvent(entry: TimelineEntry, units: DisplayUnits = CANONICAL_UNITS): string {
  const display = entry.display as any;

  if (entry.kind === 'observation') {
    const parts = (display.entries ?? [])
      .filter((e: any) => e.type !== 'photo') // photos render as thumbnails instead
      .map((e: any) => entrySummary(e, units));
    return [display.text, ...parts].filter(Boolean).join(' — ');
  }

  if (entry.kind === 'intervention') {
    if (display.type === 'medication_dose') {
      const mg = display.metadata?.amountMg;
      const atypical = display.metadata?.isAtypical ? ' (atypical)' : '';
      return `medication dose — ${mg ?? '?'} mg${atypical}`;
    }
    return `dressing change${display.metadata?.bodyLocation ? ` — ${display.metadata.bodyLocation}` : ''}`;
  }

  return display.type;
}

/** File ids of any photo entries on a timeline event, for rendering thumbnails. */
export function photoFileIds(entry: TimelineEntry): string[] {
  if (entry.kind !== 'observation') return [];
  const display = entry.display as any;
  return (display.entries ?? [])
    .filter((e: any) => e.type === 'photo' && e.metadata?.fileId)
    .map((e: any) => e.metadata.fileId as string);
}
