import { BadRequestException } from '@nestjs/common';

/**
 * Metadata keys the SERVICE owns, and a client may therefore never write directly.
 *
 * `metadata` is untyped JSON by design (CLAUDE.md → JSON-in-text columns), and a caregiver's client
 * is welcome to park extra keys of its own in there. What it must not do is set the keys this
 * service computes — which, before this guard, it could: `create()` merged `...dto.metadata` LAST,
 * so a request could hand back `isAtypical: false` over the value the dosing engine had just
 * resolved (ISSUES.md #28).
 *
 * Two distinct holes, both closed here:
 *
 * 1. **Erasing the engine's verdict.** `isAtypical`/`atypicalReason`/`nextAllowedAt`/`guidelineId`/
 *    `weightKgUsed`/`ageMonthsUsed` are resolved server-side and are explicitly not client-trusted
 *    (api.md → Interventions). The atypical flag is the permanent trace that a dose didn't follow
 *    guidance (F-2.4) — a client that can clear it erases that trace, and nothing in the record
 *    would show it had ever been set.
 * 2. **Bypassing DTO validation.** `amountMg` and friends are range-checked as top-level DTO
 *    fields; the same value arriving inside `metadata` reached the database unchecked. A negative
 *    `amountMg` there would count toward the daily total that drives `exceeds_max_per_day`.
 *
 * Rejecting rather than silently stripping follows the entry-metadata precedent
 * (`forbidNonWhitelisted` in entry-metadata.dto.ts): a client sending `isAtypical` is confused
 * about who owns it, and dropping the key quietly would leave it believing it had been applied.
 */
export const SERVICE_OWNED_METADATA_KEYS = [
  // Carried on the DTO as validated top-level fields.
  'medicationId',
  'medicationEmbodimentId',
  'doseSource',
  'amountMg',
  'amountMl',
  'pillCount',
  'interventionScheduleId',
  'bodyLocation',
  'side',
  'dressingType',
  // Resolved by the dosing engine, never accepted from a client.
  'weightKgUsed',
  'ageMonthsUsed',
  'guidelineId',
  'nextAllowedAt',
  'isAtypical',
  'atypicalReason',
] as const;

const RESERVED = new Set<string>(SERVICE_OWNED_METADATA_KEYS);

/**
 * Throws 400 `RESERVED_METADATA_KEY` when client-supplied metadata names a key the service owns.
 * The offending keys ride along on the response body, the same way the catalog's `IN_USE`
 * conflicts carry `dependents` (api.md → "Error response shapes").
 */
export function assertNoReservedMetadataKeys(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  const keys = Object.keys(metadata).filter((key) => RESERVED.has(key));
  if (keys.length) throw new BadRequestException({ message: 'RESERVED_METADATA_KEY', keys });
}
