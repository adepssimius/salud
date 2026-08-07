import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  adverseReactions,
  careTeamMemberships,
  interventions,
  medicationEmbodiments,
  medicationGuidelines,
  medications,
  patients,
} from '../../db/schema';
import {
  AdvisoryCandidate,
  AgeBandGuidance,
  WeightBasedGuidance,
} from '@salud/shared/types';

function normalizeTs(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

export interface DoseEvaluationInput {
  medicationId: string;
  embodimentId?: string | null;
  amountMg?: number | null;
  occurredAt: Date;
  // Set when re-evaluating an existing dose (InterventionsService.update) so that dose's own row
  // doesn't count itself as a prior dose in the daily-total / interval checks.
  excludeInterventionId?: string;
}

export interface DoseEvaluation {
  guidance: {
    weightBased: WeightBasedGuidance | null;
    ageBand: AgeBandGuidance | null;
  };
  ageMonthsUsed: number;
  weightKgUsed: number | null;
  dailyTotalMgBefore: number;
  dailyTotalMg: number | null; // prospective total including the candidate amount; null if no amount given
  nextAllowedAt: number | null; // this candidate dose's own forward next-allowed time
  intervalTooShort: boolean;
  exceedsMaxPerDose: boolean;
  exceedsMaxPerDay: boolean;
  // stale_weight / expired_embodiment only — atypical_dose is composed by the caller,
  // which alone knows whether doseSource is 'override' (see advisories.md).
  advisories: AdvisoryCandidate[];
}

const STALE_WEIGHT_DAYS = 60;

@Injectable()
export class DosingService {
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

  private ageInMonths(dateOfBirth: string, at: Date): number {
    const dob = new Date(dateOfBirth);
    let months = (at.getFullYear() - dob.getFullYear()) * 12 + (at.getMonth() - dob.getMonth());
    if (at.getDate() < dob.getDate()) months -= 1;
    return Math.max(0, months);
  }

  // Embodiment-specific guideline wins over medication-level; guidelines with an age range
  // that excludes the patient's current age are skipped entirely (api.md "Dosing engine").
  private resolveGuideline(
    guidelines: any[],
    type: 'weight_based' | 'age_band',
    embodimentId: string | null | undefined,
    ageMonths: number,
  ) {
    const applicable = guidelines.filter((g) => {
      if (g.type !== type) return false;
      if (g.ageMinMonths != null && ageMonths < g.ageMinMonths) return false;
      if (g.ageMaxMonths != null && ageMonths > g.ageMaxMonths) return false;
      return true;
    });
    if (!applicable.length) return null;
    const embodimentMatch = embodimentId
      ? applicable.find((g) => g.medicationEmbodimentId === embodimentId)
      : undefined;
    if (embodimentMatch) return embodimentMatch;
    return applicable.find((g) => !g.medicationEmbodimentId) ?? applicable[0];
  }

  async evaluate(patientId: string, userId: string, input: DoseEvaluationInput): Promise<DoseEvaluation> {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;

    const patientRows = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patientRows.length) throw new NotFoundException('PATIENT_NOT_FOUND');
    const patient = patientRows[0];

    const occurredAtTs = Math.floor(input.occurredAt.getTime() / 1000);
    const ageMonths = this.ageInMonths(patient.dateOfBirth, input.occurredAt);

    const guidelineRows = await db
      .select()
      .from(medicationGuidelines)
      .where(eq(medicationGuidelines.medicationId, input.medicationId));

    const weightBasedGuideline = this.resolveGuideline(guidelineRows, 'weight_based', input.embodimentId, ageMonths);
    const ageBandGuideline = this.resolveGuideline(guidelineRows, 'age_band', input.embodimentId, ageMonths);

    const weightKgUsed: number | null = patient.latestWeightKg ?? null;
    const weightRecordedAt = normalizeTs(patient.latestWeightRecordedAt);

    let weightBased: WeightBasedGuidance | null = null;
    if (weightBasedGuideline && weightKgUsed != null) {
      const computedMg = Math.min(
        weightBasedGuideline.mgPerKg * weightKgUsed,
        weightBasedGuideline.maxMgPerDose ?? Number.POSITIVE_INFINITY,
      );
      weightBased = {
        guidelineId: weightBasedGuideline.id,
        source: weightBasedGuideline.source,
        mgPerKg: weightBasedGuideline.mgPerKg,
        computedMg,
        maxMgPerDose: weightBasedGuideline.maxMgPerDose,
        maxMgPerDay: weightBasedGuideline.maxMgPerDay,
        minIntervalHours: weightBasedGuideline.minIntervalHours,
        weightKgUsed,
        weightRecordedAt,
      };
    }

    let ageBand: AgeBandGuidance | null = null;
    if (ageBandGuideline) {
      ageBand = {
        guidelineId: ageBandGuideline.id,
        source: ageBandGuideline.source,
        doseMg: ageBandGuideline.doseMg,
        doseMl: ageBandGuideline.doseMl,
        pillCount: ageBandGuideline.pillCount,
        frequencyPerDay: ageBandGuideline.frequencyPerDay,
        maxMgPerDay: ageBandGuideline.maxMgPerDay,
        ageMonthsUsed: ageMonths,
        applicable: true,
      };
    }

    // Daily total + most recent prior dose of this medication, for the interval/max-per-day checks.
    const doseRows = await db
      .select()
      .from(interventions)
      .where(and(eq(interventions.patientId, patientId), eq(interventions.type, 'medication_dose')));

    const dayStartTs = occurredAtTs - 24 * 60 * 60;
    let dailyTotalMgBefore = 0;
    let lastDose: { performedAt: number; nextAllowedAt: number | null } | null = null;
    for (const row of doseRows) {
      if (input.excludeInterventionId && row.id === input.excludeInterventionId) continue;
      const metadata = row.metadata ? JSON.parse(row.metadata) : {};
      if (metadata.medicationId !== input.medicationId) continue;
      const performedAtTs = normalizeTs(row.performedAt);
      // Epoch-second granularity means two doses logged moments apart (a quick re-tap, or two
      // requests in the same automated test) can share a timestamp — treat same-second doses as
      // prior, not future, so the interval/daily-total checks don't silently miss them.
      if (performedAtTs === null || performedAtTs > occurredAtTs) continue;
      if (performedAtTs >= dayStartTs) {
        dailyTotalMgBefore += Number(metadata.amountMg) || 0;
      }
      if (!lastDose || performedAtTs > lastDose.performedAt) {
        lastDose = { performedAt: performedAtTs, nextAllowedAt: metadata.nextAllowedAt ?? null };
      }
    }

    const intervalTooShort =
      !!lastDose && lastDose.nextAllowedAt != null && occurredAtTs < lastDose.nextAllowedAt;

    let intervalHours: number | null = null;
    if (weightBasedGuideline?.minIntervalHours) intervalHours = weightBasedGuideline.minIntervalHours;
    else if (ageBandGuideline?.frequencyPerDay) intervalHours = 24 / ageBandGuideline.frequencyPerDay;
    const nextAllowedAt = intervalHours != null ? occurredAtTs + Math.round(intervalHours * 3600) : null;

    let dailyTotalMg: number | null = null;
    let exceedsMaxPerDose = false;
    let exceedsMaxPerDay = false;
    if (input.amountMg != null) {
      dailyTotalMg = dailyTotalMgBefore + input.amountMg;
      const maxPerDose = weightBasedGuideline?.maxMgPerDose ?? null;
      if (maxPerDose != null && input.amountMg > maxPerDose) exceedsMaxPerDose = true;
      const maxPerDay = weightBasedGuideline?.maxMgPerDay ?? ageBandGuideline?.maxMgPerDay ?? null;
      if (maxPerDay != null && dailyTotalMg > maxPerDay) exceedsMaxPerDay = true;
    }

    const advisories: AdvisoryCandidate[] = [];
    if (weightRecordedAt === null) {
      advisories.push({
        type: 'stale_weight',
        severity: 'warning',
        payload: { daysSince: null, lastRecordedAt: null },
      });
    } else {
      const daysSince = Math.floor((occurredAtTs - weightRecordedAt) / 86400);
      if (daysSince > STALE_WEIGHT_DAYS) {
        advisories.push({
          type: 'stale_weight',
          severity: 'warning',
          payload: { daysSince, lastRecordedAt: weightRecordedAt },
        });
      }
    }

    if (input.embodimentId) {
      const embRows = await db
        .select()
        .from(medicationEmbodiments)
        .where(eq(medicationEmbodiments.id, input.embodimentId))
        .limit(1);
      const expiresAt = normalizeTs(embRows[0]?.expiresAt);
      if (expiresAt !== null && expiresAt < occurredAtTs) {
        advisories.push({
          type: 'expired_embodiment',
          severity: 'warning',
          sourceType: 'embodiment',
          sourceId: input.embodimentId,
          payload: { expiresAt },
        });
      }
    }

    // Reaction matching: exact scope match only, never inferred (data-model.md → "Data integrity
    // rules"). Runs for both the dose-checks preview and the save path, since both call evaluate()
    // with the same medicationId/embodimentId inputs.
    const medicationRows = await db
      .select()
      .from(medications)
      .where(eq(medications.id, input.medicationId))
      .limit(1);
    const medicationTags: string[] = medicationRows[0]?.tags ? JSON.parse(medicationRows[0].tags) : [];
    const reactionRows = await db
      .select()
      .from(adverseReactions)
      .where(eq(adverseReactions.patientId, patientId));
    for (const reaction of reactionRows) {
      const matches =
        (reaction.scopeType === 'medication' && reaction.medicationId === input.medicationId) ||
        (reaction.scopeType === 'embodiment' &&
          !!input.embodimentId &&
          reaction.embodimentId === input.embodimentId) ||
        (reaction.scopeType === 'tag' && !!reaction.tag && medicationTags.includes(reaction.tag));
      if (!matches) continue;
      advisories.push({
        type: reaction.severity === 'danger' ? 'reaction_danger' : 'reaction_warning',
        severity: reaction.severity,
        sourceType: 'reaction',
        sourceId: reaction.id,
        payload: { description: reaction.description, occurredAt: normalizeTs(reaction.occurredAt) },
      });
    }

    return {
      guidance: { weightBased, ageBand },
      ageMonthsUsed: ageMonths,
      weightKgUsed,
      dailyTotalMgBefore,
      dailyTotalMg,
      nextAllowedAt,
      intervalTooShort,
      exceedsMaxPerDose,
      exceedsMaxPerDay,
      advisories,
    };
  }
}
