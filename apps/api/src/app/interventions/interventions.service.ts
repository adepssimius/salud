import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  episodesEventsPivot,
  interventions,
} from '../../db/schema';
import { CreateInterventionDto } from './dto/create-intervention.dto';
import { UpdateInterventionDto } from './dto/update-intervention.dto';
import { EpisodesService } from '../episodes/episodes.service';
import { DosingService, DoseEvaluation } from '../dosing/dosing.service';
import { AdvisoriesService } from '../advisories/advisories.service';
import { RevisionsService } from '../revisions/revisions.service';
import { normalizeTs } from '../persistence/time';

@Injectable()
export class InterventionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly episodesService: EpisodesService,
    private readonly dosingService: DosingService,
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

  private mapIntervention(row: any, episodeIds: string[] = [], resolvesEpisodeIds: string[] = []) {
    const performedAt = normalizeTs(row.performedAt);
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      id: row.id,
      patientId: row.patientId,
      recordedByUserId: row.recordedByUserId,
      performedAt,
      type: row.type,
      episodeIds,
      resolvesEpisodeIds,
      notes: row.notes ?? null,
      scheduleId: row.scheduleId ?? null,
      metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async persistDoseAdvisories(
    patientId: string,
    interventionId: string,
    userId: string,
    evaluation: DoseEvaluation,
    reasons: string[],
    guidelineId: string | null,
    amountMg: number | null | undefined,
  ) {
    if (reasons.length) {
      await this.advisoriesService.create({
        patientId,
        type: 'atypical_dose',
        severity: 'warning',
        ...(guidelineId ? { sourceType: 'guideline' as const, sourceId: guidelineId } : {}),
        contextType: 'intervention',
        contextId: interventionId,
        payload: { reasons, amountMg: amountMg ?? null, dailyTotalMg: evaluation.dailyTotalMg },
        acknowledgedByUserId: userId,
      });
    }
    for (const candidate of evaluation.advisories) {
      await this.advisoriesService.create({
        patientId,
        type: candidate.type,
        severity: candidate.severity,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        contextType: 'intervention',
        contextId: interventionId,
        payload: candidate.payload,
        acknowledgedByUserId: userId,
      });
    }
  }

  async create(patientId: string, userId: string, dto: CreateInterventionDto) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const id = randomUUID();
    const performedAtDate = new Date(dto.performedAt);
    const performedAtTs = Math.floor(performedAtDate.getTime() / 1000);

    let doseEvaluation: DoseEvaluation | null = null;
    if (dto.type === 'medication_dose' && dto.medicationId) {
      doseEvaluation = await this.dosingService.evaluate(patientId, userId, {
        medicationId: dto.medicationId,
        embodimentId: dto.medicationEmbodimentId,
        amountMg: dto.amountMg,
        occurredAt: performedAtDate,
      });
    }

    let resolvedGuidelineId: string | null = dto.guidelineId ?? null;
    let resolvedWeightKgUsed: number | null = dto.weightKgUsed ?? null;
    let resolvedAgeMonthsUsed: number | null = dto.ageMonthsUsed ?? null;
    let resolvedNextAllowedAt: number | null = null;
    const reasons: string[] = [];

    if (doseEvaluation) {
      resolvedAgeMonthsUsed = doseEvaluation.ageMonthsUsed;
      resolvedNextAllowedAt = doseEvaluation.nextAllowedAt;
      if (dto.doseSource === 'weight_based') {
        resolvedGuidelineId = doseEvaluation.guidance.weightBased?.guidelineId ?? null;
        resolvedWeightKgUsed = doseEvaluation.guidance.weightBased?.weightKgUsed ?? doseEvaluation.weightKgUsed ?? null;
      } else if (dto.doseSource === 'age_based') {
        resolvedGuidelineId = doseEvaluation.guidance.ageBand?.guidelineId ?? null;
        resolvedWeightKgUsed = doseEvaluation.weightKgUsed ?? null;
      } else {
        // override: no guideline to resolve — honor whatever the client sent (data-model.md).
        resolvedWeightKgUsed = dto.weightKgUsed ?? doseEvaluation.weightKgUsed ?? null;
        // A dose logged from a standing schedule is executing a plan, not an ad-hoc override —
        // only flag it when there's no schedule backing this dose (data-model.md).
        if (!dto.interventionScheduleId) reasons.push('override');
      }
      if (doseEvaluation.exceedsMaxPerDose) reasons.push('exceeds_max_per_dose');
      if (doseEvaluation.exceedsMaxPerDay) reasons.push('exceeds_max_per_day');
      if (doseEvaluation.intervalTooShort) reasons.push('interval_too_short');
    }

    const metadata = {
      medicationId: dto.medicationId,
      medicationEmbodimentId: dto.medicationEmbodimentId,
      doseSource: dto.doseSource,
      amountMg: dto.amountMg,
      amountMl: dto.amountMl,
      pillCount: dto.pillCount,
      weightKgUsed: resolvedWeightKgUsed,
      ageMonthsUsed: resolvedAgeMonthsUsed,
      guidelineId: resolvedGuidelineId,
      interventionScheduleId: dto.interventionScheduleId ?? null,
      bodyLocation: dto.bodyLocation,
      side: dto.side,
      dressingType: dto.dressingType,
      isAtypical: reasons.length > 0,
      atypicalReason: reasons.length ? reasons.join(',') : null,
      nextAllowedAt: resolvedNextAllowedAt,
      ...dto.metadata,
    };

    await db.insert(interventions).values({
      id,
      patientId,
      recordedByUserId: userId,
      performedAt: performedAtDate,
      type: dto.type,
      notes: dto.notes,
      metadata: JSON.stringify(metadata),
      scheduleId: dto.interventionScheduleId ?? null,
    });

    const episodeIds = new Set<string>(dto.episodeIds || []);
    let startedEpisodeId: string | null = null;
    if (dto.startEpisodeName) {
      startedEpisodeId = await this.episodesService.createFromEvent({
        patientId,
        userId,
        name: dto.startEpisodeName,
        startedAtType: 'intervention',
        startedAtId: id,
        conditionId: dto.startEpisodeConditionId,
      });
      episodeIds.add(startedEpisodeId);
    }

    this.ensureResolvesSubset(dto.resolvesEpisodeIds, Array.from(episodeIds));

    for (const ep of episodeIds) {
      await db.insert(episodesEventsPivot).values({
        id: randomUUID(),
        episodeId: ep,
        eventType: 'intervention',
        eventId: id,
        startsEpisode: startedEpisodeId === ep,
        resolvesEpisode: false,
      });
    }

    if (dto.resolvesEpisodeIds && dto.resolvesEpisodeIds.length) {
      await this.episodesService.resolveEpisodes(patientId, userId, dto.resolvesEpisodeIds, 'intervention', id);
      for (const ep of dto.resolvesEpisodeIds) {
        await db.insert(episodesEventsPivot).values({
          id: randomUUID(),
          episodeId: ep,
          eventType: 'intervention',
          eventId: id,
          startsEpisode: false,
          resolvesEpisode: true,
        });
      }
    }

    if (doseEvaluation) {
      await this.persistDoseAdvisories(
        patientId,
        id,
        userId,
        doseEvaluation,
        reasons,
        resolvedGuidelineId,
        dto.amountMg,
      );
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
      const ts = normalizeTs(row.performedAt);
      if (params.from && ts < params.from) return false;
      if (params.to && ts > params.to) return false;
      const metadata = row.metadata ? JSON.parse(row.metadata) : {};
      if (params.medicationId && metadata.medicationId !== params.medicationId) return false;
      if (params.type && row.type !== params.type) return false;
      return true;
    });

    const ids = filtered.map((r: any) => r.id);
    const pivots = ids.length
      ? await db
          .select()
          .from(episodesEventsPivot)
          .where(and(inArray(episodesEventsPivot.eventId, ids), eq(episodesEventsPivot.eventType, 'intervention')))
      : [];
    const epByEvent: Record<string, { ep: string[]; res: string[] }> = {};
    for (const p of pivots) {
      if (!epByEvent[p.eventId]) epByEvent[p.eventId] = { ep: [], res: [] };
      epByEvent[p.eventId].ep.push(p.episodeId);
      if (p.resolvesEpisode) epByEvent[p.eventId].res.push(p.episodeId);
    }

    let result = filtered.map((r: any) =>
      this.mapIntervention(r, epByEvent[r.id]?.ep || [], epByEvent[r.id]?.res || []),
    );
    if (params.episodeId) {
      result = result.filter((intervention) => intervention.episodeIds.includes(params.episodeId!));
    }
    return result;
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
    const pivots = await db
      .select()
      .from(episodesEventsPivot)
      .where(and(eq(episodesEventsPivot.eventId, id), eq(episodesEventsPivot.eventType, 'intervention')));
    const episodeIds = pivots.filter((p: any) => !p.resolvesEpisode).map((p: any) => p.episodeId);
    const resolvesEpisodeIds = pivots.filter((p: any) => !!p.resolvesEpisode).map((p: any) => p.episodeId);
    return this.mapIntervention(row, episodeIds, resolvesEpisodeIds);
  }

  async update(id: string, userId: string, dto: UpdateInterventionDto) {
    const db = this.db.db as any;
    const rows = await db.select().from(interventions).where(eq(interventions.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('INTERVENTION_NOT_FOUND');
    const row = rows[0];
    await this.ensurePatientAccess(row.patientId, userId);

    const preUpdateSnapshot = await this.get(id, userId);
    await this.revisionsService.capture('intervention', id, preUpdateSnapshot, userId);

    const pivotRows = await db
      .select()
      .from(episodesEventsPivot)
      .where(and(eq(episodesEventsPivot.eventId, id), eq(episodesEventsPivot.eventType, 'intervention')));
    const existingEpisodeIds: string[] = Array.from(
      new Set<string>(pivotRows.filter((p: any) => !p.resolvesEpisode).map((p: any) => p.episodeId)),
    );
    const existingResolveIds: string[] = Array.from(
      new Set<string>(pivotRows.filter((p: any) => p.resolvesEpisode).map((p: any) => p.episodeId)),
    );
    const startedEpisodes = new Set<string>(pivotRows.filter((p: any) => p.startsEpisode).map((p: any) => p.episodeId));

    const episodeIds: string[] = dto.episodeIds ?? existingEpisodeIds;
    const resolvesEpisodeIds: string[] = dto.resolvesEpisodeIds ?? existingResolveIds;
    this.ensureResolvesSubset(resolvesEpisodeIds, episodeIds);

    const updates: Record<string, any> = {};
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
          updates.scheduleId = dto[key] as any;
        }
      }
    }

    // Re-validate atypical logic on every medication_dose update (api.md), not just when
    // dose-affecting fields changed — the underlying guideline/weight/embodiment state may
    // have moved since this dose was logged.
    if (row.type === 'medication_dose' && metadata.medicationId) {
      const performedAtDate = row.performedAt instanceof Date ? row.performedAt : new Date(row.performedAt * 1000);
      const doseEvaluation = await this.dosingService.evaluate(row.patientId, userId, {
        medicationId: metadata.medicationId,
        embodimentId: metadata.medicationEmbodimentId,
        amountMg: metadata.amountMg,
        occurredAt: performedAtDate,
        excludeInterventionId: id,
      });

      const reasons: string[] = [];
      if (metadata.doseSource === 'weight_based') {
        metadata.guidelineId = doseEvaluation.guidance.weightBased?.guidelineId ?? null;
        metadata.weightKgUsed = doseEvaluation.guidance.weightBased?.weightKgUsed ?? doseEvaluation.weightKgUsed ?? null;
      } else if (metadata.doseSource === 'age_based') {
        metadata.guidelineId = doseEvaluation.guidance.ageBand?.guidelineId ?? null;
      } else if (metadata.doseSource === 'override' && !metadata.interventionScheduleId) {
        reasons.push('override');
      }
      metadata.ageMonthsUsed = doseEvaluation.ageMonthsUsed;
      metadata.nextAllowedAt = doseEvaluation.nextAllowedAt;
      if (doseEvaluation.exceedsMaxPerDose) reasons.push('exceeds_max_per_dose');
      if (doseEvaluation.exceedsMaxPerDay) reasons.push('exceeds_max_per_day');
      if (doseEvaluation.intervalTooShort) reasons.push('interval_too_short');
      metadata.isAtypical = reasons.length > 0;
      metadata.atypicalReason = reasons.length ? reasons.join(',') : null;

      await this.persistDoseAdvisories(
        row.patientId,
        id,
        userId,
        doseEvaluation,
        reasons,
        metadata.guidelineId ?? null,
        metadata.amountMg,
      );
    }

    updates.metadata = JSON.stringify(metadata);

    if (Object.keys(updates).length) {
      await db.update(interventions).set(updates).where(eq(interventions.id, id));
    }

    if (dto.episodeIds || dto.resolvesEpisodeIds) {
      await db
        .delete(episodesEventsPivot)
        .where(and(eq(episodesEventsPivot.eventId, id), eq(episodesEventsPivot.eventType, 'intervention')));

      for (const ep of episodeIds) {
        await db.insert(episodesEventsPivot).values({
          id: randomUUID(),
          episodeId: ep,
          eventType: 'intervention',
          eventId: id,
          startsEpisode: startedEpisodes.has(ep),
          resolvesEpisode: false,
        });
      }

      if (resolvesEpisodeIds.length) {
        await this.episodesService.resolveEpisodes(row.patientId, userId, resolvesEpisodeIds, 'intervention', id);
        for (const ep of resolvesEpisodeIds) {
          await db.insert(episodesEventsPivot).values({
            id: randomUUID(),
            episodeId: ep,
            eventType: 'intervention',
            eventId: id,
            startsEpisode: false,
            resolvesEpisode: true,
          });
        }
      }
    }

    return this.get(id, userId);
  }

  async getRevisions(id: string, userId: string) {
    await this.get(id, userId); // enforces existence + patient access
    return this.revisionsService.listFor('intervention', id);
  }
}
