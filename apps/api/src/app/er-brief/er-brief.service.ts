import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  adverseReactions,
  advisories,
  erBriefSnapshots,
  fileAssets,
  interventions,
  medications,
  users,
} from '../../db/schema';
import { CareDocumentsService } from '../care-documents/care-documents.service';
import { StorageService } from '../storage/storage.service';
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
  ErBriefEventScope,
  ErBriefSnapshotResponse,
  ErBriefSnapshotSummary,
  SharedErBriefResponse,
  TimelineEntry,
} from '@salud/shared/types';
import { normalizeTs } from '../persistence/time';

/**
 * How far back the body reaches when no episode is open.
 *
 * 72, not 24: 24 duplicates what the dashboard already answers and loses the "third day of fever"
 * arc triage always asks about. A week floods the one-page print. Episodes are a manual frame
 * someone has to remember to start, and an ER visit at 3 AM is precisely the moment nobody did —
 * which is why the body falls back rather than coming back empty (er-brief.md → Scope).
 */
const RECENT_WINDOW_HOURS = 72;

const DEFAULT_SNAPSHOT_HOURS = 72;
const MAX_SNAPSHOT_HOURS = 168;

/**
 * The care-document files a snapshot must keep readable through its token.
 *
 * Pinned at freeze time, so the link serves what was on file at handoff: `FileAsset` blobs are
 * immutable, which makes an id a stable reference to bytes, and a later superseding upload is a
 * different id the old token can never reach (security.md → ER Brief snapshot tokens).
 */
function collectCareDocumentFileIds(payload: ErBrief): string[] {
  const statements = Object.values(payload.header.careDocuments ?? {});
  return [...new Set(statements.map((s) => s?.fileId).filter((id): id is string => !!id))];
}

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
    private readonly careDocumentsService: CareDocumentsService,
    private readonly storage: StorageService,
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

    // All three keys always present; a `null` means never recorded and must stay distinguishable
    // from a stored `status: 'none'` all the way to the page (er-brief.md → Header).
    const careDocuments = await this.careDocumentsService.getMap(patientId, userId);

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

    // One clock read for the whole build, matching getDashboard's convention -- two Date.now()
    // calls could put generatedAt before since + windowHours.
    const nowTs = Math.floor(Date.now() / 1000);
    let eventScope: ErBriefEventScope;
    let timeline: { entries: any[] };
    if (episode) {
      eventScope = { type: 'episode', episodeId: episode.id };
      timeline = await this.timelineService.getTimeline(patientId, userId, { episodeId: episode.id });
    } else {
      const since = nowTs - RECENT_WINDOW_HOURS * 3600;
      eventScope = { type: 'recent', windowHours: RECENT_WINDOW_HOURS, since, generatedAt: nowTs };
      timeline = await this.timelineService.getTimeline(patientId, userId, { from: since });
    }
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

    const toEpisodeSummary = (e: any): ErBriefEpisodeSummary => ({
      id: e.id,
      name: e.name,
      status: e.status,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
    });
    const byNewest = (a: any, b: any) => (b.startedAt ?? 0) - (a.startedAt ?? 0);

    let priorEpisodes: ErBriefEpisodeSummary[];
    if (episode?.conditionId) {
      priorEpisodes = allEpisodes
        .filter((e: any) => e.conditionId === episode!.conditionId && e.id !== episode!.id)
        .sort(byNewest)
        .map(toEpisodeSummary);
    } else if (!episode) {
      // No episode means no conditionId to filter on, but triage's actual question -- "has this
      // happened before?" -- is still worth answering, and a count of prior episodes is a stored
      // fact rather than an inference. Capped at five, stated in the response contract so it's a
      // documented rule and not silent truncation (er-brief.md).
      priorEpisodes = allEpisodes.slice().sort(byNewest).slice(0, 5).map(toEpisodeSummary);
    } else {
      priorEpisodes = [];
    }

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
        careDocuments,
        dangerReactions,
        activeConditions,
        protocolFiredReason,
      },
      body: {
        eventScope,
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
      fileIds: JSON.stringify(collectCareDocumentFileIds(payload)),
      createdByUserId: userId,
      expiresAt,
    });

    return {
      // `id` so the caller can revoke the link it just created without re-listing.
      id,
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
    const frozenAt = normalizeTs(row.createdAt)!;
    return {
      payload: this.backfillEventScope(JSON.parse(row.payload), frozenAt),
      frozenAt,
      expiresAt,
    };
  }

  /**
   * Streams one care-document file frozen into a snapshot — unauthenticated, the token is the only
   * capability (security.md → "ER Brief snapshot tokens").
   *
   * Every failure answers the same 404 `SNAPSHOT_NOT_FOUND`: bad token, expired token, and a
   * `fileId` that exists but was not frozen into *this* snapshot are indistinguishable, so holding
   * a valid token gives no signal to probe for other patients' files with. The authorization is
   * the frozen `fileIds` list, never a care-team lookup — the reader has no account by design.
   */
  async getSharedFile(token: string, fileId: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(erBriefSnapshots).where(eq(erBriefSnapshots.token, token)).limit(1);
    if (!rows.length) throw new NotFoundException('SNAPSHOT_NOT_FOUND');
    const row = rows[0];
    if (normalizeTs(row.expiresAt)! < Math.floor(Date.now() / 1000)) {
      throw new NotFoundException('SNAPSHOT_NOT_FOUND');
    }

    // Snapshots frozen before this column existed carry null and simply have no readable files.
    const frozenIds: string[] = row.fileIds ? JSON.parse(row.fileIds) : [];
    if (!frozenIds.includes(fileId)) throw new NotFoundException('SNAPSHOT_NOT_FOUND');

    const fileRows = await db.select().from(fileAssets).where(eq(fileAssets.id, fileId)).limit(1);
    if (!fileRows.length) throw new NotFoundException('SNAPSHOT_NOT_FOUND');

    return {
      stream: await this.storage.createReadStream(fileRows[0].path),
      contentType: fileRows[0].contentType,
    };
  }

  /**
   * Live snapshots frozen before `eventScope` existed don't carry it, and they stay readable for up
   * to their full 168-hour lifetime. Synthesizing it here — at the single boundary where a stored
   * payload re-enters the app — lets the field stay required in the type and keeps the public page
   * free of defensive branches.
   */
  private backfillEventScope(payload: any, frozenAt: number): any {
    if (!payload?.body || payload.body.eventScope) return payload;
    const episodeId = payload.body.episode?.id;
    payload.body.eventScope = episodeId
      ? { type: 'episode', episodeId }
      : {
          type: 'recent',
          windowHours: RECENT_WINDOW_HOURS,
          since: frozenAt - RECENT_WINDOW_HOURS * 3600,
          generatedAt: frozenAt,
        };
    return payload;
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
