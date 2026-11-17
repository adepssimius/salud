import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  episodes,
  episodesEventsPivot,
  interventionSchedules,
  interventions,
  medicationEmbodiments,
  medications,
  observations,
  patients,
} from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { ActiveEpisodeSummary, Episode, EpisodeMedicationRef, InterventionSchedule } from '@salud/shared/types';
import { episodeIdsBySchedule, scheduleIdsForEpisode, toScheduleView } from '../schedules/schedule-view';

type EpisodeEndType = 'observation' | 'intervention';
export type EpisodeEventType = EpisodeEndType;

/** What `planEventEpisodeCorrection` decided; written by `applyEventEpisodeCorrection`. */
export interface EventEpisodeCorrectionPlan {
  patientId: string;
  eventType: EpisodeEventType;
  eventId: string;
  /** The merged membership / resolve lists the event will have — what the response reports. */
  episodeIds: string[];
  resolvesEpisodeIds: string[];
  /** False when the request sent neither list: the pivot is then left exactly as it is. */
  rewritePivot: boolean;
  pivotRows: Array<{ episodeId: string; startsEpisode: boolean; resolvesEpisode: boolean }>;
  /** Episodes to mark resolved by this event (newly resolved; re-asserting is a no-op). */
  resolveEpisodeIds: string[];
  /** Episodes this event ended whose resolve link the correction drops: back to active. */
  reopenEpisodeIds: string[];
  /** The event's membership before the correction (non-resolving pivot rows). */
  previousEpisodeIds: string[];
  /** The corrected clinical time, epoch seconds; undefined when the time was not sent. */
  clinicalTime?: number;
  /**
   * Start moves for every episode whose membership or member times this correction changes.
   * Empty when planned with `deferAnchors` — the caller then plans them across several plans with
   * `planEpisodeAnchors` and writes them with `applyEpisodeAnchors`.
   */
  anchors: EpisodeAnchorWrite[];
}

const uniq = (ids: string[]): string[] => Array.from(new Set(ids));

export interface EpisodeEventAt {
  type: EpisodeEventType;
  id: string;
  /** Clinical time (`observedAt` / `performedAt`), epoch seconds. */
  time: number;
}

/** Where an episode's start is moved to; written by `applyEpisodeAnchors`. */
export interface EpisodeAnchorWrite {
  episodeId: string;
  startedAtType: EpisodeEventType;
  startedAtId: string;
}

const eventKey = (type: string, id: string) => `${type}:${id}`;

/**
 * An episode starts at its earliest member (data-model.md → "Data integrity rules" → "An episode
 * starts at its earliest entry"). Ties on identical times: the resolving entry sorts after any other
 * entry, then observation before intervention, then id — deterministic, and the order the direct
 * create always used. Null only for an episode with no members.
 */
export function pickEpisodeStart(
  members: EpisodeEventAt[],
  resolver: { type: string; id: string } | null,
): EpisodeEventAt | null {
  const resolverKey = resolver ? eventKey(resolver.type, resolver.id) : null;
  const isResolver = (m: EpisodeEventAt) => (eventKey(m.type, m.id) === resolverKey ? 1 : 0);
  const sorted = [...members].sort(
    (a, b) =>
      a.time - b.time ||
      isResolver(a) - isResolver(b) ||
      (a.type === b.type ? 0 : a.type === 'observation' ? -1 : 1) ||
      a.id.localeCompare(b.id),
  );
  return sorted[0] ?? null;
}

/**
 * The one ordering rule left once the start is the earliest member: a resolved episode may not end
 * at its own start while it has other members — i.e. its resolving entry may not be strictly
 * earlier than every other member (data-model.md → "An episode may not end at its start…").
 */
export function endsAtItsStart(members: EpisodeEventAt[], resolver: { type: string; id: string } | null): boolean {
  if (!resolver || members.length < 2) return false;
  const start = pickEpisodeStart(members, resolver);
  return !!start && start.type === resolver.type && start.id === resolver.id;
}

@Injectable()
export class EpisodesService {
  constructor(private readonly db: DatabaseService) {}

  private async ensurePatientAccess(patientId: string, userId: string) {
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)))
      .limit(1);
    if (!rows.length) {
      throw new NotFoundException('PATIENT_NOT_FOUND');
    }
  }

  async createFromEvent(params: {
    patientId: string;
    userId: string;
    name: string;
    startedAtType: EpisodeEndType;
    startedAtId: string;
    conditionId?: string | null;
    notes?: string | null;
  }) {
    const db = this.db.db as any;
    await this.ensurePatientAccess(params.patientId, params.userId);
    const id = randomUUID();
    await db.insert(episodes).values({
      id,
      patientId: params.patientId,
      conditionId: params.conditionId ?? null,
      name: params.name,
      startedAtType: params.startedAtType,
      startedAtId: params.startedAtId,
      status: 'active',
      notes: params.notes ?? null,
    });
    return id;
  }

  /**
   * Every id must name an episode of *this* patient. Without this an observation on one child can
   * be filed into another child's episode, where it then renders in that child's episode view,
   * timeline and ER Brief (data-model.md → Data integrity rules).
   *
   * Returns the rows, so callers that need them don't re-query.
   */
  async assertEpisodesBelongToPatient(
    patientId: string,
    userId: string,
    episodeIds: string[],
  ): Promise<any[]> {
    if (!episodeIds || !episodeIds.length) return [];
    const db = this.db.db as any;
    await this.ensurePatientAccess(patientId, userId);
    const unique = Array.from(new Set(episodeIds));
    const rows = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.patientId, patientId), inArray(episodes.id, unique)));
    if (rows.length !== unique.length) {
      throw new NotFoundException('EPISODE_NOT_FOUND');
    }
    return rows;
  }

  /**
   * The `resolvesEpisodeIds ⊆ episodeIds` invariant. Lived as a byte-identical private in both
   * ObservationsService and InterventionsService; it belongs in one place, next to the resolve it
   * guards.
   */
  assertResolvesSubset(resolvesEpisodeIds: string[] | undefined, episodeIds: string[] | undefined) {
    if (!resolvesEpisodeIds || !resolvesEpisodeIds.length) return;
    const linked = new Set(episodeIds ?? []);
    for (const id of resolvesEpisodeIds) {
      if (!linked.has(id)) {
        throw new BadRequestException('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');
      }
    }
  }

  async resolveEpisodes(patientId: string, userId: string, episodeIds: string[], endedAtType: EpisodeEndType, endedAtId: string) {
    if (!episodeIds || !episodeIds.length) return;
    const db = this.db.db as any;
    const rows = await this.assertEpisodesBelongToPatient(patientId, userId, episodeIds);

    // Identity-aware, and that carve-out is load-bearing. An update path re-sends the event's
    // existing resolvesEpisodeIds whenever *either* episode field is touched, so a plain
    // "already resolved -> throw" would make `PATCH { episodeIds }` start failing on any event
    // that had ever resolved something. The error is for a *different* event trying to close an
    // episode someone else already closed, which would silently rewrite endedAt.
    const conflicting = rows.filter((r: any) => r.status === 'resolved' && r.endedAtId !== endedAtId);
    if (conflicting.length) {
      throw new BadRequestException('EPISODE_ALREADY_RESOLVED');
    }

    const toResolve = rows
      .filter((r: any) => r.status !== 'resolved' || r.endedAtId !== endedAtId)
      .map((r: any) => r.id);
    if (!toResolve.length) return;

    await db
      .update(episodes)
      .set({
        status: 'resolved',
        endedAtType,
        endedAtId,
      })
      .where(and(eq(episodes.patientId, patientId), inArray(episodes.id, toResolve)));
  }

  /**
   * Phase 1 of an event correction's episode side (data-model.md → "Data integrity rules" →
   * Corrections; api.md → both correction PATCHes). Reads and validates only — run it BEFORE the
   * caller's transaction, then hand the returned plan to `applyEventEpisodeCorrection(tx, plan)`
   * inside it. The split exists because of `DatabaseService.withTransaction`'s sqlite caveat: the
   * body of a transaction must be a straight run of writes, with every read done beforehand.
   *
   * `episodeIds` / `resolvesEpisodeIds` are the request's values, `undefined` meaning "not sent,
   * keep what is there"; `clinicalTime` is the corrected `observedAt`/`performedAt` in epoch
   * seconds, `undefined` when not sent. Throws, in order:
   *  - 404 EPISODE_NOT_FOUND — a *sent* `episodeIds` naming another patient's episode (only what
   *    was sent is checked, as before: carried-over ids may predate patient scoping);
   *  - 400 RESOLVES_MUST_BE_SUBSET_OF_EPISODES — against the merged lists;
   *  - 400 EPISODE_ALREADY_RESOLVED — resolving an episode a different event already resolved;
   *  - from `planEpisodeAnchors` (skipped with `deferAnchors`): 400 EPISODE_LAST_ENTRY and
   *    400 EPISODE_TIME_ORDER_INVALID.
   *
   * Dropping the episode this event started is no longer refused: the start moves to the next
   * earliest member (data-model.md → "An episode starts at its earliest entry").
   */
  async planEventEpisodeCorrection(input: {
    patientId: string;
    userId: string;
    eventType: EpisodeEventType;
    eventId: string;
    episodeIds?: string[];
    resolvesEpisodeIds?: string[];
    clinicalTime?: number;
    /** Leave `anchors` empty; the caller plans them over several plans at once. */
    deferAnchors?: boolean;
  }): Promise<EventEpisodeCorrectionPlan> {
    const { patientId, userId, eventType, eventId } = input;
    const db = this.db.db as any;

    const pivotRows = await db
      .select()
      .from(episodesEventsPivot)
      .where(and(eq(episodesEventsPivot.eventId, eventId), eq(episodesEventsPivot.eventType, eventType)));
    const existingEpisodeIds = uniq(pivotRows.filter((p: any) => !p.resolvesEpisode).map((p: any) => p.episodeId));
    const existingResolvesIds = uniq(pivotRows.filter((p: any) => p.resolvesEpisode).map((p: any) => p.episodeId));

    const episodeIds = input.episodeIds ? uniq(input.episodeIds) : existingEpisodeIds;
    const resolvesEpisodeIds = input.resolvesEpisodeIds ? uniq(input.resolvesEpisodeIds) : existingResolvesIds;

    if (input.episodeIds) {
      await this.assertEpisodesBelongToPatient(patientId, userId, input.episodeIds);
    }
    this.assertResolvesSubset(resolvesEpisodeIds, episodeIds);

    // Every episode row this correction can touch: current and next links, plus any episode that
    // names this event as its end even if the pivot lost the link (ISSUES #35).
    const touchedIds = uniq([...existingEpisodeIds, ...existingResolvesIds, ...episodeIds, ...resolvesEpisodeIds]);
    const linkedRows = touchedIds.length
      ? await db.select().from(episodes).where(and(eq(episodes.patientId, patientId), inArray(episodes.id, touchedIds)))
      : [];
    const anchoredRows = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.patientId, patientId), eq(episodes.endedAtType, eventType), eq(episodes.endedAtId, eventId)));
    const byId = new Map<string, any>();
    for (const r of [...linkedRows, ...anchoredRows]) byId.set(r.id, r);

    const isThisEvent = (type: string | null, id: string | null) => type === eventType && id === eventId;

    // Rewritten only when the request sent either list, exactly as the PATCHes always have.
    const rewritePivot = input.episodeIds !== undefined || input.resolvesEpisodeIds !== undefined;

    // Resolution: the same identity-aware rule resolveEpisodes() applies on create, and like the
    // old PATCH path only when a list was sent — an untouched link set is never re-validated.
    const resolveEpisodeIds: string[] = [];
    for (const id of rewritePivot ? resolvesEpisodeIds : []) {
      const r = byId.get(id);
      if (!r) throw new NotFoundException('EPISODE_NOT_FOUND');
      if (r.status === 'resolved' && !isThisEvent(r.endedAtType, r.endedAtId)) {
        throw new BadRequestException('EPISODE_ALREADY_RESOLVED');
      }
      if (r.status !== 'resolved' || !isThisEvent(r.endedAtType, r.endedAtId)) resolveEpisodeIds.push(id);
    }

    // Dropping a resolve link reopens the frame — only when this event is the recorded end.
    const nextResolves = new Set(resolvesEpisodeIds);
    const reopenEpisodeIds = [...byId.values()]
      .filter((r) => r.status === 'resolved' && isThisEvent(r.endedAtType, r.endedAtId) && !nextResolves.has(r.id))
      .map((r) => r.id);

    // The established pivot write pattern (CLAUDE.md → Episode model): one membership row per
    // episode and a SEPARATE row per resolving link. `startsEpisode` is written false here and set
    // on the right row by the anchor writes that follow (data-model.md → EpisodeEventPivot).
    const pivotWrites: EventEpisodeCorrectionPlan['pivotRows'] = rewritePivot
      ? [
          ...episodeIds.map((episodeId) => ({ episodeId, startsEpisode: false, resolvesEpisode: false })),
          ...resolvesEpisodeIds.map((episodeId) => ({ episodeId, startsEpisode: false, resolvesEpisode: true })),
        ]
      : [];

    const plan: EventEpisodeCorrectionPlan = {
      patientId,
      eventType,
      eventId,
      episodeIds,
      resolvesEpisodeIds,
      rewritePivot,
      pivotRows: pivotWrites,
      resolveEpisodeIds,
      reopenEpisodeIds,
      previousEpisodeIds: existingEpisodeIds,
      clinicalTime: input.clinicalTime,
      anchors: [],
    };
    if (!input.deferAnchors) plan.anchors = await this.planEpisodeAnchors(patientId, [plan]);
    return plan;
  }

  /**
   * Plans the start of every episode one or more event corrections change, over their combined
   * result (data-model.md → "An episode starts at its earliest entry"). Reads only. An episode is
   * affected when an event joins or leaves it, or when a member's clinical time changes. Throws:
   *  - 400 EPISODE_LAST_ENTRY — the result leaves an episode with no members;
   *  - 400 EPISODE_TIME_ORDER_INVALID — the result leaves a resolved episode with other members
   *    whose resolving entry is strictly earlier than all of them, when it did not already.
   */
  async planEpisodeAnchors(patientId: string, plans: EventEpisodeCorrectionPlan[]): Promise<EpisodeAnchorWrite[]> {
    const affected = new Set<string>();
    for (const p of plans) {
      if (p.rewritePivot) {
        for (const id of p.previousEpisodeIds) if (!p.episodeIds.includes(id)) affected.add(id);
        for (const id of p.episodeIds) if (!p.previousEpisodeIds.includes(id)) affected.add(id);
        for (const id of [...p.resolveEpisodeIds, ...p.reopenEpisodeIds]) affected.add(id);
      }
      if (p.clinicalTime !== undefined) {
        for (const id of uniq([...p.previousEpisodeIds, ...p.episodeIds])) affected.add(id);
      }
    }
    if (!affected.size) return [];

    const state = await this.loadEpisodeMembers(patientId, [...affected]);
    const writes: EpisodeAnchorWrite[] = [];
    for (const [episodeId, before] of state) {
      const members = new Map(before.members.map((m) => [eventKey(m.type, m.id), { ...m }]));
      let resolver = before.resolver;
      for (const p of plans) {
        const key = eventKey(p.eventType, p.eventId);
        if (p.rewritePivot) {
          if (p.episodeIds.includes(episodeId)) {
            if (!members.has(key)) {
              const time = p.clinicalTime ?? (await this.resolveEventTimestamp(p.eventType, p.eventId));
              if (time !== null) members.set(key, { type: p.eventType, id: p.eventId, time });
            }
          } else {
            members.delete(key);
          }
          if (p.reopenEpisodeIds.includes(episodeId)) resolver = null;
          if (p.resolveEpisodeIds.includes(episodeId)) resolver = { type: p.eventType, id: p.eventId };
        }
        if (p.clinicalTime !== undefined && members.has(key)) members.get(key)!.time = p.clinicalTime;
      }
      const after = [...members.values()];
      if (!after.length) throw new BadRequestException('EPISODE_LAST_ENTRY');
      // Only a change can trip the ordering rule: data that was already inverted stays readable and
      // correctable rather than failing every unrelated edit.
      if (endsAtItsStart(after, resolver) && !endsAtItsStart(before.members, before.resolver)) {
        throw new BadRequestException('EPISODE_TIME_ORDER_INVALID');
      }
      const start = pickEpisodeStart(after, resolver)!;
      writes.push({ episodeId, startedAtType: start.type, startedAtId: start.id });
    }
    return writes;
  }

  /**
   * Phase 2: writes a plan from `planEventEpisodeCorrection`, using the caller's transaction
   * handle — `await this.db.withTransaction(async (tx) => { …; await
   * episodesService.applyEventEpisodeCorrection(tx, plan); })`. Writes only, no reads (the
   * sqlite caveat on `withTransaction`). The resolve and reopen updates are guarded in their
   * WHERE clauses, so a plan gone stale under a concurrent correction cannot close a frame
   * another event already closed, nor reopen one this event no longer ends.
   */
  async applyEventEpisodeCorrection(tx: any, plan: EventEpisodeCorrectionPlan): Promise<void> {
    const { patientId, eventType, eventId } = plan;
    if (plan.rewritePivot) {
      await tx
        .delete(episodesEventsPivot)
        .where(and(eq(episodesEventsPivot.eventId, eventId), eq(episodesEventsPivot.eventType, eventType)));
      for (const row of plan.pivotRows) {
        await tx.insert(episodesEventsPivot).values({ id: randomUUID(), eventType, eventId, ...row });
      }
    }
    if (plan.reopenEpisodeIds.length) {
      await tx
        .update(episodes)
        .set({ status: 'active', endedAtType: null, endedAtId: null })
        .where(
          and(
            eq(episodes.patientId, patientId),
            inArray(episodes.id, plan.reopenEpisodeIds),
            eq(episodes.endedAtType, eventType),
            eq(episodes.endedAtId, eventId),
          ),
        );
    }
    if (plan.resolveEpisodeIds.length) {
      await tx
        .update(episodes)
        .set({ status: 'resolved', endedAtType: eventType, endedAtId: eventId })
        .where(
          and(
            eq(episodes.patientId, patientId),
            inArray(episodes.id, plan.resolveEpisodeIds),
            or(ne(episodes.status, 'resolved'), and(eq(episodes.endedAtType, eventType), eq(episodes.endedAtId, eventId))),
          ),
        );
    }
    await this.applyEpisodeAnchors(tx, plan.anchors);
  }

  /**
   * Writes start moves: `startedAtType`/`startedAtId` on the episode, and `startsEpisode` on that
   * member's pivot row and no other (data-model.md → EpisodeEventPivot). Writes only; `handle` is a
   * transaction or the plain db. Runs after the pivot rewrites, so it flags the rows they wrote.
   */
  async applyEpisodeAnchors(handle: any, anchors: EpisodeAnchorWrite[]): Promise<void> {
    for (const a of anchors) {
      await handle
        .update(episodes)
        .set({ startedAtType: a.startedAtType, startedAtId: a.startedAtId })
        .where(eq(episodes.id, a.episodeId));
      await handle
        .update(episodesEventsPivot)
        .set({ startsEpisode: false })
        .where(and(eq(episodesEventsPivot.episodeId, a.episodeId), eq(episodesEventsPivot.startsEpisode, true)));
      await handle
        .update(episodesEventsPivot)
        .set({ startsEpisode: true })
        .where(
          and(
            eq(episodesEventsPivot.episodeId, a.episodeId),
            eq(episodesEventsPivot.eventType, a.startedAtType),
            eq(episodesEventsPivot.eventId, a.startedAtId),
            eq(episodesEventsPivot.resolvesEpisode, false),
          ),
        );
    }
  }

  /**
   * Current members (non-resolving pivot rows, plus the resolving entry should its membership row
   * have been lost — ISSUES #35) with their clinical times, and the resolving entry, per episode.
   * Members whose entry no longer exists are left out. Reads only.
   */
  private async loadEpisodeMembers(
    patientId: string | null,
    episodeIds: string[],
    rows?: any[],
  ): Promise<Map<string, { row: any; members: EpisodeEventAt[]; resolver: { type: EpisodeEventType; id: string } | null; flagged: string[] }>> {
    const db = this.db.db as any;
    const out = new Map<string, any>();
    if (!episodeIds.length) return out;
    const episodeRows =
      rows ??
      (await db
        .select()
        .from(episodes)
        .where(
          patientId
            ? and(eq(episodes.patientId, patientId), inArray(episodes.id, episodeIds))
            : inArray(episodes.id, episodeIds),
        ));
    const pivots = await db.select().from(episodesEventsPivot).where(inArray(episodesEventsPivot.episodeId, episodeIds));

    const refsByEpisode = new Map<string, Map<string, { type: EpisodeEventType; id: string }>>();
    for (const r of episodeRows) refsByEpisode.set(r.id, new Map());
    for (const p of pivots) {
      if (p.resolvesEpisode) continue;
      refsByEpisode.get(p.episodeId)?.set(eventKey(p.eventType, p.eventId), { type: p.eventType, id: p.eventId });
    }
    for (const r of episodeRows) {
      if (r.status === 'resolved' && r.endedAtId) {
        refsByEpisode.get(r.id)!.set(eventKey(r.endedAtType, r.endedAtId), { type: r.endedAtType, id: r.endedAtId });
      }
    }
    const allRefs = [...refsByEpisode.values()].flatMap((m) => [...m.values()]);
    const times = await this.eventTimes(allRefs);

    for (const r of episodeRows) {
      const members: EpisodeEventAt[] = [];
      for (const ref of refsByEpisode.get(r.id)!.values()) {
        const time = times.get(eventKey(ref.type, ref.id));
        if (time !== undefined) members.push({ ...ref, time });
      }
      out.set(r.id, {
        row: r,
        members,
        resolver: r.status === 'resolved' && r.endedAtId ? { type: r.endedAtType, id: r.endedAtId } : null,
        flagged: pivots
          .filter((p: any) => p.episodeId === r.id && p.startsEpisode)
          .map((p: any) => eventKey(p.eventType, p.eventId)),
      });
    }
    return out;
  }

  /** Clinical times for a set of entries, keyed `type:id`. Two queries whatever the count. */
  private async eventTimes(refs: Array<{ type: EpisodeEventType; id: string }>): Promise<Map<string, number>> {
    const db = this.db.db as any;
    const obsIds = uniq(refs.filter((r) => r.type === 'observation').map((r) => r.id));
    const intIds = uniq(refs.filter((r) => r.type === 'intervention').map((r) => r.id));
    const out = new Map<string, number>();
    if (obsIds.length) {
      const rows = await db
        .select({ id: observations.id, at: observations.observedAt })
        .from(observations)
        .where(inArray(observations.id, obsIds));
      for (const r of rows) out.set(eventKey('observation', r.id), normalizeTs(r.at)!);
    }
    if (intIds.length) {
      const rows = await db
        .select({ id: interventions.id, at: interventions.performedAt })
        .from(interventions)
        .where(inArray(interventions.id, intIds));
      for (const r of rows) out.set(eventKey('intervention', r.id), normalizeTs(r.at)!);
    }
    return out;
  }

  /**
   * Self-healing on read and after an entry create (data-model.md → "An episode starts at its
   * earliest entry" → Self-healing on read). Recomputes the start of each given episode from its
   * current members and, where the stored `startedAt*` or the `startsEpisode` flags disagree, writes
   * the correction. Idempotent: two pods healing the same row write the same values. Returns the
   * rows with the corrected anchor, so a read answers with it. An episode with no readable members
   * is left exactly as stored.
   */
  async reconcileEpisodeStarts<T extends { id: string; startedAtType: string; startedAtId: string }>(rows: T[]): Promise<T[]> {
    if (!rows.length) return rows;
    const state = await this.loadEpisodeMembers(null, rows.map((r) => r.id), rows);
    const writes: EpisodeAnchorWrite[] = [];
    const fixed = rows.map((r) => {
      const s = state.get(r.id);
      const start = s ? pickEpisodeStart(s.members, s.resolver) : null;
      if (!start) return r;
      const key = eventKey(start.type, start.id);
      const flagsRight = s!.flagged.length === 1 && s!.flagged[0] === key;
      if (r.startedAtType === start.type && r.startedAtId === start.id && flagsRight) return r;
      writes.push({ episodeId: r.id, startedAtType: start.type, startedAtId: start.id });
      return { ...r, startedAtType: start.type, startedAtId: start.id };
    });
    if (writes.length) await this.applyEpisodeAnchors(this.db.db as any, writes);
    return fixed;
  }

  /** `reconcileEpisodeStarts` for episodes known only by id (the entry create paths). */
  async reconcileEpisodeStartsById(patientId: string, episodeIds: string[]): Promise<void> {
    const ids = uniq(episodeIds);
    if (!ids.length) return;
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.patientId, patientId), inArray(episodes.id, ids)));
    await this.reconcileEpisodeStarts(rows);
  }

  /**
   * Entry create's half of EPISODE_TIME_ORDER_INVALID (data-model.md → "An episode may not end at
   * its start…"): a new entry at `time` that resolves an episode may not be strictly earlier than
   * every one of that episode's current members. Reads only — call before the entry is written.
   * Ids that are not this patient's episodes are skipped; `assertEpisodesBelongToPatient` owns that.
   */
  async assertResolvingTimeOrder(patientId: string, resolvesEpisodeIds: string[] | undefined, time: number): Promise<void> {
    if (!resolvesEpisodeIds?.length) return;
    const state = await this.loadEpisodeMembers(patientId, uniq(resolvesEpisodeIds));
    for (const s of state.values()) {
      if (s.members.length && s.members.every((m) => time < m.time)) {
        throw new BadRequestException('EPISODE_TIME_ORDER_INVALID');
      }
    }
  }

  // "Derived fields computed at query time: startedAt, resolvedAt from linked events" (data-model.md).
  private async resolveEventTimestamp(eventType: EpisodeEndType, eventId: string): Promise<number | null> {
    const db = this.db.db as any;
    if (eventType === 'observation') {
      const rows = await db.select().from(observations).where(eq(observations.id, eventId)).limit(1);
      return rows.length ? normalizeTs(rows[0].observedAt) : null;
    }
    const rows = await db.select().from(interventions).where(eq(interventions.id, eventId)).limit(1);
    return rows.length ? normalizeTs(rows[0].performedAt) : null;
  }

  async getById(episodeId: string, userId: string): Promise<Episode> {
    const db = this.db.db as any;
    const rows = await db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
    if (!rows.length) throw new NotFoundException('EPISODE_NOT_FOUND');
    await this.ensurePatientAccess(rows[0].patientId, userId);
    const [row]: any[] = await this.reconcileEpisodeStarts(rows);

    const pivots = await db
      .select()
      .from(episodesEventsPivot)
      .where(eq(episodesEventsPivot.episodeId, episodeId));
    const observationIds = pivots
      .filter((p: any) => p.eventType === 'observation')
      .map((p: any) => p.eventId);
    const interventionIds = pivots
      .filter((p: any) => p.eventType === 'intervention')
      .map((p: any) => p.eventId);

    const episode: Episode = {
      id: row.id,
      patientId: row.patientId,
      conditionId: row.conditionId ?? null,
      name: row.name,
      status: row.status,
      startedAtType: row.startedAtType,
      startedAtId: row.startedAtId,
      endedAtType: row.endedAtType ?? null,
      endedAtId: row.endedAtId ?? null,
      // Same derived fields listForPatient returns — a single-episode read shouldn't hand back a
      // less-usable shape than the list route (api.md → Episodes).
      startedAt: await this.resolveEventTimestamp(row.startedAtType, row.startedAtId),
      endedAt: row.endedAtId ? await this.resolveEventTimestamp(row.endedAtType, row.endedAtId) : null,
      notes: row.notes ?? null,
      observationIds: Array.from(new Set<string>(observationIds)),
      interventionIds: Array.from(new Set<string>(interventionIds)),
      createdAt: normalizeTs(row.createdAt)!,
      updatedAt: normalizeTs(row.updatedAt)!,
    };
    const schedules = await this.episodeSchedules(episodeId);
    episode.schedules = schedules;
    episode.medications = await this.episodeMedications(episode.interventionIds ?? [], schedules);
    return episode;
  }

  /** The schedules attached to this episode, oldest first, in the schedules routes' own shape. */
  private async episodeSchedules(episodeId: string): Promise<InterventionSchedule[]> {
    const db = this.db.db as any;
    const ids = await scheduleIdsForEpisode(db, episodeId);
    if (!ids.length) return [];
    const rows: any[] = await db.select().from(interventionSchedules).where(inArray(interventionSchedules.id, ids));
    const episodeIds = await episodeIdsBySchedule(db, ids);
    const views = await Promise.all(rows.map((r) => toScheduleView(db, r, episodeIds.get(r.id))));
    return views.sort((a, b) => a.startAt - b.startAt || a.createdAt - b.createdAt);
  }

  /**
   * The medications (and embodiments) this episode's doses and schedules name — what the episode
   * page needs to say "clotrimazole 1% cream" on every dose line (api.md → Episodes).
   */
  private async episodeMedications(interventionIds: string[], schedules: InterventionSchedule[]): Promise<EpisodeMedicationRef[]> {
    const db = this.db.db as any;
    const medIds = new Set<string>();
    const embIds = new Set<string>();
    if (interventionIds.length) {
      const rows: any[] = await db.select().from(interventions).where(inArray(interventions.id, interventionIds));
      for (const r of rows) {
        if (r.type !== 'medication_dose') continue;
        const m = r.metadata ? JSON.parse(r.metadata) : {};
        if (m.medicationId) medIds.add(m.medicationId);
        if (m.medicationEmbodimentId) embIds.add(m.medicationEmbodimentId);
      }
    }
    for (const s of schedules) {
      if (s.medicationId) medIds.add(s.medicationId);
      if (s.medicationEmbodimentId) embIds.add(s.medicationEmbodimentId);
    }
    if (!medIds.size) return [];
    const meds: any[] = await db.select().from(medications).where(inArray(medications.id, [...medIds]));
    const embs: any[] = embIds.size
      ? await db.select().from(medicationEmbodiments).where(inArray(medicationEmbodiments.id, [...embIds]))
      : [];
    return meds
      .map((m) => ({
        id: m.id,
        name: m.name,
        embodiments: embs
          .filter((e) => e.medicationId === m.id)
          .map((e) => ({ id: e.id, label: e.label, dosageForm: e.dosageForm ?? null })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listForPatient(patientId: string, userId: string, status?: 'active' | 'resolved'): Promise<Episode[]> {
    const db = this.db.db as any;
    await this.ensurePatientAccess(patientId, userId);
    let rows: any[] = await this.reconcileEpisodeStarts(await db.select().from(episodes).where(eq(episodes.patientId, patientId)));
    if (status) {
      rows = rows.filter((r: any) => r.status === status);
    }
    return Promise.all(
      rows.map(async (r: any): Promise<Episode> => ({
        id: r.id,
        patientId: r.patientId,
        conditionId: r.conditionId ?? null,
        name: r.name,
        status: r.status,
        startedAtType: r.startedAtType,
        startedAtId: r.startedAtId,
        endedAtType: r.endedAtType ?? null,
        endedAtId: r.endedAtId ?? null,
        startedAt: await this.resolveEventTimestamp(r.startedAtType, r.startedAtId),
        endedAt: r.endedAtId ? await this.resolveEventTimestamp(r.endedAtType, r.endedAtId) : null,
        notes: r.notes ?? null,
        createdAt: normalizeTs(r.createdAt)!,
        updatedAt: normalizeTs(r.updatedAt)!,
      })),
    );
  }

  async listActiveForUser(userId: string): Promise<ActiveEpisodeSummary[]> {
    const db = this.db.db as any;
    const rows = await db
      .select({
        episode: episodes,
        patient: patients,
      })
      .from(episodes)
      .leftJoin(patients, eq(episodes.patientId, patients.id))
      .where(eq(episodes.status, 'active'));

    // Filter to patients the user can access
    const patientIds = Array.from(new Set(rows.map((r: any) => r.patient?.id).filter(Boolean))) as string[];
    if (!patientIds.length) return [];
    const membershipRows = await db
      .select()
      .from(careTeamMemberships)
      .where(and(inArray(careTeamMemberships.patientId, patientIds), eq(careTeamMemberships.userId, userId)));
    const allowed = new Set(membershipRows.map((m: any) => m.patientId));
    const visible = rows.filter((r: any) => r.patient && allowed.has(r.patient.id));
    const healed = new Map(
      (await this.reconcileEpisodeStarts(visible.map((r: any) => r.episode))).map((e: any) => [e.id, e]),
    );

    return visible
      .map((r: any) => ({ ...r, episode: healed.get(r.episode.id) }))
      .map((r: any): ActiveEpisodeSummary => ({
        id: r.episode.id,
        patientId: r.patient.id,
        patientName: r.patient.fullName,
        conditionId: r.episode.conditionId ?? null,
        name: r.episode.name,
        status: r.episode.status,
        startedAtType: r.episode.startedAtType,
        startedAtId: r.episode.startedAtId,
        // ?? null for consistency with the two sibling mappers -- drizzle returns null either way,
        // but a typed literal shouldn't disagree with its neighbours about the shape.
        endedAtType: r.episode.endedAtType ?? null,
        endedAtId: r.episode.endedAtId ?? null,
        notes: r.episode.notes ?? null,
        createdAt: normalizeTs(r.episode.createdAt)!,
        updatedAt: normalizeTs(r.episode.updatedAt)!,
      }));
  }
}
