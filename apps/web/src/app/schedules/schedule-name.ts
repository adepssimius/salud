import { DosageForm, MedicationUnitType, TOPICAL_DOSAGE_FORMS, formatPillCount } from '@salud/shared/types';

// The schedule name the form prefills — what a nurse would call it, so it is recognisable at a
// glance where the ER Brief lists schedules (frontend.md → New schedule form → "The name").
//
//   500 mg Acetaminophen q6h
//   160 mg (5 mL) Acetaminophen q6h
//   Clotrimazole 1% cream q12h            (a topical form: the embodiment names it, no amount)
//   500 mg Acetaminophen BID (08:00, 20:00)
//   Dressing change, left knee daily
//
// Frequency: an interval reads `qNh`, except every 24 h, which reads "daily". Fixed times read
// daily / BID / TID / QID by how many a day, then the times; five or more read "at …". Nothing is
// invented: a part the form has no value for is left out.

export interface ScheduleNameInput {
  type: 'medication_dose' | 'dressing_change';
  medicationName?: string | null;
  embodiment?: { label: string; dosageForm?: DosageForm | null; unitType?: MedicationUnitType | null } | null;
  doseMg?: number | null;
  doseMl?: number | null;
  pillCount?: number | null;
  frequencyHours?: number | null;
  explicitTimes?: string[] | null;
  bodyLocation?: string | null;
  side?: string | null;
}

const PER_DAY: Record<number, string> = { 1: 'daily', 2: 'BID', 3: 'TID', 4: 'QID' };

const trimNum = (n: number) => String(Math.round(n * 100) / 100);

export function frequencyPhrase(frequencyHours?: number | null, explicitTimes?: string[] | null): string {
  const times = (explicitTimes ?? []).map((t) => t.trim()).filter(Boolean);
  if (times.length) {
    const sorted = [...times].sort();
    const word = PER_DAY[sorted.length];
    return word ? `${word} (${sorted.join(', ')})` : `at ${sorted.join(', ')}`;
  }
  if (frequencyHours) return frequencyHours === 24 ? 'daily' : `q${trimNum(frequencyHours)}h`;
  return '';
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "2 tablets", "1 capsule", "3 drops" — the count in the embodiment's own unit. */
function countPhrase(count: number, unitType?: MedicationUnitType | null, form?: DosageForm | null): string {
  const one = count === 1;
  const unit =
    form === 'chewable' ? (one ? 'chewable' : 'chewables')
      : unitType === 'capsule' || form === 'capsule' ? (one ? 'capsule' : 'capsules')
        : unitType === 'drop' || form === 'drops' ? (one ? 'drop' : 'drops')
          : one ? 'tablet' : 'tablets';
  return `${formatPillCount(count)} ${unit}`;
}

function sidePrefix(location: string, side?: string | null): string {
  if (!side || side === 'n/a' || location.toLowerCase().includes(side)) return location;
  return `${side} ${location}`;
}

export function scheduleName(input: ScheduleNameInput): string {
  const freq = frequencyPhrase(input.frequencyHours, input.explicitTimes);

  if (input.type === 'dressing_change') {
    const where = input.bodyLocation?.trim() ? `, ${sidePrefix(input.bodyLocation.trim(), input.side)}` : '';
    return [`Dressing change${where}`, freq].filter(Boolean).join(' ');
  }

  const name = capitalize(input.medicationName?.trim() ?? '');
  if (!name) return '';
  const form = input.embodiment?.dosageForm ?? null;
  const topical = !!form && TOPICAL_DOSAGE_FORMS.includes(form);

  // The volume belongs in the name only for something measured in mL: a liquid, or an embodiment
  // that says nothing of its kind. A tablet can carry an mL from a liquid guideline's "Use this",
  // and "320 mg (10 mL)" would then misdescribe the tablet.
  const kindless = !input.embodiment || (!form && !input.embodiment.unitType);
  const liquid = kindless || form === 'liquid' || (!form && input.embodiment?.unitType === 'ml');

  let dose = '';
  if (input.doseMg != null) {
    dose = `${trimNum(input.doseMg)} mg`;
    if (input.doseMl != null && liquid) dose += ` (${trimNum(input.doseMl)} mL)`;
  } else if (input.doseMl != null && liquid) {
    dose = `${trimNum(input.doseMl)} mL`;
  } else if (input.pillCount != null) {
    dose = countPhrase(input.pillCount, input.embodiment?.unitType, form);
  }

  // A cream is told apart by what it is, not how much: "Clotrimazole 1% cream".
  const what = topical && input.embodiment?.label ? `${name} ${input.embodiment.label}` : name;
  return [dose, what, freq].filter(Boolean).join(' ');
}

/**
 * "N times a day" laid out across the waking day, 08:00 to 20:00, to the quarter hour — the
 * prefill a caregiver edits, not a rule: 1 → 08:00; 2 → 08:00, 20:00; 3 → 08:00, 14:00, 20:00;
 * 4 → 08:00, 12:00, 16:00, 20:00.
 */
export function defaultDailyTimes(n: number): string[] {
  if (n < 1) return [];
  if (n === 1) return ['08:00'];
  return Array.from({ length: n }, (_, i) => {
    const minutes = Math.round((8 * 60 + (12 * 60 * i) / (n - 1)) / 15) * 15;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });
}
