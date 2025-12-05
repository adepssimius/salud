import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  interventions,
  patients,
} from '../../db/schema';
import { CreateInterventionDto } from './dto/create-intervention.dto';
import { UpdateInterventionDto } from './dto/update-intervention.dto';
import { EpisodesService } from '../episodes/episodes.service';

@Injectable()
export class InterventionsService {
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

  private ensureResolvesSubset(dto: { resolvesEpisodeIds?: string[]; episodeIds?: string[] }) {
    if (!dto.resolvesEpisodeIds) return;
    const episodes = dto.episodeIds ?? [];
    if (!episodes.length) {
      throw new BadRequestException('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');
    }
    const set = new Set(episodes);
    for (const res of dto.resolvesEpisodeIds) {
      if (!set.has(res)) {
        throw new BadRequestException('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');
      }
    }
  }

  private mapIntervention(row: any) {
    const performedAt = row.performedAt instanceof Date ? Math.floor(row.performedAt.getTime() / 1000) : row.performedAt;
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      id: row.id,
      patientId: row.patientId,
      recordedByUserId: row.recordedByUserId,
      performedAt,
      type: row.type,
      episodeIds: row.episodeTags ? JSON.parse(row.episodeTags) : [],
      resolvesEpisodeIds: row.resolvesEpisodeIds ? JSON.parse(row.resolvesEpisodeIds) : [],
      notes: row.notes ?? null,
      interventionScheduleId: row.interventionScheduleId ?? null,
      metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(patientId: string, userId: string, dto: CreateInterventionDto) {
    await this.ensurePatientAccess(patientId, userId);
    this.ensureResolvesSubset(dto);
    const db = this.db.db as any;
    const id = randomUUID();
    const performedAtDate = new Date(dto.performedAt);
    const performedAtTs = Math.floor(performedAtDate.getTime() / 1000);

    const metadata = {
      medicationId: dto.medicationId,
      medicationEmbodimentId: dto.medicationEmbodimentId,
      doseSource: dto.doseSource,
      amountMg: dto.amountMg,
      amountMl: dto.amountMl,
      pillCount: dto.pillCount,
      weightKgUsed: dto.weightKgUsed,
      ageMonthsUsed: dto.ageMonthsUsed,
      guidelineId: dto.guidelineId ?? null,
      interventionScheduleId: dto.interventionScheduleId ?? null,
      bodyLocation: dto.bodyLocation,
      side: dto.side,
      dressingType: dto.dressingType,
      isAtypical: false,
      atypicalReason: null,
      nextAllowedAt: null,
      ...dto.metadata,
    };

    await db.insert(interventions).values({
      id,
      patientId,
      recordedByUserId: userId,
      performedAt: performedAtDate,
      type: dto.type,
      episodeTags: dto.episodeIds ? JSON.stringify(dto.episodeIds) : null,
      resolvesEpisodeIds: dto.resolvesEpisodeIds ? JSON.stringify(dto.resolvesEpisodeIds) : null,
      notes: dto.notes,
      metadata: JSON.stringify(metadata),
      interventionScheduleId: dto.interventionScheduleId ?? null,
    });

    let episodeIds = dto.episodeIds ? [...dto.episodeIds] : [];
    if (dto.startEpisodeName) {
      const newEpisodeId = await this.episodesService.createFromEvent({
        patientId,
        userId,
        name: dto.startEpisodeName,
        startedAtType: 'intervention',
        startedAtId: id,
      });
      episodeIds.push(newEpisodeId);
      await db
        .update(interventions)
        .set({ episodeTags: JSON.stringify(episodeIds) })
        .where(eq(interventions.id, id));
    }

    if (dto.resolvesEpisodeIds && dto.resolvesEpisodeIds.length) {
      await this.episodesService.resolveEpisodes(patientId, userId, dto.resolvesEpisodeIds, 'intervention', id);
    }

    if (dto.type === 'medication_dose' && dto.amountMg && dto.doseSource) {
      // Placeholder atypical computation: if doseSource override and no guideline, flag atypical
      const isAtypical = dto.doseSource === 'override';
      if (isAtypical) {
        metadata.isAtypical = true;
        metadata.atypicalReason = 'override_entered';
        await db
          .update(interventions)
          .set({ metadata: JSON.stringify(metadata) })
          .where(eq(interventions.id, id));
      }
    }

    return this.get(id, userId);
  }

  async list(
    patientId: string,
    userId: string,
    params: { type?: string; episodeId?: string; from?: number; to?: number; medicationId?: string },
  ) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(interventions)
      .where(eq(interventions.patientId, patientId))
      .orderBy(desc(interventions.performedAt));

    const filtered = rows.filter((row: any) => {
      const ts = row.performedAt instanceof Date ? Math.floor(row.performedAt.getTime() / 1000) : row.performedAt;
      if (params.from && ts < params.from) return false;
      if (params.to && ts > params.to) return false;
      const metadata = row.metadata ? JSON.parse(row.metadata) : {};
      if (params.medicationId && metadata.medicationId !== params.medicationId) return false;
      if (params.episodeId) {
        const episodes = row.episodeTags ? JSON.parse(row.episodeTags) : [];
        if (!episodes.includes(params.episodeId)) return false;
      }
      if (params.type && row.type !== params.type) return false;
      return true;
    });

    return filtered.map((r: any) => this.mapIntervention(r));
  }

  async get(id: string, userId: string, patientId?: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(interventions).where(eq(interventions.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('INTERVENTION_NOT_FOUND');
    const row = rows[0];
    if (patientId && row.patientId !== patientId) {
      throw new NotFoundException('INTERVENTION_NOT_FOUND');
    }
    await this.ensurePatientAccess(row.patientId, userId);
    return this.mapIntervention(row);
  }

  async update(id: string, userId: string, dto: UpdateInterventionDto) {
    const db = this.db.db as any;
    const rows = await db.select().from(interventions).where(eq(interventions.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('INTERVENTION_NOT_FOUND');
    const row = rows[0];
    await this.ensurePatientAccess(row.patientId, userId);
    const currentEpisodeIds = row.episodeTags ? JSON.parse(row.episodeTags) : [];
    this.ensureResolvesSubset({
      episodeIds: dto.episodeIds ?? currentEpisodeIds,
      resolvesEpisodeIds: dto.resolvesEpisodeIds,
    });

    const updates: Record<string, any> = {};
    if (dto.episodeIds) updates.episodeTags = JSON.stringify(dto.episodeIds);
    if (dto.resolvesEpisodeIds) updates.resolvesEpisodeIds = JSON.stringify(dto.resolvesEpisodeIds);
    if (dto.notes !== undefined) updates.notes = dto.notes;

    let metadata = row.metadata ? JSON.parse(row.metadata) : {};
    if (dto.metadata) {
      metadata = { ...metadata, ...dto.metadata };
    }
    // merge type-specific fields
    const mergeFields = [
      'medicationId',
      'medicationEmbodimentId',
      'doseSource',
      'amountMg',
      'amountMl',
      'pillCount',
      'weightKgUsed',
      'ageMonthsUsed',
      'guidelineId',
      'interventionScheduleId',
      'bodyLocation',
      'side',
      'dressingType',
    ] as const;
    for (const key of mergeFields) {
      if (dto[key] !== undefined) {
        metadata[key] = dto[key];
        if (key === 'interventionScheduleId') {
          updates.interventionScheduleId = dto[key] as any;
        }
      }
    }
    updates.metadata = JSON.stringify(metadata);

    if (Object.keys(updates).length) {
      await db.update(interventions).set(updates).where(eq(interventions.id, id));
    }

    return this.get(id, userId);
  }
}
