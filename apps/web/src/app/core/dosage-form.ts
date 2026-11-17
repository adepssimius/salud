import { DosageForm, MedicationUnitType } from '@salud/shared/types';

/** How each dosage form reads in a picker or a pill (data-model.md → MedicationEmbodiment). */
export const DOSAGE_FORM_LABELS: Readonly<Record<DosageForm, string>> = {
  liquid: 'Liquid',
  tablet: 'Tablet',
  chewable: 'Chewable tablet',
  capsule: 'Capsule',
  drops: 'Drops',
  cream: 'Cream',
  ointment: 'Ointment',
  gel: 'Gel',
  other: 'Other',
};

/** A unit type in words, for a row whose form was never recorded. */
export const UNIT_TYPE_LABELS: Readonly<Record<MedicationUnitType, string>> = {
  tablet: 'counted in tablets',
  capsule: 'counted in capsules',
  ml: 'measured in mL',
  drop: 'counted in drops',
  other: 'other unit',
};
