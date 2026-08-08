/**
 * Timestamp coercions for the persistence boundary.
 *
 * These exist because of `apps/api/src/db/schema.ts` — 44 columns are declared
 * `integer(..., { mode: 'timestamp' })`, and Drizzle maps those through `new Date(value * 1000)` on
 * read while the API's wire format is epoch seconds (CLAUDE.md → Timestamps). Every service needs to
 * cross that boundary, which is why this was independently rewritten in 14 of them before being
 * pulled out here.
 *
 * Deliberately a plain module, not a Nest provider — it has no dependencies and nothing to inject,
 * so keeping it out of the DI graph means any service can import it without a module edge
 * (cf. `paths.ts`, `../storage/storage.config.ts`, `../whats-new/whats-new-window.ts`).
 */

/**
 * A `{ mode: 'timestamp' }` column value as epoch seconds.
 *
 * Accepts `Date | number | null | undefined` — typed `any` because every caller passes a field off a
 * `this.db.db as any` row, and a narrower signature would only add casts at the call sites.
 *
 * **Idempotent on purpose.** Almost every caller passes a `Date` straight off a row, but
 * `timeline.service.ts` re-normalizes a value that another service already converted. Do not
 * "simplify" this to `(value: Date)` — the passthrough branch is load-bearing.
 */
export function normalizeTs(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

/**
 * The inverse: epoch seconds back to a `Date`, for feeding values into Drizzle comparisons or date
 * arithmetic. Passes an existing `Date` through untouched.
 *
 * Returns `null` rather than throwing, so it stays symmetric with `normalizeTs` — a pair that
 * disagrees about null is worse than one that is uniformly permissive. Callers on not-null columns
 * assert with `!`.
 */
export function toDate(value: any): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value * 1000);
}
