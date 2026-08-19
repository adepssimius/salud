import { randomUUID } from 'crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { VitalMetric } from '@salud/shared/types';
import { analyteRanges, analytes } from '../../db/schema';

/**
 * The five vital signs, as seeded rows in the analyte catalog.
 *
 * A vital is a measured quantity read against a named band, which is exactly what an analyte is —
 * so rather than a parallel table with its own endpoints and its own management screen, the vitals
 * are catalog rows and `analyte_ranges` carries their bands unchanged (data-model.md → "Analyte
 * catalog"). "What counts as a normal temperature for this child" is then configured with the same
 * Ranges UI, in the same words, as a ferritin reference range.
 *
 * `unit` is the **canonical** unit for the metric, matching the canonical-units rule at the
 * persistence boundary: the bands are stored in these units and converted for display, like the
 * temperature points they are drawn behind.
 */
export const VITAL_ANALYTES: ReadonlyArray<{
  vitalMetric: VitalMetric;
  name: string;
  displayName: string;
  unit: string;
}> = [
  { vitalMetric: 'temperature', name: 'TEMPERATURE', displayName: 'Temperature', unit: 'C' },
  { vitalMetric: 'heart_rate', name: 'HEART RATE', displayName: 'Heart Rate', unit: 'bpm' },
  { vitalMetric: 'respiratory_rate', name: 'RESPIRATORY RATE', displayName: 'Respiratory Rate', unit: 'breaths/min' },
  { vitalMetric: 'oxygen_saturation', name: 'OXYGEN SATURATION', displayName: 'Oxygen Saturation', unit: '%' },
  { vitalMetric: 'pain_score', name: 'PAIN SCORE', displayName: 'Pain Score', unit: '0-10' },
];

/**
 * The temperature band a patient starts with, in canonical °C.
 *
 * This is the one place the app supplies a clinical number rather than a caregiver, and it earns
 * that only by being **seeded as data the household owns**: the row is editable, and deleting it is
 * permanent. Nothing re-seeds it and nothing substitutes it at render time, so a care team that
 * disagrees with these bounds changes them once and the charts follow (P6 — the app renders what
 * was recorded, it does not assert a norm while drawing).
 *
 * `source` says plainly that this came from the app, so a reader can tell it apart from a number a
 * clinician gave the family.
 */
export const SEEDED_TEMPERATURE_RANGE = {
  label: 'Normal',
  kind: 'reference' as const,
  low: 36.1,
  high: 37.2,
  source: 'Salud default — typical body temperature, edit for this patient',
};

/**
 * Insert any vital catalog rows that don't exist yet, and hand back every vital's id by metric.
 *
 * Idempotent and keyed on `vital_metric` rather than on `name`, so a household that already had an
 * ordinary lab analyte literally called "TEMPERATURE" (from a report that printed one) keeps it
 * untouched and gets a separate vital row — the two are different things and the importer must
 * never bind a printed line onto the row driving the fever charts.
 */
export async function ensureVitalAnalytes(db: any): Promise<Map<VitalMetric, string>> {
  const existing = await db.select().from(analytes).where(isNotNull(analytes.vitalMetric));
  const byMetric = new Map<VitalMetric, string>(
    existing.filter((r: any) => r.vitalMetric).map((r: any) => [r.vitalMetric as VitalMetric, r.id as string]),
  );

  for (const vital of VITAL_ANALYTES) {
    if (byMetric.has(vital.vitalMetric)) continue;
    const id = randomUUID();
    await db.insert(analytes).values({
      id,
      name: vital.name,
      displayName: vital.displayName,
      unit: vital.unit,
      panel: null,
      vitalMetric: vital.vitalMetric,
    });
    byMetric.set(vital.vitalMetric, id);
  }
  return byMetric;
}

/**
 * Give a newly created patient its starting temperature band.
 *
 * Called from patient creation and from the one-time backfill tool, and **nowhere else** — that is
 * what makes deleting the band a decision that sticks rather than something the app quietly undoes
 * on the next write. Re-seeding on read, or on boot, would turn an intentional delete into a
 * recurring argument with the software.
 *
 * Idempotent against its own lineage anyway (patient, analyte, kind, label), so the backfill can be
 * run twice without doubling rows.
 */
export async function seedPatientVitalRanges(db: any, patientId: string): Promise<void> {
  const byMetric = await ensureVitalAnalytes(db);
  const analyteId = byMetric.get('temperature');
  if (!analyteId) return;

  const existing = await db
    .select()
    .from(analyteRanges)
    .where(and(eq(analyteRanges.patientId, patientId), eq(analyteRanges.analyteId, analyteId)));
  // Any band at all means this patient's temperature has been configured — by an earlier seed, or
  // by a caregiver. Either way it is not ours to add to.
  if (existing.length) return;

  await db.insert(analyteRanges).values({
    id: randomUUID(),
    analyteId,
    patientId,
    kind: SEEDED_TEMPERATURE_RANGE.kind,
    label: SEEDED_TEMPERATURE_RANGE.label,
    low: SEEDED_TEMPERATURE_RANGE.low,
    high: SEEDED_TEMPERATURE_RANGE.high,
    refText: null,
    // Epoch, not now(): the band is meant to apply to every reading this patient has, including
    // any backfilled from before the row existed. A lineage resolves as "greatest effectiveFrom
    // <= t", so dating it to creation time would leave older readings with nothing in effect.
    effectiveFrom: new Date(0),
    source: SEEDED_TEMPERATURE_RANGE.source,
  });
}
