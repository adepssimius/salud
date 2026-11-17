import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  advisories,
  careTeamMemberships,
  episodesEventsPivot,
  interventionSchedules,
  medicationEmbodiments,
  medications,
  interventions,
} from '../../db/schema';
import { CreateInterventionDto } from './dto/create-intervention.dto';
import { UpdateInterventionDto } from './dto/update-intervention.dto';
import { EpisodesService } from '../episodes/episodes.service';
import { DosingService, DoseEvaluation, availabilityKey } from '../dosing/dosing.service';
import { AdvisoriesService } from '../advisories/advisories.service';
import { RevisionsService } from '../revisions/revisions.service';
import { normalizeTs, toDate } from '../persistence/time';
import { medicationTagsByIds } from '../medications/medication-tags';
import { assertNoReservedMetadataKeys } from './reserved-metadata';
import { DoseLimitedBy, DoseSource } from '@salud/shared/types';

/** api.md → `GET /api/patients/:patientId/recent-medications`: "in the last 14 days". */
const RECENT_MEDICATIONS_WINDOW_DAYS = 14;

interface RecentDose {
  lastDoseAt: number;
  lastAmountMg: number | null;
  lastAmountMl: number | null;
  lastEmbodimentId: string | null;
  lastDoseSource: DoseSource | null;
  nextAllowedAt: number | null;
  isAtypicalLastDose: boolean;
}

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
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  /**
   * Attach each dose's medication tags, read from the catalog at read time and never stored on the
   * intervention (api.md → Interventions; the same split as `ObservationEntry.labContext`).
   *
   * CURRENT tags, deliberately: retagging a medication re-classifies its past doses everywhere at
   * once, which is exactly what lets a chart overlay default apply retroactively without a
   * backfill. One batched catalog lookup per response, never one per dose.
   */
  private async withMedicationTags(rows: any[]): Promise<any[]> {
    const ids = rows
      .filter((row) => row.type === 'medication_dose')
      .map((row) => row.metadata?.medicationId)
      .filter((id: unknown): id is string => typeof id === 'string');
    if (!ids.length) return rows;
    const tagsById = await medicationTagsByIds(this.db.db as any, ids);
    for (const row of rows) {
      if (row.type !== 'medication_dose') continue;
      const medicationId = row.metadata?.medicationId;
      if (typeof medicationId !== 'string') continue;
      row.medicationTags = tagsById.get(medicationId) ?? [];
    }
    return rows;
  }

  private async persistDoseAdvisories(
    patientId: string,
    interventionId: string,
    userId: string,
    evaluation: DoseEvaluation,
    guidelineId: string | null,
  ) {
    const atypical = DosingService.atypicalPayload(evaluation);
    if (atypical) {
      await this.advisoriesService.create({
        patientId,
        type: 'atypical_dose',
        severity: 'warning',
        ...(guidelineId ? { sourceType: 'guideline' as const, sourceId: guidelineId } : {}),
        contextType: 'intervention',
        contextId: interventionId,
        payload: atypical,
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

  // Same two rules SchedulesService.create has always enforced, on the events themselves. A dose
  // with no medication isn't merely an empty record: it skips the gate below, so guideline
  // resolution, the dosing engine and every advisory silently do nothing (api.md -> Interventions).
  private assertRequiredForType(
    type: string | undefined,
    fields: { medicationId?: string | null; bodyLocation?: string | null },
  ) {
    if (type === 'medication_dose' && !fields.medicationId) {
      throw new BadRequestException('MEDICATION_ID_REQUIRED');
    }
    if (type === 'dressing_change' && !fields.bodyLocation) {
      throw new BadRequestException('BODY_LOCATION_REQUIRED');
    }
  }

  async create(patientId: string, userId: string, dto: CreateInterventionDto) {
    await this.ensurePatientAccess(patientId, userId);
    this.assertRequiredForType(dto.type, dto);
    assertNoReservedMetadataKeys(dto.metadata);
    const db = this.db.db as any;
    const id = randomUUID();
    const performedAtDate = new Date(dto.performedAt);
    const performedAtTs = Math.floor(performedAtDate.getTime() / 1000);
    // Read-only and before the entry exists: a resolving entry may not land before every member
    // of the episode it resolves (data-model.md → "An episode may not end at its start…").
    await this.episodesService.assertResolvingTimeOrder(patientId, dto.resolvesEpisodeIds, performedAtTs);

    let doseEvaluation: DoseEvaluation | null = null;
    if (dto.type === 'medication_dose' && dto.medicationId) {
      doseEvaluation = await this.dosingService.evaluate(patientId, userId, {
        medicationId: dto.medicationId,
        embodimentId: dto.medicationEmbodimentId,
        amountMg: dto.amountMg,
        amountMl: dto.amountMl,
        pillCount: dto.pillCount,
        occurredAt: performedAtDate,
      });
    }

    let resolvedGuidelineId: string | null = dto.guidelineId ?? null;
    let resolvedWeightKgUsed: number | null = dto.weightKgUsed ?? null;
    let resolvedAgeMonthsUsed: number | null = dto.ageMonthsUsed ?? null;
    let resolvedNextAllowedAt: number | null = null;
    const reasons: string[] = doseEvaluation?.reasons ?? [];

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
        // override / schedule: no guideline to resolve — honor whatever the client sent
        // (data-model.md). How the amount was arrived at is provenance, never itself a reason to
        // flag the dose: `reasons` is the engine's verdict on amount and time alone.
        resolvedWeightKgUsed = dto.weightKgUsed ?? doseEvaluation.weightKgUsed ?? null;
      }
    }
    // A dose given as a volume or a pill count is stored with the mg the engine judged.
    const amountMgDerived = !!doseEvaluation?.amountMgDerived;
    const storedAmountMg = amountMgDerived ? doseEvaluation!.amountMg : dto.amountMg;

    const metadata = {
      medicationId: dto.medicationId,
      medicationEmbodimentId: dto.medicationEmbodimentId,
      doseSource: dto.doseSource,
      amountMg: storedAmountMg,
      ...(amountMgDerived ? { amountMgDerived: true } : {}),
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
      // Extra client keys are welcome; the ones this service owns are not (ISSUES.md #28). The
      // guard above makes the spread order harmless — it can no longer reach a resolved field.
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

    // The episode a startEpisodeName just created trivially belongs to this patient; the ids the
    // client sent do not, until checked.
    await this.episodesService.assertEpisodesBelongToPatient(patientId, userId, dto.episodeIds ?? []);
    this.episodesService.assertResolvesSubset(dto.resolvesEpisodeIds, Array.from(episodeIds));

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

    // A back-dated entry filed into an existing episode becomes its start when it is the earliest
    // member (data-model.md → "An episode starts at its earliest entry").
    await this.episodesService.reconcileEpisodeStartsById(patientId, Array.from(episodeIds));

    if (doseEvaluation) {
      await this.persistDoseAdvisories(
        patientId,
        id,
        userId,
        doseEvaluation,
        resolvedGuidelineId,
      );
    }

    return this.get(id, userId);
  }

  async list(
    patientId: string,
    userId: string,
    params: { type?: string; episodeId?: string; from?: number; to?: number; sinceCreatedAt?: number; medicationId?: string },
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
      // See the matching note in ObservationsService.list -- log time, opt-in, What's-New only.
      if (params.sinceCreatedAt) {
        const created = normalizeTs(row.createdAt);
        if (created === null || created < params.sinceCreatedAt) return false;
      }
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
    return await this.withMedicationTags(result);
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
    const [enriched] = await this.withMedicationTags([this.mapIntervention(row, episodeIds, resolvesEpisodeIds)]);
    return enriched;
  }

  /**
   * `PATCH /api/interventions/:id` — a correction (api.md → that section; data-model.md → "Data
   * integrity rules" → Corrections). Any care team member, any intervention, no time limit.
   *
   * Same two phases as ObservationsService.update, for the same sqlite reason: every check and
   * read first (revision snapshot, dosing evaluation, existing advisories, episode plan), then one
   * transaction of writes only — revision, intervention row, pivot rows, episode state, advisories
   * (ISSUES #39). `type`, `interventionScheduleId` and `doseSource: 'schedule'` never reach here:
   * CorrectionFieldsInterceptor refused them on the raw body (ISSUES #36).
   */
  async update(id: string, userId: string, dto: UpdateInterventionDto) {
    const db = this.db.db as any;
    const rows = await db.select().from(interventions).where(eq(interventions.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('INTERVENTION_NOT_FOUND');
    const row = rows[0];
    const patientId: string = row.patientId;
    await this.ensurePatientAccess(patientId, userId);
    assertNoReservedMetadataKeys(dto.metadata);

    const stored = row.metadata ? JSON.parse(row.metadata) : {};
    // A scheduled dose's source is what the schedule-log path wrote; changing it at all would
    // move the dose in or out of the schedule's adherence story. Rows that predate
    // doseSource: 'schedule' carry 'override' with a scheduleId, hence both tests.
    const isScheduled = !!row.scheduleId || stored.doseSource === 'schedule';
    if (dto.doseSource !== undefined && isScheduled) {
      throw new BadRequestException({ message: 'FIELD_NOT_CORRECTABLE', fields: ['doseSource'] });
    }

    // Merge: stored metadata, then free-form client keys (reserved ones refused above), then the
    // validated top-level fields that were sent.
    const metadata: Record<string, any> = { ...stored, ...(dto.metadata ?? {}) };
    const clientFields = [
      'medicationId',
      'medicationEmbodimentId',
      'doseSource',
      'amountMg',
      'amountMl',
      'pillCount',
      'bodyLocation',
      'side',
      'dressingType',
    ] as const;
    for (const key of clientFields) {
      if (dto[key] !== undefined) metadata[key] = dto[key];
    }
    // Against the merged values, not the DTO: a PATCH clearing medicationId on an existing dose
    // is only visible once the merge has happened.
    this.assertRequiredForType(row.type, metadata);

    const performedAtDate = dto.performedAt !== undefined ? new Date(dto.performedAt) : toDate(row.performedAt)!;
    const performedAtTs = Math.floor(performedAtDate.getTime() / 1000);

    // guidelineId / weightKgUsed / ageMonthsUsed are client-honored under 'override' only, as on
    // create. A value carried over from the stored row is honored only if the stored row was
    // itself an override — otherwise it is an engine resolution, not something a caregiver chose.
    const isOverride = metadata.doseSource === 'override';
    const carryStored = stored.doseSource === 'override';
    const honored = (key: 'guidelineId' | 'weightKgUsed' | 'ageMonthsUsed') =>
      dto[key] !== undefined ? dto[key] : carryStored ? stored[key] : undefined;

    // The mg the caregiver entered, if any. A derived amountMg is not an entry: it follows the
    // volume / pill count it came from (api.md → PATCH /api/interventions/:id).
    const enteredMg: number | null =
      dto.amountMg !== undefined ? dto.amountMg : stored.amountMgDerived ? null : (stored.amountMg ?? null);

    // Re-evaluation is scoped to a dose change (ISSUES #33): only these fields re-run the engine.
    // Anything else leaves every engine-resolved field exactly as logged (N-2). A volume or pill
    // count counts as a dose change only when the mg is derived from it (or missing).
    const doseChanged =
      dto.performedAt !== undefined ||
      dto.medicationId !== undefined ||
      dto.medicationEmbodimentId !== undefined ||
      dto.doseSource !== undefined ||
      dto.amountMg !== undefined ||
      (enteredMg == null && (dto.amountMl !== undefined || dto.pillCount !== undefined));

    const advisoryWrites: Array<Parameters<AdvisoriesService['create']>[0]> = [];
    if (row.type === 'medication_dose' && doseChanged && metadata.medicationId) {
      const evaluation = await this.dosingService.evaluate(patientId, userId, {
        medicationId: metadata.medicationId,
        embodimentId: metadata.medicationEmbodimentId,
        amountMg: enteredMg,
        amountMl: metadata.amountMl,
        pillCount: metadata.pillCount,
        occurredAt: performedAtDate,
        excludeInterventionId: id,
      });

      // Exactly create's resolution, at the corrected time.
      const reasons: string[] = evaluation.reasons;
      metadata.amountMg = evaluation.amountMgDerived ? evaluation.amountMg : (enteredMg ?? undefined);
      if (evaluation.amountMgDerived) metadata.amountMgDerived = true;
      else delete metadata.amountMgDerived;
      metadata.ageMonthsUsed = evaluation.ageMonthsUsed;
      metadata.nextAllowedAt = evaluation.nextAllowedAt;
      if (metadata.doseSource === 'weight_based') {
        metadata.guidelineId = evaluation.guidance.weightBased?.guidelineId ?? null;
        metadata.weightKgUsed = evaluation.guidance.weightBased?.weightKgUsed ?? evaluation.weightKgUsed ?? null;
      } else if (metadata.doseSource === 'age_based') {
        metadata.guidelineId = evaluation.guidance.ageBand?.guidelineId ?? null;
        metadata.weightKgUsed = evaluation.weightKgUsed ?? null;
      } else {
        metadata.guidelineId = isOverride ? honored('guidelineId') ?? null : null;
        metadata.weightKgUsed = (isOverride ? honored('weightKgUsed') : undefined) ?? evaluation.weightKgUsed ?? null;
      }
      const atypicalReason = reasons.length ? reasons.join(',') : null;
      metadata.isAtypical = reasons.length > 0;

      // Advisories are never deleted or rewritten (api.md → "Advisories after a correction"). A
      // new atypical_dose only when the verdict's reasons changed to something non-empty; a
      // stale_weight / expired_embodiment only when this dose has none of that type yet.
      if (atypicalReason && atypicalReason !== (stored.atypicalReason ?? null)) {
        advisoryWrites.push({
          patientId,
          type: 'atypical_dose',
          severity: 'warning',
          ...(metadata.guidelineId ? { sourceType: 'guideline' as const, sourceId: metadata.guidelineId } : {}),
          contextType: 'intervention',
          contextId: id,
          payload: DosingService.atypicalPayload(evaluation)!,
          acknowledgedByUserId: userId,
        });
      }
      metadata.atypicalReason = atypicalReason;
      if (evaluation.advisories.length) {
        const priorTypes = await this.advisoryTypesFor(id);
        for (const candidate of evaluation.advisories) {
          if (priorTypes.has(candidate.type)) continue;
          priorTypes.add(candidate.type);
          advisoryWrites.push({
            patientId,
            type: candidate.type,
            severity: candidate.severity,
            sourceType: candidate.sourceType,
            sourceId: candidate.sourceId,
            contextType: 'intervention',
            contextId: id,
            payload: candidate.payload,
            acknowledgedByUserId: userId,
          });
        }
      }
    } else if (isOverride) {
      // No re-run: the honored fields are still the caregiver's to correct under override, and
      // nothing the engine resolved is touched.
      for (const key of ['guidelineId', 'weightKgUsed', 'ageMonthsUsed'] as const) {
        if (dto[key] !== undefined) metadata[key] = dto[key];
      }
    }

    const episodePlan = await this.episodesService.planEventEpisodeCorrection({
      patientId,
      userId,
      eventType: 'intervention',
      eventId: id,
      episodeIds: dto.episodeIds,
      resolvesEpisodeIds: dto.resolvesEpisodeIds,
      clinicalTime: dto.performedAt !== undefined ? performedAtTs : undefined,
    });

    const snapshot = await this.get(id, userId);

    const updates: Record<string, any> = { metadata: JSON.stringify(metadata), updatedAt: new Date() };
    if (dto.notes !== undefined) updates.notes = dto.notes;
    if (dto.performedAt !== undefined) updates.performedAt = performedAtDate;

    await this.db.withTransaction(async (tx: any) => {
      await this.revisionsService.capture('intervention', id, snapshot, userId, tx);
      await tx.update(interventions).set(updates).where(eq(interventions.id, id));
      await this.episodesService.applyEventEpisodeCorrection(tx, episodePlan);
      for (const advisory of advisoryWrites) await this.advisoriesService.create(advisory, tx);
    });

    return this.get(id, userId);
  }

  /** The advisory types already recorded against this dose. Reads only. */
  private async advisoryTypesFor(interventionId: string): Promise<Set<string>> {
    const db = this.db.db as any;
    const rows = await db
      .select({ type: advisories.type })
      .from(advisories)
      .where(and(eq(advisories.contextType, 'intervention'), eq(advisories.contextId, interventionId)));
    return new Set<string>(rows.map((r: any) => r.type));
  }

  /**
   * `GET /api/patients/:patientId/recent-medications` — the Quick Log "recents first, search
   * second" source (frontend.md → "Information architecture (v2)" → Quick Log; api.md → Timeline
   * & dashboard).
   *
   * The union of two sets: medications given to THIS patient in the last 14 days, and medications
   * on THIS patient's active schedules. One row per distinct medication, most-recent-dose-first,
   * never-given schedule entries last.
   *
   * It lives here rather than in the timeline service because every `last*` field on it is dose
   * history, which is this service's table. The per-patient scoping is not a filter that could be
   * relaxed later: a "same as last time" prefill sourced from a sibling's dose is the wrong-chart
   * hazard the v2 IA exists to prevent (api.md, frontend.md → "Patient identity").
   */
  async recentMedications(patientId: string, userId: string) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;

    const cutoff = Math.floor(Date.now() / 1000) - RECENT_MEDICATIONS_WINDOW_DAYS * 86_400;

    const doseRows = await db
      .select()
      .from(interventions)
      .where(and(eq(interventions.patientId, patientId), eq(interventions.type, 'medication_dose')))
      .orderBy(desc(interventions.performedAt));

    // Most recent dose per medication inside the window. The rows arrive newest-first, so the
    // first sighting of a medication is its latest dose — but performedAt is caregiver-supplied
    // and back-datable, so compare rather than trust the order.
    const lastByMedication = new Map<string, RecentDose>();
    for (const row of doseRows) {
      const metadata = row.metadata ? JSON.parse(row.metadata) : {};
      const medicationId = metadata.medicationId;
      if (!medicationId) continue;
      const performedAt = normalizeTs(row.performedAt);
      if (performedAt === null || performedAt < cutoff) continue;
      const existing = lastByMedication.get(medicationId);
      if (existing && existing.lastDoseAt >= performedAt) continue;
      lastByMedication.set(medicationId, {
        lastDoseAt: performedAt,
        lastAmountMg: metadata.amountMg ?? null,
        lastAmountMl: metadata.amountMl ?? null,
        lastEmbodimentId: metadata.medicationEmbodimentId ?? null,
        // Verbatim, 'schedule' included — see api.md; the prefill decides what to do with it.
        lastDoseSource: metadata.doseSource ?? null,
        nextAllowedAt: metadata.nextAllowedAt ?? null,
        isAtypicalLastDose: !!metadata.isAtypical,
      });
    }

    const scheduleRows = await db
      .select()
      .from(interventionSchedules)
      .where(
        and(
          eq(interventionSchedules.patientId, patientId),
          eq(interventionSchedules.status, 'active'),
          eq(interventionSchedules.type, 'medication_dose'),
        ),
      );
    const scheduledMedicationIds = new Set<string>(
      scheduleRows.map((row: any) => row.medicationId).filter((id: string | null): id is string => !!id),
    );

    const medicationIds = Array.from(new Set<string>([...lastByMedication.keys(), ...scheduledMedicationIds]));
    if (!medicationIds.length) return [];

    // A dose's metadata.medicationId is free text on a JSON blob, not a foreign key, so a
    // medication deleted (or never in the catalog — some suites log against a bare UUID) simply
    // has no name to show. Those rows are dropped rather than rendered nameless: the caller is a
    // list of tappable prefill cards, and an unnamed card is not tappable material.
    const medicationRows = await db.select().from(medications).where(inArray(medications.id, medicationIds));
    const nameById = new Map<string, string>(medicationRows.map((row: any) => [row.id, row.name]));

    const embodimentIds = Array.from(
      new Set<string>(
        Array.from(lastByMedication.values())
          .map((dose) => dose.lastEmbodimentId)
          .filter((id): id is string => !!id),
      ),
    );
    const embodimentRows = embodimentIds.length
      ? await db.select().from(medicationEmbodiments).where(inArray(medicationEmbodiments.id, embodimentIds))
      : [];
    const embodimentLabelById = new Map<string, string>(embodimentRows.map((row: any) => [row.id, row.label]));

    const entries = medicationIds
      .filter((medicationId) => nameById.has(medicationId))
      .map((medicationId) => {
        const dose = lastByMedication.get(medicationId) ?? null;
        return {
          medicationId,
          medicationName: nameById.get(medicationId)!,
          lastDoseAt: dose?.lastDoseAt ?? null,
          lastAmountMg: dose?.lastAmountMg ?? null,
          lastAmountMl: dose?.lastAmountMl ?? null,
          lastEmbodimentId: dose?.lastEmbodimentId ?? null,
          lastEmbodimentLabel: dose?.lastEmbodimentId
            ? embodimentLabelById.get(dose.lastEmbodimentId) ?? null
            : null,
          lastDoseSource: dose?.lastDoseSource ?? null,
          nextAllowedAt: dose?.nextAllowedAt ?? null,
          canGiveAt: null as number | null,
          limitedBy: null as DoseLimitedBy | null,
          isAtypicalLastDose: dose?.isAtypicalLastDose ?? false,
          onActiveSchedule: scheduledMedicationIds.has(medicationId),
        };
      });

    // The live interval-and-daily-max answer, exactly as the dashboard serves it (api.md → "Dosing
    // engine" → "Live availability"). A never-given scheduled medication has nothing to repeat.
    const given = entries.filter((e) => e.lastDoseAt !== null);
    const availability = await this.dosingService.availability(
      userId,
      given.map((e) => ({ patientId, medicationId: e.medicationId, knownLastDoseAt: e.lastDoseAt! })),
    );
    for (const e of entries) {
      const a = e.lastDoseAt !== null ? availability.get(availabilityKey(patientId, e.medicationId)) : undefined;
      e.canGiveAt = a?.canGiveAt ?? null;
      e.limitedBy = a?.limitedBy ?? null;
    }

    entries.sort((a, b) => {
      if (a.lastDoseAt === null && b.lastDoseAt === null) return a.medicationName.localeCompare(b.medicationName);
      if (a.lastDoseAt === null) return 1;
      if (b.lastDoseAt === null) return -1;
      return b.lastDoseAt - a.lastDoseAt;
    });
    return entries;
  }

  async getRevisions(id: string, userId: string) {
    await this.get(id, userId); // enforces existence + patient access
    return this.revisionsService.listFor('intervention', id);
  }
}
