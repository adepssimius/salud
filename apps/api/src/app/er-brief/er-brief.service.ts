import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  adverseReactions,
  advisories,
  erBriefSnapshots,
  interventions,
  medications,
  users,
} from '../../db/schema';
import { PatientsService } from '../patients/patients.service';
import { EpisodesService } from '../episodes/episodes.service';
import { ConditionsService } from '../conditions/conditions.service';
import { SchedulesService } from '../schedules/schedules.service';
import { TimelineService } from '../timeline/timeline.service';
import {
  CreateErBriefSnapshotDto,
  ErBrief,
  ErBriefActiveSchedule,
  ErBriefEpisodeSummary,
  ErBriefSnapshotResponse,
  ErBriefSnapshotSummary,
  SharedErBriefResponse,
  TimelineEntry,
} from '@salud/shared/types';
import { normalizeTs } from '../persistence/time';

const DEFAULT_SNAPSHOT_HOURS = 72;
const MAX_SNAPSHOT_HOURS = 168;

function ageFromDob(dateOfBirth: string): { ageYears: number; ageMonths: number } {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  if (now.getDate() < dob.getDate()) months -= 1;
  months = Math.max(0, months);
  return { ageYears: Math.floor(months / 12), ageMonths: months };
}

@Injectable()
export class ErBriefService {
  constructor(
    private readonly db: DatabaseService,
    private readonly patientsService: PatientsService,
    private readonly episodesService: EpisodesService,
    private readonly conditionsService: ConditionsService,
    private readonly schedulesService: SchedulesService,
    private readonly timelineService: TimelineService,
  ) {}

  async build(patientId: string, userId: string, episodeId?: string): Promise<ErBrief> {
    const db = this.db.db as any;
    const patient = await this.patientsService.get(patientId, userId);

    const { ageYears, ageMonths } = ageFromDob(patient.dateOfBirth);
    const latestWeight =
      patient.latestWeightKg != null && patient.latestWeightRecordedAt != null
        ? { kg: patient.latestWeightKg, recordedAt: patient.latestWeightRecordedAt }
        : null;

    let codeStatus = null as ErBrief['header']['codeStatus'];
    if (patient.codeStatus && patient.codeStatusSetByUserId && patient.codeStatusSetAt != null) {
      const setterRows = await db.select().from(users).where(eq(users.id, patient.codeStatusSetByUserId)).limit(1);
      codeStatus = {
        value: patient.codeStatus,
        setByUserId: patient.codeStatusSetByUserId,
        setByName: setterRows[0]?.displayName ?? 'unknown',
        setAt: patient.codeStatusSetAt,
      };
    }

    const dangerReactionRows = await db
      .select()
      .from(adverseReactions)
      .where(and(eq(adverseReactions.patientId, patientId), eq(adverseReactions.severity, 'danger')));
    const dangerReactions = dangerReactionRows.map((r: any) => ({
      id: r.id,
      patientId: r.patientId,
      description: r.description,
      occurredAt: normalizeTs(r.occurredAt),
      recordedByUserId: r.recordedByUserId,
      severity: r.severity,
      scopeType: r.scopeType,
      medicationId: r.medicationId ?? null,
      embodimentId: r.embodimentId ?? null,
      tag: r.tag ?? null,
      createdAt: normalizeTs(r.createdAt),
      updatedAt: normalizeTs(r.updatedAt),
    }));

    const activeConditions = await this.conditionsService.listForPatient(patientId, userId, 'active');

    const allEpisodes = await this.episodesService.listForPatient(patientId, userId);
    let episode: (typeof allEpisodes)[number] | null = null;
    if (episodeId) {
      episode = allEpisodes.find((e: any) => e.id === episodeId) ?? null;
      if (!episode) throw new NotFoundException('EPISODE_NOT_FOUND');
    } else {
      const activeEpisodes = allEpisodes.filter((e: any) => e.status === 'active');
      episode = activeEpisodes.length
        ? activeEpisodes.reduce((latest: any, e: any) => ((e.startedAt ?? 0) > (latest.startedAt ?? 0) ? e : latest))
        : null;
    }

    const episodeSummary: ErBriefEpisodeSummary | null = episode
      ? {
          id: episode.id,
          name: episode.name,
          status: episode.status,
          startedAt: episode.startedAt,
          endedAt: episode.endedAt,
        }
      : null;

    const timeline = episode
      ? await this.timelineService.getTimeline(patientId, userId, { episodeId: episode.id })
      : { entries: [] as any[] };
    const events = timeline.entries as TimelineEntry[];

    // Most recent protocol_fired advisory among this episode's events populates the header
    // "reason for visit" line (F-7.5) — a straight read of an existing advisory, not inference.
    const protocolAdvisories = events.filter((e: any) => e.kind === 'advisory' && e.type === 'protocol_fired');
    const latestProtocol = protocolAdvisories.sort((a: any, b: any) => b.timestamp - a.timestamp)[0];
    const latestProtocolPayload = (latestProtocol?.display as any)?.payload;
    const protocolFiredReason = latestProtocol
      ? {
          protocolName: latestProtocolPayload?.protocolName ?? null,
          instructionText: latestProtocolPayload?.instructionText ?? null,
          sourceText: latestProtocolPayload?.sourceText ?? null,
          triggerMetric: latestProtocolPayload?.triggerMetric ?? null,
          triggerOperator: latestProtocolPayload?.triggerOperator ?? null,
          triggerValue: latestProtocolPayload?.triggerValue ?? null,
          observedValue: latestProtocolPayload?.observedValue ?? null,
          firedAt: latestProtocol.timestamp,
        }
      : null;

    const priorEpisodes: ErBriefEpisodeSummary[] = episode?.conditionId
      ? allEpisodes
          .filter((e: any) => e.conditionId === episode!.conditionId && e.id !== episode!.id)
          .sort((a: any, b: any) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
          .map((e: any) => ({ id: e.id, name: e.name, status: e.status, startedAt: e.startedAt, endedAt: e.endedAt }))
      : [];

    const activeSchedules = await this.buildActiveSchedules(patientId, userId);

    const interventionEventIds = new Set(
      events.filter((e: any) => e.kind === 'intervention').map((e: any) => e.id),
    );
    const advisoryRows = interventionEventIds.size
      ? await db
          .select()
          .from(advisories)
          .where(and(eq(advisories.patientId, patientId), eq(advisories.type, 'atypical_dose')))
      : [];
    const atypicalAdvisories = advisoryRows
      .filter((r: any) => interventionEventIds.has(r.contextId))
      .map((r: any) => ({
        id: r.id,
        patientId: r.patientId,
        type: r.type,
        severity: r.severity,
        sourceType: r.sourceType ?? null,
        sourceId: r.sourceId ?? null,
        contextType: r.contextType ?? null,
        contextId: r.contextId ?? null,
        payload: r.payload ? JSON.parse(r.payload) : null,
        acknowledgedByUserId: r.acknowledgedByUserId ?? null,
        acknowledgedAt: normalizeTs(r.acknowledgedAt),
        createdAt: normalizeTs(r.createdAt),
        updatedAt: normalizeTs(r.updatedAt),
      }));

    return {
      header: {
        patient: {
          id: patient.id,
          fullName: patient.fullName,
          dateOfBirth: patient.dateOfBirth,
          sexAtBirth: patient.sexAtBirth,
          ageYears,
          ageMonths,
        },
        latestWeight,
        codeStatus,
        dangerReactions,
        activeConditions,
        protocolFiredReason,
      },
      body: {
        episode: episodeSummary,
        events,
        activeSchedules,
        priorEpisodes,
        atypicalAdvisories,
      },
    };
  }

  private async buildActiveSchedules(patientId: string, userId: string): Promise<ErBriefActiveSchedule[]> {
    const db = this.db.db as any;
    const schedules = await this.schedulesService.listForPatient(patientId, userId, { status: 'active' });
    const result: ErBriefActiveSchedule[] = [];
    for (const schedule of schedules) {
      let medicationName: string | null = null;
      if (schedule.medicationId) {
        const medRows = await db.select().from(medications).where(eq(medications.id, schedule.medicationId)).limit(1);
        medicationName = medRows[0]?.name ?? null;
      }
      let lastDoseAt: number | null = null;
      let lastDoseMg: number | null = null;
      let lastDoseMgPerKg: number | null = null;
      let nextAllowedAt: number | null = null;
      if (schedule.type === 'medication_dose') {
        const doseRows = await db
          .select()
          .from(interventions)
          .where(eq(interventions.scheduleId, schedule.id));
        const withTs = doseRows.map((r: any) => ({ ...r, ts: normalizeTs(r.performedAt) ?? 0 }));
        const last = withTs.sort((a: any, b: any) => b.ts - a.ts)[0];
        if (last) {
          const metadata = last.metadata ? JSON.parse(last.metadata) : {};
          lastDoseAt = last.ts;
          lastDoseMg = metadata.amountMg ?? null;
          lastDoseMgPerKg =
            metadata.amountMg != null && metadata.weightKgUsed
              ? Math.round((metadata.amountMg / metadata.weightKgUsed) * 100) / 100
              : null;
          nextAllowedAt = metadata.nextAllowedAt ?? null;
        }
      }
      result.push({
        scheduleId: schedule.id,
        label: schedule.label,
        medicationId: schedule.medicationId,
        medicationName,
        lastDoseAt,
        lastDoseMg,
        lastDoseMgPerKg,
        nextAllowedAt,
      });
    }
    return result;
  }

  // Computes the brief once, at creation time, and freezes it — the snapshot never recomputes
  // (er-brief.md → "Frozen snapshot"). The token is the only capability; there is no other guard.
  async createSnapshot(
    patientId: string,
    userId: string,
    dto: CreateErBriefSnapshotDto,
    origin: string,
  ): Promise<ErBriefSnapshotResponse> {
    const payload = await this.build(patientId, userId, dto.episodeId);
    const db = this.db.db as any;
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const hours = Math.min(dto.expiresInHours ?? DEFAULT_SNAPSHOT_HOURS, MAX_SNAPSHOT_HOURS);
    const expiresAt = new Date(Date.now() + hours * 3600_000);

    await db.insert(erBriefSnapshots).values({
      id,
      patientId,
      episodeId: dto.episodeId ?? null,
      token,
      payload: JSON.stringify(payload),
      createdByUserId: userId,
      expiresAt,
    });

    return {
      token,
      url: `${origin}/brief/${token}`,
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
    };
  }

  // Deliberately omits the token — see ErBriefSnapshotSummary. Lets a caregiver find a link to
  // revoke without ever needing the token surfaced again after creation.
  async listSnapshots(patientId: string, userId: string): Promise<ErBriefSnapshotSummary[]> {
    await this.patientsService.get(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(erBriefSnapshots)
      .where(eq(erBriefSnapshots.patientId, patientId))
      .orderBy(desc(erBriefSnapshots.createdAt));
    return rows.map((r: any) => ({
      id: r.id,
      episodeId: r.episodeId ?? null,
      createdByUserId: r.createdByUserId,
      createdAt: normalizeTs(r.createdAt)!,
      expiresAt: normalizeTs(r.expiresAt)!,
    }));
  }

  // Unauthenticated by design (security.md → "ER Brief snapshot tokens"). Missing and expired
  // tokens are indistinguishable, mirroring PATIENT_NOT_FOUND's non-disclosure elsewhere.
  async getShared(token: string): Promise<SharedErBriefResponse> {
    const db = this.db.db as any;
    const rows = await db.select().from(erBriefSnapshots).where(eq(erBriefSnapshots.token, token)).limit(1);
    if (!rows.length) throw new NotFoundException('SNAPSHOT_NOT_FOUND');
    const row = rows[0];
    const expiresAt = normalizeTs(row.expiresAt)!;
    const nowTs = Math.floor(Date.now() / 1000);
    if (expiresAt < nowTs) throw new NotFoundException('SNAPSHOT_NOT_FOUND');
    return {
      payload: JSON.parse(row.payload),
      frozenAt: normalizeTs(row.createdAt)!,
      expiresAt,
    };
  }

  async revokeSnapshot(id: string, userId: string): Promise<{ deleted: boolean }> {
    const db = this.db.db as any;
    const rows = await db.select().from(erBriefSnapshots).where(eq(erBriefSnapshots.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('SNAPSHOT_NOT_FOUND');
    const row = rows[0];
    // Any caregiver on the care team may revoke, not just the creator (P4).
    await this.patientsService.get(row.patientId, userId);
    await db.delete(erBriefSnapshots).where(eq(erBriefSnapshots.id, id));
    return { deleted: true };
  }
}
