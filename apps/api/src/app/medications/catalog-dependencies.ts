import { eq } from 'drizzle-orm';
import {
  adverseReactions,
  advisories,
  interventionSchedules,
  interventions,
  medicationEmbodiments,
  medicationGuidelines,
} from '../../db/schema';

/**
 * What still points at a catalog row. A plain non-provider module, following the
 * `whats-new-window.ts` precedent.
 *
 * Deleting a medication blocks on its *own* embodiments and guidelines rather than cascading
 * through them. That is deliberate: it produces an accurate dependent list, and it pushes the
 * caller down the tree where each child is itself checked against doses already logged. A cascade
 * would quietly destroy the dosing reference data a logged dose was measured against.
 */
export type DependencyCounts = Record<string, number>;

/** Only non-zero entries, so the response body says what's actually in the way. */
function nonZero(counts: DependencyCounts): DependencyCounts {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

/**
 * `interventions.metadata` is JSON in a text column, so there is no indexable predicate for
 * "doses referencing this id". Parsing every row in JS follows the shape already used elsewhere in
 * InterventionsService.
 *
 * O(all interventions), and acceptable only at household scale. If it ever stops being, the answer
 * is a real column — not a LIKE against the JSON text, whose key ordering is stable today but is
 * not a contract.
 */
async function countInterventionsByMetadata(
  db: any,
  key: 'medicationId' | 'medicationEmbodimentId' | 'guidelineId',
  value: string,
): Promise<number> {
  const rows = await db.select({ metadata: interventions.metadata }).from(interventions);
  let count = 0;
  for (const row of rows) {
    if (!row.metadata) continue;
    try {
      if (JSON.parse(row.metadata)?.[key] === value) count += 1;
    } catch {
      // A row whose metadata doesn't parse can't be referencing anything; skip rather than fail
      // the whole delete on one corrupt blob.
    }
  }
  return count;
}

export async function medicationDependencies(db: any, medicationId: string): Promise<DependencyCounts> {
  const [embodiments, guidelines, reactions, schedules, doses] = await Promise.all([
    db.select({ id: medicationEmbodiments.id }).from(medicationEmbodiments).where(eq(medicationEmbodiments.medicationId, medicationId)),
    db.select({ id: medicationGuidelines.id }).from(medicationGuidelines).where(eq(medicationGuidelines.medicationId, medicationId)),
    db.select({ id: adverseReactions.id }).from(adverseReactions).where(eq(adverseReactions.medicationId, medicationId)),
    db.select({ id: interventionSchedules.id }).from(interventionSchedules).where(eq(interventionSchedules.medicationId, medicationId)),
    countInterventionsByMetadata(db, 'medicationId', medicationId),
  ]);
  return nonZero({
    embodiments: embodiments.length,
    guidelines: guidelines.length,
    reactions: reactions.length,
    schedules: schedules.length,
    interventions: doses,
  });
}

export async function embodimentDependencies(db: any, embodimentId: string): Promise<DependencyCounts> {
  const [guidelines, reactions, schedules, doses] = await Promise.all([
    db.select({ id: medicationGuidelines.id }).from(medicationGuidelines).where(eq(medicationGuidelines.medicationEmbodimentId, embodimentId)),
    db.select({ id: adverseReactions.id }).from(adverseReactions).where(eq(adverseReactions.embodimentId, embodimentId)),
    db.select({ id: interventionSchedules.id }).from(interventionSchedules).where(eq(interventionSchedules.medicationEmbodimentId, embodimentId)),
    countInterventionsByMetadata(db, 'medicationEmbodimentId', embodimentId),
  ]);
  return nonZero({
    guidelines: guidelines.length,
    reactions: reactions.length,
    schedules: schedules.length,
    interventions: doses,
  });
}

export async function guidelineDependencies(db: any, guidelineId: string): Promise<DependencyCounts> {
  const [sourced, doses] = await Promise.all([
    db.select({ id: advisories.id }).from(advisories).where(eq(advisories.sourceId, guidelineId)),
    countInterventionsByMetadata(db, 'guidelineId', guidelineId),
  ]);
  return nonZero({
    advisories: sourced.length,
    interventions: doses,
  });
}
