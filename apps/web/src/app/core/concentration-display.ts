// How an embodiment's concentration is written out, in one place, because it is read in three:
// the medication catalog's embodiment list and the embodiment pickers on dose entry and reaction
// entry. A caregiver checking the app against the bottle in their hand should see the bottle's own
// words (frontend.md → "Medication catalog").
import { MedicationEmbodiment } from '@salud/shared/types';

type ConcentrationFields = Pick<
  MedicationEmbodiment,
  'concentrationMgPerMl' | 'concentrationMg' | 'concentrationVolumeMl'
>;

/**
 * `160 mg / 5 mL (32 mg/mL)` when the printed pair is on file, `32 mg/mL` when it isn't — or when
 * the pair is per single mL, where the parenthetical would just repeat itself. Null when the
 * embodiment has no concentration at all (tablets, capsules).
 */
export function concentrationText(e: ConcentrationFields): string | null {
  const perMl = e.concentrationMgPerMl;
  if (perMl == null) return null;
  const mg = e.concentrationMg;
  const ml = e.concentrationVolumeMl;
  if (mg == null || ml == null || ml === 1) return `${perMl} mg/mL`;
  return `${mg} mg / ${ml} mL (${perMl} mg/mL)`;
}
