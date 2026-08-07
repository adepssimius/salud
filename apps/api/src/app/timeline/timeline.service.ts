import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  advisories,
  careTeamMemberships,
  episodesEventsPivot,
  interventionSchedules,
  interventions,
  medicationEmbodiments,
  medications,
  observationEntries,
  observations,
  patients,
} from '../../db/schema';
import { PatientsService } from '../patients/patients.service';
import { ObservationsService } from '../observations/observations.service';
import { InterventionsService } from '../interventions/interventions.service';
import { EpisodesService } from '../episodes/episodes.service';

function normalizeTs(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

const STALE_WEIGHT_DAYS = 60;
// The "did I already give Tylenol?" window (product.md → origin story). A hard SQL cutoff, not a
// client-side filter — interventions has no medication_id column (it lives in the metadata JSON
// blob), so every last-dose lookup here is a full scan + JS reduce; bounding it to a day's doses
// keeps that proportional instead of scanning the patient's whole history.
const LAST_DOSE_WINDOW_HOURS = 24;

@Injectable()
export class TimelineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly patientsService: PatientsService,
    private readonly observationsService: ObservationsService,
    private readonly interventionsService: InterventionsService,
    private readonly episodesService: EpisodesService,
  ) {}

  private async resolveMedicationIdsForTag(tag: string): Promise<Set<string>> {
    const db = this.db.db as any;
    const rows = await db.select().from(medications);
    const ids = rows
      .filter((r: any) => {
        const tags = r.tags ? JSON.parse(r.tags) : [];
        return tags.includes(tag);
      })
      .map((r: any) => r.id);
    return new Set(ids);
  }

  async getTimeline(
    patientId: string,
    userId: string,
    params: {
      from?: number;
      to?: number;
      episodeId?: string;
      includeObservations?: boolean;
      includeInterventions?: boolean;
      medicationTag?: string;
      medicationId?: string;
    },
  ) {
    const patient = await this.patientsService.get(patientId, userId);
    const db = this.db.db as any;

    const entries: Array<{ id: string; kind: string; type: string; timestamp: number; display: any }> = [];

    if (params.includeObservations !== false) {
      const obs = await this.observationsService.list(patientId, userId, {
        from: params.from,
        to: params.to,
        episodeId: params.episodeId,
      });
      for (const o of obs) {
        entries.push({
          id: o.id,
          kind: 'observation',
          type: o.entries.map((e: any) => e.type).join(',') || 'observation',
          timestamp: o.observedAt,
          display: o,
        });
      }
    }

    if (params.includeInterventions !== false) {
      let medicationIdFilter = params.medicationId ? new Set([params.medicationId]) : null;
      if (params.medicationTag) {
        const tagIds = await this.resolveMedicationIdsForTag(params.medicationTag);
        medicationIdFilter = medicationIdFilter
          ? new Set([...medicationIdFilter].filter((id) => tagIds.has(id)))
          : tagIds;
      }
      const ints = await this.interventionsService.list(patientId, userId, {
        from: params.from,
        to: params.to,
        episodeId: params.episodeId,
      });
      for (const i of ints) {
        if (medicationIdFilter && !medicationIdFilter.has(i.metadata?.medicationId)) continue;
        entries.push({
          id: i.id,
          kind: 'intervention',
          type: i.type,
          timestamp: i.performedAt,
          display: i,
        });
      }
    }

    // Protocol firings ride the same merge (advisories.md) — no producer exists yet (Protocols
    // arrive with Conditions), so this is a no-op today, but the ER Brief will reuse this path.
    const advisoryRows = await db
      .select()
      .from(advisories)
      .where(and(eq(advisories.patientId, patientId), eq(advisories.type, 'protocol_fired')));
    for (const a of advisoryRows) {
      const ts = normalizeTs(a.createdAt);
      if (ts === null) continue;
      if (params.from && ts < params.from) continue;
      if (params.to && ts > params.to) continue;
      entries.push({
        id: a.id,
        kind: 'advisory',
        type: a.type,
        timestamp: ts,
        display: {
          id: a.id,
          patientId: a.patientId,
          type: a.type,
          severity: a.severity,
          sourceType: a.sourceType ?? null,
          sourceId: a.sourceId ?? null,
          contextType: a.contextType ?? null,
          contextId: a.contextId ?? null,
          payload: a.payload ? JSON.parse(a.payload) : null,
          acknowledgedByUserId: a.acknowledgedByUserId ?? null,
          acknowledgedAt: normalizeTs(a.acknowledgedAt),
          createdAt: ts,
          updatedAt: normalizeTs(a.updatedAt),
        },
      });
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);

    const weightRecordedAt = normalizeTs((patient as any).latestWeightRecordedAt);
    const nowTs = Math.floor(Date.now() / 1000);
    const daysSince = weightRecordedAt != null ? Math.floor((nowTs - weightRecordedAt) / 86400) : null;

    return {
      patient,
      entries,
      weightPrompt: {
        needsUpdate: weightRecordedAt === null || (daysSince ?? 0) > STALE_WEIGHT_DAYS,
        lastRecordedAt: weightRecordedAt,
        daysSince,
      },
    };
  }

  private async accessiblePatients(userId: string): Promise<Array<{ id: string; fullName: string }>> {
    const db = this.db.db as any;
    const rows = await db
      .select({ patient: patients })
      .from(careTeamMemberships)
      .leftJoin(patients, eq(careTeamMemberships.patientId, patients.id))
      .where(eq(careTeamMemberships.userId, userId));
    const byId = new Map<string, { id: string; fullName: string }>();
    for (const r of rows) {
      if (r.patient?.id && !byId.has(r.patient.id)) {
        byId.set(r.patient.id, { id: r.patient.id, fullName: r.patient.fullName });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  private async medicationNames(medicationIds: string[]): Promise<Map<string, string>> {
    if (!medicationIds.length) return new Map();
    const db = this.db.db as any;
    const rows = await db.select().from(medications).where(inArray(medications.id, medicationIds));
    return new Map(rows.map((r: any) => [r.id, r.name]));
  }

  // Patient-scoped and episode-agnostic, unlike buildActiveEpisodeSummary's `medications` — a dose
  // logged with no episode (the common 3 AM case) has no episodes_events_pivot row and would
  // otherwise be invisible on the whole dashboard. Returns one row per patient, every time,
  // including `doses: []` — the empty array is itself the answer (api.md → GET /api/dashboard).
  // medicationName is filled in by the caller from a combined name map (see getDashboard).
  private async buildLastDoseRows(accessible: Array<{ id: string; fullName: string }>) {
    if (!accessible.length) return [];
    const db = this.db.db as any;
    const patientIds = accessible.map((p) => p.id);
    const nowTs = Math.floor(Date.now() / 1000);
    const cutoff = nowTs - LAST_DOSE_WINDOW_HOURS * 3600;

    const rows = await db
      .select()
      .from(interventions)
      .where(
        and(
          inArray(interventions.patientId, patientIds),
          eq(interventions.type, 'medication_dose'),
          gte(interventions.performedAt, new Date(cutoff * 1000)),
        ),
      );

    const byPatientMed: Record<
      string,
      Record<string, { performedAtTs: number; nextAllowedAt: number | null; isAtypical: boolean }>
    > = {};
    for (const row of rows) {
      const metadata = row.metadata ? JSON.parse(row.metadata) : {};
      if (!metadata.medicationId) continue;
      const performedAtTs = normalizeTs(row.performedAt) ?? 0;
      const byMed = (byPatientMed[row.patientId] ??= {});
      const existing = byMed[metadata.medicationId];
      if (!existing || performedAtTs > existing.performedAtTs) {
        byMed[metadata.medicationId] = {
          performedAtTs,
          nextAllowedAt: metadata.nextAllowedAt ?? null,
          isAtypical: !!metadata.isAtypical,
        };
      }
    }

    return accessible.map((p) => {
      const byMed = byPatientMed[p.id] ?? {};
      const doses = Object.entries(byMed)
        .map(([medicationId, v]) => ({
          medicationId,
          medicationName: '', // filled in by getDashboard from the combined name map
          lastDoseAt: v.performedAtTs,
          nextAllowedAt: v.nextAllowedAt,
          isAtypicalLastDose: v.isAtypical,
        }))
        .sort((a, b) => b.lastDoseAt - a.lastDoseAt);
      return { patientId: p.id, patientName: p.fullName, doses };
    });
  }

  private async buildActiveEpisodeSummary(episodeRow: any) {
    const db = this.db.db as any;
    const pivots = await db
      .select()
      .from(episodesEventsPivot)
      .where(eq(episodesEventsPivot.episodeId, episodeRow.episodeId ?? episodeRow.id));
    const obsIds = pivots.filter((p: any) => p.eventType === 'observation').map((p: any) => p.eventId);
    const intIds = pivots.filter((p: any) => p.eventType === 'intervention').map((p: any) => p.eventId);

    let lastObservationSummary: any = null;
    if (obsIds.length) {
      const obsRows = await db.select().from(observations).where(inArray(observations.id, obsIds));
      const latest = obsRows.sort(
        (a: any, b: any) => (normalizeTs(b.observedAt) ?? 0) - (normalizeTs(a.observedAt) ?? 0),
      )[0];
      if (latest) {
        const entryRows = await db
          .select()
          .from(observationEntries)
          .where(eq(observationEntries.observationId, latest.id));
        lastObservationSummary = {
          observedAt: normalizeTs(latest.observedAt),
          entries: entryRows.map((e: any) => ({
            id: e.id,
            type: e.type,
            metadata: e.metadata ? JSON.parse(e.metadata) : null,
          })),
        };
      }
    }

    let medicationsSummary: any[] = [];
    if (intIds.length) {
      const intRows = await db.select().from(interventions).where(inArray(interventions.id, intIds));
      const byMed: Record<string, { performedAtTs: number; nextAllowedAt: number | null; isAtypical: boolean }> = {};
      for (const row of intRows) {
        if (row.type !== 'medication_dose') continue;
        const metadata = row.metadata ? JSON.parse(row.metadata) : {};
        if (!metadata.medicationId) continue;
        const performedAtTs = normalizeTs(row.performedAt) ?? 0;
        const existing = byMed[metadata.medicationId];
        if (!existing || performedAtTs > existing.performedAtTs) {
          byMed[metadata.medicationId] = {
            performedAtTs,
            nextAllowedAt: metadata.nextAllowedAt ?? null,
            isAtypical: !!metadata.isAtypical,
          };
        }
      }
      medicationsSummary = Object.entries(byMed).map(([medicationId, v]) => ({
        medicationId,
        medicationName: '', // filled in by getDashboard from the combined name map
        lastDoseAt: v.performedAtTs,
        nextAllowedAt: v.nextAllowedAt,
        isAtypicalLastDose: v.isAtypical,
      }));
    }

    let startedAt: number | null = null;
    if (episodeRow.startedAtType === 'observation') {
      const r = await db.select().from(observations).where(eq(observations.id, episodeRow.startedAtId)).limit(1);
      startedAt = r.length ? normalizeTs(r[0].observedAt) : null;
    } else if (episodeRow.startedAtType === 'intervention') {
      const r = await db.select().from(interventions).where(eq(interventions.id, episodeRow.startedAtId)).limit(1);
      startedAt = r.length ? normalizeTs(r[0].performedAt) : null;
    }

    return {
      patientId: episodeRow.patientId,
      patientName: episodeRow.patientName,
      episodeId: episodeRow.id ?? episodeRow.episodeId,
      name: episodeRow.name,
      startedAt,
      lastObservationSummary,
      medications: medicationsSummary,
    };
  }

  async getDashboard(userId: string) {
    const db = this.db.db as any;
    const accessible = await this.accessiblePatients(userId);
    const patientIds = accessible.map((p) => p.id);

    const activeEpisodeRows = await this.episodesService.listActiveForUser(userId);
    const activeEpisodes = await Promise.all(
      activeEpisodeRows.map((row: any) => this.buildActiveEpisodeSummary(row)),
    );

    const lastDoseRows = await this.buildLastDoseRows(accessible);

    // One combined name lookup serves both activeEpisodes' (episode-lifetime) and lastDoses'
    // (24h) medication ids, rather than two separate N+1-prone passes.
    const medicationIds = new Set<string>();
    for (const ep of activeEpisodes) for (const m of ep.medications) medicationIds.add(m.medicationId);
    for (const p of lastDoseRows) for (const d of p.doses) medicationIds.add(d.medicationId);
    const nameById = await this.medicationNames(Array.from(medicationIds));

    for (const ep of activeEpisodes) {
      for (const m of ep.medications) m.medicationName = nameById.get(m.medicationId) ?? 'unknown';
    }
    const lastDoses = lastDoseRows.map((p: any) => ({
      ...p,
      doses: p.doses.map((d: any) => ({ ...d, medicationName: nameById.get(d.medicationId) ?? 'unknown' })),
    }));

    let upcomingSchedules: any[] = [];
    if (patientIds.length) {
      const scheduleRows = await db
        .select()
        .from(interventionSchedules)
        .where(and(inArray(interventionSchedules.patientId, patientIds), eq(interventionSchedules.status, 'active')));
      const nowTs = Math.floor(Date.now() / 1000);
      upcomingSchedules = scheduleRows.map((r: any) => {
        const nextDueAt = normalizeTs(r.nextDueAt);
        return {
          scheduleId: r.id,
          patientId: r.patientId,
          label: r.label,
          type: r.type,
          episodeId: r.episodeId ?? null,
          nextDueAt,
          overdue: nextDueAt != null && nextDueAt < nowTs,
        };
      });
    }

    const embodimentRows = await db
      .select()
      .from(medicationEmbodiments)
      .where(eq(medicationEmbodiments.runningLow, true));
    const shoppingList = [];
    for (const emb of embodimentRows) {
      const medRows = await db.select().from(medications).where(eq(medications.id, emb.medicationId)).limit(1);
      shoppingList.push({
        embodimentId: emb.id,
        medicationId: emb.medicationId,
        medicationName: medRows[0]?.name ?? 'unknown',
        label: emb.label,
        runningLowFlaggedAt: normalizeTs(emb.runningLowFlaggedAt),
      });
    }

    let unacknowledgedAdvisories: any[] = [];
    if (patientIds.length) {
      const rows = await db
        .select()
        .from(advisories)
        .where(and(inArray(advisories.patientId, patientIds), isNull(advisories.acknowledgedByUserId)));
      unacknowledgedAdvisories = rows.map((r: any) => ({
        id: r.id,
        patientId: r.patientId,
        type: r.type,
        severity: r.severity,
        sourceType: r.sourceType ?? null,
        sourceId: r.sourceId ?? null,
        contextType: r.contextType ?? null,
        contextId: r.contextId ?? null,
        payload: r.payload ? JSON.parse(r.payload) : null,
        acknowledgedByUserId: null,
        acknowledgedAt: null,
        createdAt: normalizeTs(r.createdAt),
        updatedAt: normalizeTs(r.updatedAt),
      }));
    }

    return { lastDoses, activeEpisodes, upcomingSchedules, shoppingList, unacknowledgedAdvisories };
  }
}
