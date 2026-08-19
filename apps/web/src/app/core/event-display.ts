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
  entry: { type: string; metadata?: any; labContext?: any },
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
    case 'lab_result': {
      // Stored as reported, never converted (data-model.md → "Lab report import"); the flag is
      // only ever what the report printed. The catalog's display name comes from labContext when
      // the entry has been hydrated, and falls back to the lab's printed name when it hasn't.
      const name = entry.labContext?.displayName ?? m.analyte ?? '—';
      const unit = m.unit ? ` ${m.unit}` : '';
      const flag = m.flag ? ` (${m.flag})` : '';
      return `${name} ${m.valueText ?? '—'}${unit}${flag}${note}`;
    }
    case 'document':
      return `document${m.label ? ` · ${m.label}` : ''}${note}`;
    default:
      return entry.type;
  }
}

/** Entry types as a human label — the row heading beside `entrySummary`'s value on a detail page. */
const ENTRY_TYPE_LABELS: Record<string, string> = {
  temperature: 'Temperature',
  heart_rate: 'Heart rate',
  respiratory_rate: 'Respiratory rate',
  oxygen_saturation: 'Oxygen saturation',
  pain_score: 'Pain score',
  weight: 'Weight',
  height: 'Height',
  lesion_size: 'Lesion size',
  symptom: 'Symptom',
  note: 'Note',
  tag: 'Tag',
  photo: 'Photo',
  lab_result: 'Lab result',
  document: 'Document',
};

/**
 * "Lesion size" for `lesion_size`. An unknown type falls back to its own name with the underscores
 * opened up, so a type added to the API before this map reads as words rather than as a blank.
 */
export function entryTypeLabel(type: string): string {
  return ENTRY_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

/**
 * One line summarizing a set of lab_result entries — "Labs: 30 results, 1 low" — from printed
 * flags only. A full panel must never render as 30 timeline lines (frontend.md → Timeline).
 */
export function labSummary(labEntries: Array<{ metadata?: any }>): string {
  const low = labEntries.filter((e) => e.metadata?.flag === 'L').length;
  const high = labEntries.filter((e) => e.metadata?.flag === 'H').length;
  const parts = [`Labs: ${labEntries.length} result${labEntries.length === 1 ? '' : 's'}`];
  if (low) parts.push(`${low} low`);
  if (high) parts.push(`${high} high`);
  return parts.join(', ');
}

/**
 * Caller-supplied context for `describeEvent`. Both fields are optional and both default to the
 * behavior every caller had before they existed — a page opts in, nothing changes underneath one
 * that doesn't.
 */
export interface DescribeEventOptions {
  /**
   * Medication display names by id. With it, a dose reads "240 mg ibuprofen" — the attributed
   * journal line the product describes (frontend.md → Journal, "Dana — 240 mg ibuprofen · 2:15
   * AM"). Without it, the generic "medication dose — 240 mg" stands, since the id alone is not
   * something to show a caregiver.
   */
  medicationNames?: Map<string, string>;
  /**
   * Drop `document` entries from the text. The journal feed renders them as labeled attachment
   * links instead (frontend.md → Documents), so repeating them in the summary line would say the
   * same thing twice; a caller with no link affordance keeps the text and stays whole.
   */
  omitDocuments?: boolean;
}

/** A whole timeline event (observation, intervention, or advisory) as one line. */
export function describeEvent(
  entry: TimelineEntry,
  units: DisplayUnits = CANONICAL_UNITS,
  options: DescribeEventOptions = {},
): string {
  const display = entry.display as any;

  if (entry.kind === 'observation') {
    const entries: any[] = display.entries ?? [];
    const labs = entries.filter((e) => e.type === 'lab_result');
    const parts = entries
      .filter((e) => e.type !== 'photo') // photos render as thumbnails instead
      .filter((e) => e.type !== 'lab_result') // aggregated below — never one line per analyte
      .filter((e) => !(options.omitDocuments && e.type === 'document')) // rendered as links instead
      .map((e) => entrySummary(e, units));
    if (labs.length) parts.unshift(labSummary(labs));
    return [display.text, ...parts].filter(Boolean).join(' — ');
  }

  if (entry.kind === 'intervention') {
    if (display.type === 'medication_dose') {
      const mg = display.metadata?.amountMg;
      const atypical = display.metadata?.isAtypical ? ' (atypical)' : '';
      const name = options.medicationNames?.get(display.metadata?.medicationId);
      return name ? `${mg ?? '?'} mg ${name}${atypical}` : `medication dose — ${mg ?? '?'} mg${atypical}`;
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

/**
 * Document entries on a timeline event, as `{ fileId, label }` for rendering attachment links
 * (frontend.md → Documents: "a labeled attachment link, not a text summary line"). The label falls
 * back to the file's original name, and then to a generic word, so a link is never blank.
 */
export function documentAttachments(entry: TimelineEntry): Array<{ fileId: string; label: string }> {
  if (entry.kind !== 'observation') return [];
  const display = entry.display as any;
  return (display.entries ?? [])
    .filter((e: any) => e.type === 'document' && e.metadata?.fileId)
    .map((e: any) => ({
      fileId: e.metadata.fileId as string,
      label: (e.metadata.label ?? e.metadata.originalName ?? 'document') as string,
    }));
}
