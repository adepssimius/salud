import { eq } from 'drizzle-orm';
import { observationEntries } from '../../db/schema';

/**
 * What still points at an analyte. A plain non-provider module, following the
 * `catalog-dependencies.ts` / `whats-new-window.ts` precedent.
 *
 * **Deliberately narrower than `medicationDependencies`.** That one blocks on a medication's own
 * embodiments and guidelines, because each of those is itself checked against logged doses. An
 * analyte's reference ranges and goals have no such referents — nothing records a range id — so
 * blocking on them would make deleting a mistakenly-created analyte a pointless two-step. Only
 * recorded measurements block; the analyte's own ranges and goals go with it (data-model.md →
 * "Analyte catalog").
 */
export type DependencyCounts = Record<string, number>;

function nonZero(counts: DependencyCounts): DependencyCounts {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

/**
 * `observation_entries.metadata` is JSON in a text column, so there is no indexable predicate for
 * "lab results referencing this analyte". Scanning the lab_result rows in JS follows
 * `countInterventionsByMetadata`'s shape, and is acceptable at household scale for the same reason.
 */
export async function analyteDependencies(db: any, analyteId: string): Promise<DependencyCounts> {
  const rows = await db
    .select({ metadata: observationEntries.metadata })
    .from(observationEntries)
    .where(eq(observationEntries.type, 'lab_result'));
  let labResults = 0;
  for (const row of rows) {
    if (!row.metadata) continue;
    try {
      if (JSON.parse(row.metadata)?.analyteId === analyteId) labResults += 1;
    } catch {
      // A row whose metadata doesn't parse can't be referencing anything; skip rather than fail
      // the whole delete on one corrupt blob.
    }
  }
  return nonZero({ labResults });
}
