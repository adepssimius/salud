import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
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
