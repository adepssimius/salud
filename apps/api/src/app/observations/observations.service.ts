import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  episodesEventsPivot,
  observationEntries,
  observations,
  patients,
} from '../../db/schema';
import { CreateObservationDto } from './dto/create-observation.dto';
import { UpdateObservationDto } from './dto/update-observation.dto';
import { EpisodesService } from '../episodes/episodes.service';
import { AdvisoriesService } from '../advisories/advisories.service';
import { RevisionsService } from '../revisions/revisions.service';
import { normalizeTs } from '../persistence/time';

@Injectable()
export class ObservationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly episodesService: EpisodesService,
    private readonly advisoriesService: AdvisoriesService,
    private readonly revisionsService: RevisionsService,
  ) {}

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

  private mapObservation(row: any, entries: any[], episodeIds: string[] = [], resolvesEpisodeIds: string[] = []) {
    const observedAt = normalizeTs(row.observedAt);
    return {
      id: row.id,
      patientId: row.patientId,
      recordedByUserId: row.recordedByUserId,
      observedAt,
      text: row.text,
      episodeIds,
      resolvesEpisodeIds,
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
      })),
      unitPreferenceAtEntry: row.unitPreferenceAtEntry ? JSON.parse(row.unitPreferenceAtEntry) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // Weight entries denormalize onto patients.latestWeightKg/latestWeightRecordedAt so the
  // patient row always answers "how much does she weigh" without joining observations. Guarded
  // by recency: an older weight (e.g. correcting a past entry, or updating an observation that
  // isn't the most recent one on the timeline) must never regress the denormalized value.
  private async applyLatestWeightIfNewer(patientId: string, kg: number, observedAtTs: number) {
    const db = this.db.db as any;
    const rows = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    const current = rows[0];
    const currentRecordedAt = current?.latestWeightRecordedAt
      ? current.latestWeightRecordedAt instanceof Date
        ? Math.floor(current.latestWeightRecordedAt.getTime() / 1000)
        : current.latestWeightRecordedAt
      : null;
    if (currentRecordedAt !== null && observedAtTs < currentRecordedAt) {
      return;
    }
    await db
      .update(patients)
      .set({ latestWeightKg: kg, latestWeightRecordedAt: new Date(observedAtTs * 1000) })
      .where(eq(patients.id, patientId));
  }

  private ensureResolvesSubset(resolves: string[] | undefined, episodes: string[] | undefined) {
    if (!resolves || !resolves.length) return;
    const epList = episodes ?? [];
    if (!epList.length) {
      throw new BadRequestException('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');
    }
    const epSet = new Set(epList);
    for (const res of resolves) {
      if (!epSet.has(res)) {
        throw new BadRequestException('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');
      }
    }
  }

  async create(patientId: string, userId: string, dto: CreateObservationDto) {
    await this.ensurePatientAccess(patientId, userId);
    if (!dto.entries || !dto.entries.length) {
      throw new BadRequestException('AT_LEAST_ONE_ENTRY_REQUIRED');
    }
    const db = this.db.db as any;
    const id = randomUUID();
    const observedAtDate = new Date(dto.observedAt);
    const observedAtTs = Math.floor(observedAtDate.getTime() / 1000);

    await db.insert(observations).values({
      id,
      patientId,
      recordedByUserId: userId,
      observedAt: observedAtDate,
      text: dto.text,
      // Set once at create and never touched by update() — it records the units the original
      // recorder was working in, which a later correction doesn't change (api.md → Observations).
      unitPreferenceAtEntry: dto.unitPreferenceAtEntry ? JSON.stringify(dto.unitPreferenceAtEntry) : null,
    });

    const episodeIds = new Set<string>(dto.episodeIds || []);
    let startedEpisodeId: string | null = null;
    if (dto.startEpisodeName) {
      startedEpisodeId = await this.episodesService.createFromEvent({
        patientId,
        userId,
        name: dto.startEpisodeName,
        startedAtType: 'observation',
        startedAtId: id,
        conditionId: dto.startEpisodeConditionId,
      });
      episodeIds.add(startedEpisodeId);
    }

    this.ensureResolvesSubset(dto.resolvesEpisodeIds, Array.from(episodeIds));

    for (const entry of dto.entries) {
      await db.insert(observationEntries).values({
        id: randomUUID(),
        observationId: id,
        type: entry.type,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      });

      if (entry.type === 'weight' && entry.metadata?.kg !== undefined) {
        await this.applyLatestWeightIfNewer(patientId, entry.metadata.kg, observedAtTs);
      }
    }

    for (const ep of episodeIds) {
      await db.insert(episodesEventsPivot).values({
        id: randomUUID(),
        episodeId: ep,
        eventType: 'observation',
        eventId: id,
        startsEpisode: startedEpisodeId === ep,
        resolvesEpisode: false,
      });
    }

    if (dto.resolvesEpisodeIds && dto.resolvesEpisodeIds.length) {
      await this.episodesService.resolveEpisodes(patientId, userId, dto.resolvesEpisodeIds, 'observation', id);
      for (const ep of dto.resolvesEpisodeIds) {
        await db.insert(episodesEventsPivot).values({
          id: randomUUID(),
          episodeId: ep,
          eventType: 'observation',
          eventId: id,
          startsEpisode: false,
          resolvesEpisode: true,
        });
      }
    }

    const firedAdvisories = await this.advisoriesService.evaluateProtocols(
      patientId,
      userId,
      id,
      dto.entries,
    );
    const observation = await this.getById(id, userId);
    return firedAdvisories.length ? { ...observation, firedAdvisories } : observation;
  }

  async list(patientId: string, userId: string, params: { type?: string; from?: number; to?: number; limit?: number; episodeId?: string }) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(observations)
      .where(eq(observations.patientId, patientId))
      .orderBy(desc(observations.observedAt));

    const filtered = rows.filter((row: any) => {
      const ts = normalizeTs(row.observedAt);
      if (params.from && ts < params.from) return false;
      if (params.to && ts > params.to) return false;
      return true;
    });

    const ids = filtered.map((r: any) => r.id);
    let entries: any[] = [];
    if (ids.length) {
      entries = await db.select().from(observationEntries).where(inArray(observationEntries.observationId, ids));
    }

    const byObs: Record<string, any[]> = {};
    for (const e of entries) {
      if (!byObs[e.observationId]) byObs[e.observationId] = [];
      byObs[e.observationId].push(e);
    }

    const pivots = ids.length
      ? await db
          .select()
          .from(episodesEventsPivot)
          .where(and(inArray(episodesEventsPivot.eventId, ids), eq(episodesEventsPivot.eventType, 'observation')))
      : [];
    const epByEvent: Record<string, { ep: string[]; res: string[] }> = {};
    for (const p of pivots) {
      if (!epByEvent[p.eventId]) epByEvent[p.eventId] = { ep: [], res: [] };
      epByEvent[p.eventId].ep.push(p.episodeId);
      if (p.resolvesEpisode) epByEvent[p.eventId].res.push(p.episodeId);
    }

    let result = filtered.map((row: any) =>
      this.mapObservation(row, byObs[row.id] || [], epByEvent[row.id]?.ep || [], epByEvent[row.id]?.res || []),
    );
    if (params.episodeId) {
      result = result.filter((obs) => obs.episodeIds.includes(params.episodeId!));
    }
    if (params.type) {
      result = result.filter((obs) => obs.entries.some((e) => e.type === params.type));
    }
    if (params.limit && result.length > params.limit) {
      result = result.slice(0, params.limit);
    }
    return result;
  }

  async getById(id: string, userId: string, patientId?: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(observations).where(eq(observations.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    const row = rows[0];
    if (patientId && row.patientId !== patientId) {
      throw new NotFoundException('OBSERVATION_NOT_FOUND');
    }
    await this.ensurePatientAccess(row.patientId, userId);

    const entries = await db.select().from(observationEntries).where(eq(observationEntries.observationId, id));
    const pivots = await db
      .select()
      .from(episodesEventsPivot)
      .where(and(eq(episodesEventsPivot.eventId, id), eq(episodesEventsPivot.eventType, 'observation')));
    const episodeIds = pivots.filter((p: any) => !p.resolvesEpisode).map((p: any) => p.episodeId);
    const resolvesEpisodeIds = pivots.filter((p: any) => !!p.resolvesEpisode).map((p: any) => p.episodeId);
    return this.mapObservation(row, entries, episodeIds, resolvesEpisodeIds);
  }

  async update(id: string, userId: string, dto: UpdateObservationDto) {
    const db = this.db.db as any;
    const rows = await db.select().from(observations).where(eq(observations.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    const row = rows[0];
    await this.ensurePatientAccess(row.patientId, userId);

    const preUpdateSnapshot = await this.getById(id, userId);
    await this.revisionsService.capture('observation', id, preUpdateSnapshot, userId);

    const pivotRows = await db
      .select()
      .from(episodesEventsPivot)
      .where(and(eq(episodesEventsPivot.eventId, id), eq(episodesEventsPivot.eventType, 'observation')));
    const existingEpisodeIds: string[] = Array.from(
      new Set<string>(pivotRows.filter((p: any) => !p.resolvesEpisode).map((p: any) => p.episodeId)),
    );
    const existingResolvesIds: string[] = Array.from(
      new Set<string>(pivotRows.filter((p: any) => p.resolvesEpisode).map((p: any) => p.episodeId)),
    );
    const startedEpisodes = new Set<string>(pivotRows.filter((p: any) => p.startsEpisode).map((p: any) => p.episodeId));

    const episodeIds: string[] = dto.episodeIds ?? existingEpisodeIds;
    const resolvesEpisodeIds: string[] = dto.resolvesEpisodeIds ?? existingResolvesIds;
    this.ensureResolvesSubset(resolvesEpisodeIds, episodeIds);

    const updates: Record<string, any> = {};
    if (dto.text !== undefined) updates.text = dto.text;
    if (Object.keys(updates).length) {
      await db.update(observations).set(updates).where(eq(observations.id, id));
    }

    if (dto.entries) {
      await db.delete(observationEntries).where(eq(observationEntries.observationId, id));
      const observedAtTs = normalizeTs(row.observedAt);
      for (const entry of dto.entries) {
        await db.insert(observationEntries).values({
          id: entry.id ?? randomUUID(),
          observationId: id,
          type: entry.type,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        });

        if (entry.type === 'weight' && entry.metadata?.kg !== undefined) {
          await this.applyLatestWeightIfNewer(row.patientId, entry.metadata.kg, observedAtTs);
        }
      }
    }

    if (dto.episodeIds || dto.resolvesEpisodeIds) {
      await db
        .delete(episodesEventsPivot)
        .where(and(eq(episodesEventsPivot.eventId, id), eq(episodesEventsPivot.eventType, 'observation')));

      for (const ep of episodeIds) {
        await db.insert(episodesEventsPivot).values({
          id: randomUUID(),
          episodeId: ep,
          eventType: 'observation',
          eventId: id,
          startsEpisode: startedEpisodes.has(ep),
          resolvesEpisode: false,
        });
      }

      if (resolvesEpisodeIds.length) {
        await this.episodesService.resolveEpisodes(row.patientId, userId, resolvesEpisodeIds, 'observation', id);
        for (const ep of resolvesEpisodeIds) {
          await db.insert(episodesEventsPivot).values({
            id: randomUUID(),
            episodeId: ep,
            eventType: 'observation',
            eventId: id,
            startsEpisode: false,
            resolvesEpisode: true,
          });
        }
      }
    }

    return this.getById(id, userId);
  }

  async getRevisions(id: string, userId: string) {
    await this.getById(id, userId); // enforces existence + patient access
    return this.revisionsService.listFor('observation', id);
  }
}
