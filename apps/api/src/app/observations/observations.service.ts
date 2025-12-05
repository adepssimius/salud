import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  observationEntries,
  observations,
  patients,
} from '../../db/schema';
import { CreateObservationDto } from './dto/create-observation.dto';
import { UpdateObservationDto } from './dto/update-observation.dto';
import { EpisodesService } from '../episodes/episodes.service';

@Injectable()
export class ObservationsService {
  constructor(private readonly db: DatabaseService, private readonly episodesService: EpisodesService) {}

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

  private mapObservation(row: any, entries: any[]) {
    const observedAt = row.observedAt instanceof Date ? Math.floor(row.observedAt.getTime() / 1000) : row.observedAt;
    return {
      id: row.id,
      patientId: row.patientId,
      recordedByUserId: row.recordedByUserId,
      observedAt,
      text: row.text,
      symptomTags: row.symptomTags ? JSON.parse(row.symptomTags) : [],
      episodeIds: row.episodeTags ? JSON.parse(row.episodeTags) : [],
      resolvesEpisodeIds: row.resolvesEpisodeIds ? JSON.parse(row.resolvesEpisodeIds) : [],
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private ensureResolvesSubset(dto: CreateObservationDto | UpdateObservationDto) {
    if (!dto.resolvesEpisodeIds) return;
    if (!dto.episodeIds || dto.episodeIds.length === 0) {
      throw new BadRequestException('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');
    }
    const set = new Set(dto.episodeIds);
    for (const res of dto.resolvesEpisodeIds) {
      if (!set.has(res)) {
        throw new BadRequestException('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');
      }
    }
  }

  async create(patientId: string, userId: string, dto: CreateObservationDto) {
    await this.ensurePatientAccess(patientId, userId);
    this.ensureResolvesSubset(dto);
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
      symptomTags: dto.symptomTags ? JSON.stringify(dto.symptomTags) : null,
      episodeTags: dto.episodeIds ? JSON.stringify(dto.episodeIds) : null,
      resolvesEpisodeIds: dto.resolvesEpisodeIds ? JSON.stringify(dto.resolvesEpisodeIds) : null,
    });

    let episodeIds = dto.episodeIds ? [...dto.episodeIds] : [];
    if (dto.startEpisodeName) {
      const newEpisodeId = await this.episodesService.createFromEvent({
        patientId,
        userId,
        name: dto.startEpisodeName,
        startedAtType: 'observation',
        startedAtId: id,
      });
      episodeIds.push(newEpisodeId);
      await db
        .update(observations)
        .set({ episodeTags: JSON.stringify(episodeIds) })
        .where(eq(observations.id, id));
    }

    if (dto.resolvesEpisodeIds && dto.resolvesEpisodeIds.length) {
      await this.episodesService.resolveEpisodes(patientId, userId, dto.resolvesEpisodeIds, 'observation', id);
    }

    for (const entry of dto.entries) {
      await db.insert(observationEntries).values({
        id: randomUUID(),
        observationId: id,
        type: entry.type,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      });

      if (entry.type === 'weight' && entry.metadata?.kg !== undefined) {
        await db
          .update(patients)
          .set({
            latestWeightKg: entry.metadata.kg,
            latestWeightRecordedAt: observedAtTs,
          })
          .where(eq(patients.id, patientId));
      }
    }

    return this.getById(id, userId);
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
      const ts = row.observedAt instanceof Date ? Math.floor(row.observedAt.getTime() / 1000) : row.observedAt;
      if (params.from && ts < params.from) return false;
      if (params.to && ts > params.to) return false;
      if (params.episodeId) {
        const episodes = row.episodeTags ? JSON.parse(row.episodeTags) : [];
        if (!episodes.includes(params.episodeId)) return false;
      }
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

    let result = filtered.map((row: any) => this.mapObservation(row, byObs[row.id] || []));
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

    const entries = await db
      .select()
      .from(observationEntries)
      .where(eq(observationEntries.observationId, id));
    return this.mapObservation(row, entries);
  }

  async update(id: string, userId: string, dto: UpdateObservationDto) {
    const db = this.db.db as any;
    const rows = await db.select().from(observations).where(eq(observations.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    const row = rows[0];
    await this.ensurePatientAccess(row.patientId, userId);
    this.ensureResolvesSubset(dto);

    const updates: Record<string, any> = {};
    if (dto.text !== undefined) updates.text = dto.text;
    if (dto.symptomTags) updates.symptomTags = JSON.stringify(dto.symptomTags);
    if (dto.episodeIds) updates.episodeTags = JSON.stringify(dto.episodeIds);
    if (dto.resolvesEpisodeIds) updates.resolvesEpisodeIds = JSON.stringify(dto.resolvesEpisodeIds);
    if (Object.keys(updates).length) {
      await db.update(observations).set(updates).where(eq(observations.id, id));
    }

    if (dto.entries) {
      await db.delete(observationEntries).where(eq(observationEntries.observationId, id));
      for (const entry of dto.entries) {
        await db.insert(observationEntries).values({
          id: entry.id ?? randomUUID(),
          observationId: id,
          type: entry.type,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        });
      }
    }

    return this.getById(id, userId);
  }
}
