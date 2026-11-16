import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  episodes,
  episodesEventsPivot,
  interventions,
  observations,
  patients,
} from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { ActiveEpisodeSummary, Episode } from '@salud/shared/types';

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
}

const uniq = (ids: string[]): string[] => Array.from(new Set(ids));

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
   *  - 400 CANNOT_UNLINK_STARTED_EPISODE — a sent `episodeIds` that drops an episode this event
   *    started (by the pivot's `startsEpisode` flag or the episode's own `startedAtId`);
   *  - 400 EPISODE_ALREADY_RESOLVED — resolving an episode a different event already resolved;
   *  - 400 EPISODE_TIME_ORDER_INVALID — when a time or the resolve list was sent, any episode this
   *    event starts that would end before the (corrected) time, or that this event would resolve
   *    before the episode's start.
   */
  async planEventEpisodeCorrection(input: {
    patientId: string;
    userId: string;
    eventType: EpisodeEventType;
    eventId: string;
    episodeIds?: string[];
    resolvesEpisodeIds?: string[];
    clinicalTime?: number;
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
    // names this event as its start or end even if the pivot lost the link (ISSUES #35).
    const touchedIds = uniq([...existingEpisodeIds, ...existingResolvesIds, ...episodeIds, ...resolvesEpisodeIds]);
    const linkedRows = touchedIds.length
      ? await db.select().from(episodes).where(and(eq(episodes.patientId, patientId), inArray(episodes.id, touchedIds)))
      : [];
    const anchoredRows = await db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.patientId, patientId),
          or(
            and(eq(episodes.startedAtType, eventType), eq(episodes.startedAtId, eventId)),
            and(eq(episodes.endedAtType, eventType), eq(episodes.endedAtId, eventId)),
          ),
        ),
      );
    const byId = new Map<string, any>();
    for (const r of [...linkedRows, ...anchoredRows]) byId.set(r.id, r);

    const isThisEvent = (type: string | null, id: string | null) => type === eventType && id === eventId;
    const started = new Set<string>(pivotRows.filter((p: any) => p.startsEpisode).map((p: any) => p.episodeId));
    for (const r of byId.values()) if (isThisEvent(r.startedAtType, r.startedAtId)) started.add(r.id);

    // (a) An event cannot leave a frame it started. Only a *sent* list can drop one; an omitted
    // list carries the current links over, and must not fail on a link some earlier bug lost.
    if (input.episodeIds) {
      const next = new Set(episodeIds);
      if ([...started].some((id) => !next.has(id))) {
        throw new BadRequestException('CANNOT_UNLINK_STARTED_EPISODE');
      }
    }

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

    // (b) Dropping a resolve link reopens the frame — only when this event is the recorded end.
    const nextResolves = new Set(resolvesEpisodeIds);
    const reopenEpisodeIds = [...byId.values()]
      .filter((r) => r.status === 'resolved' && isThisEvent(r.endedAtType, r.endedAtId) && !nextResolves.has(r.id))
      .map((r) => r.id);

    // (c) An episode may not end before it starts. Checked only when the time or the resolve list
    // was sent, so an unrelated correction never fails on data that was already inverted.
    if (input.clinicalTime !== undefined || input.resolvesEpisodeIds) {
      const eventTime =
        input.clinicalTime !== undefined ? input.clinicalTime : await this.resolveEventTimestamp(eventType, eventId);
      if (eventTime !== null) {
        for (const id of started) {
          const r = byId.get(id);
          if (!r) continue;
          // Ends after this correction: at this event when it (still) resolves the frame, at the
          // recorded end event when another event closed it, nowhere when it is or becomes open.
          if (nextResolves.has(id) || reopenEpisodeIds.includes(id)) continue;
          if (r.status === 'resolved' && r.endedAtId) {
            const endTime = await this.resolveEventTimestamp(r.endedAtType, r.endedAtId);
            if (endTime !== null && eventTime > endTime) throw new BadRequestException('EPISODE_TIME_ORDER_INVALID');
          }
        }
        for (const id of resolvesEpisodeIds) {
          const r = byId.get(id);
          if (!r || started.has(id)) continue; // starting and ending on one event is a zero-length frame
          const startTime = await this.resolveEventTimestamp(r.startedAtType, r.startedAtId);
          if (startTime !== null && eventTime < startTime) throw new BadRequestException('EPISODE_TIME_ORDER_INVALID');
        }
      }
    }

    // The established pivot write pattern (CLAUDE.md → Episode model): one membership row per
    // episode carrying `startsEpisode`, and a SEPARATE row per resolving link.
    const pivotWrites: EventEpisodeCorrectionPlan['pivotRows'] = rewritePivot
      ? [
          ...episodeIds.map((episodeId) => ({ episodeId, startsEpisode: started.has(episodeId), resolvesEpisode: false })),
          ...resolvesEpisodeIds.map((episodeId) => ({ episodeId, startsEpisode: false, resolvesEpisode: true })),
        ]
      : [];

    return {
      patientId,
      eventType,
      eventId,
      episodeIds,
      resolvesEpisodeIds,
      rewritePivot,
      pivotRows: pivotWrites,
      resolveEpisodeIds,
      reopenEpisodeIds,
    };
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
    const row = rows[0];
    await this.ensurePatientAccess(row.patientId, userId);

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
    return episode;
  }

  async listForPatient(patientId: string, userId: string, status?: 'active' | 'resolved'): Promise<Episode[]> {
    const db = this.db.db as any;
    await this.ensurePatientAccess(patientId, userId);
    let rows = await db.select().from(episodes).where(eq(episodes.patientId, patientId));
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

    return rows
      .filter((r: any) => r.patient && allowed.has(r.patient.id))
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
