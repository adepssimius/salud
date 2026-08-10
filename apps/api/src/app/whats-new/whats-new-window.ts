import { SQL, and, eq, gt, gte } from 'drizzle-orm';
import { advisories, interventions, observations } from '../../db/schema';

/**
 * The boundary rules for "what changed since this caregiver last looked" (api.md → While You Were
 * Asleep), factored out so the two consumers can't drift apart:
 *
 *   - `WhatsNewService` — the per-patient endpoint, which returns the hydrated diff
 *   - `TimelineService.getDashboard` — the multi-patient dashboard, which returns only counts
 *
 * They genuinely can't share an *implementation* (one needs rows, one needs a scalar), but the
 * definitions below are the whole reason they agree. If the dashboard card says "3 new events" and
 * the page then shows 4, a caregiver stops trusting both — so these live in exactly one place.
 *
 * Deliberately NOT a Nest provider. `WhatsNewModule` imports `TimelineModule`, so anything in
 * WhatsNew's provider set that Timeline needed would invert that edge into a module cycle. A plain
 * module has no Nest graph to tangle (cf. `persistence/paths.ts`, `storage/storage.config.ts`).
 */

/** Window used when a caregiver has never acknowledged a briefing for this patient. */
export const FALLBACK_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * The watermark: this caregiver's own `lastSeenAt` for this patient, or the last 24 hours when they
 * have never acked. Per-(patient, user), not per-user — two caregivers on the same patient have
 * independent watermarks.
 */
export function whatsNewSince(lastSeenAt: number | null, nowTs: number): number {
  return lastSeenAt ?? nowTs - FALLBACK_WINDOW_SECONDS;
}

/**
 * Observations since the watermark, on **log** time (`createdAt`), inclusive.
 *
 * Log rather than clinical time because of what this feature is for: "what happened that I haven't
 * seen". A 2 AM observation written up at 6 AM is unseen by the caregiver who last looked at 5 AM,
 * whatever its `observedAt` says — and selecting on clinical time made exactly that entry
 * invisible, in the handoff the feature exists to cover (ISSUES #16).
 *
 * **This must stay on the same column as `WhatsNewService`'s `getTimeline({ sinceCreatedAt })`.**
 * These two feed the dashboard card's `eventCount` and the WYWA page's `events` respectively, and
 * `dashboard.e2e-spec.ts` asserts the two agree. Move one, move the other.
 *
 * Selection and display are now different axes: entries still show and sort by clinical time, so a
 * 6 AM briefing can legitimately contain an entry stamped 2 AM, in 2 AM's position.
 *
 * Inclusive `>=` here vs. strict `>` on advisories below is deliberate, not an oversight — it
 * matches observations.service / interventions.service, whose filters drop rows when `ts < from`.
 */
export function observationsSince(patientId: string, since: number): SQL | undefined {
  return and(eq(observations.patientId, patientId), gte(observations.createdAt, new Date(since * 1000)));
}

/** Interventions since the watermark, on log time (`createdAt`). See `observationsSince`. */
export function interventionsSince(patientId: string, since: number): SQL | undefined {
  return and(eq(interventions.patientId, patientId), gte(interventions.createdAt, new Date(since * 1000)));
}

/**
 * Advisories since the watermark — **every** type, and **including acknowledged ones**.
 *
 * Two things differ from the event predicates above, both on purpose:
 *   - `createdAt` (when the row was written), not a clinical timestamp. An advisory has no clinical
 *     time of its own; it fires when it fires. The event predicates above now key on `createdAt`
 *     too, so all three finally agree on one clock.
 *   - strict `>` rather than `>=`.
 *
 * Counted separately from events rather than read off the timeline: `getTimeline` merges only
 * `protocol_fired` advisories into its entries, so counting "whatever the timeline returns" would
 * both miss the other advisory types and double-count that one. No producer of `protocol_fired`
 * exists yet, so no test can catch a regression here — hence the comment.
 */
export function advisoriesSince(patientId: string, since: number): SQL | undefined {
  return and(eq(advisories.patientId, patientId), gt(advisories.createdAt, new Date(since * 1000)));
}

/**
 * Whether a schedule counts as due right now.
 *
 * Present-tense and watermark-independent: what's due *now* is a fact about the clock, not about
 * when this caregiver last looked, so a schedule due at 5:58 shouldn't vanish from a 6:00 briefing
 * (api.md → While You Were Asleep).
 *
 * Note the `<=`. `DashboardUpcomingSchedule.overdue` uses a strict `<`, so this is one second wider
 * and the two are NOT interchangeable — never derive a due-now count by counting `overdue: true`.
 */
export function isNowDue(nextDueAt: number | null, nowTs: number): boolean {
  return nextDueAt != null && nextDueAt <= nowTs;
}
