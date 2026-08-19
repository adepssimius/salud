import { inArray } from 'drizzle-orm';
import { medications } from '../../db/schema';

/**
 * A medication's classification tags, read from the catalog rather than from anything stored on
 * the event that used it (data-model.md → ChartOverlayDefault; api.md → Interventions).
 *
 * `medications.tags` is a text column holding a JSON array, like every other JSON-in-text column
 * here. A malformed or absent blob reads as no tags rather than throwing: a dose whose medication
 * has unreadable tags should still render, just without its chart overlay treatment.
 */
export function parseMedicationTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Tags for many medications in one query — the batched shape every caller needs, since the
 * alternative is one catalog lookup per dose in a timeline. Ids with no catalog row are simply
 * absent from the map; callers treat that as no tags.
 */
export async function medicationTagsByIds(db: any, ids: Iterable<string>): Promise<Map<string, string[]>> {
  const unique = [...new Set([...ids].filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db.select().from(medications).where(inArray(medications.id, unique));
  return new Map<string, string[]>(rows.map((row: any) => [row.id, parseMedicationTags(row.tags)]));
}

/**
 * Does this medication's tag set match any of the tags a chart defaults to showing?
 *
 * Exact match, the same rule `GET .../timeline?medicationTag=` uses — the catalog's tags are
 * short controlled strings a household types once, not free prose to fuzzy-match.
 */
export function matchesOverlayTags(tags: string[], overlayTags: Iterable<string>): boolean {
  const wanted = overlayTags instanceof Set ? overlayTags : new Set(overlayTags);
  return tags.some((tag) => wanted.has(tag));
}
