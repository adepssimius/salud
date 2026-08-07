import { Injectable, NotFoundException } from '@nestjs/common';
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

type EpisodeEndType = 'observation' | 'intervention';

function normalizeTs(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

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

  async resolveEpisodes(patientId: string, userId: string, episodeIds: string[], endedAtType: EpisodeEndType, endedAtId: string) {
    if (!episodeIds || !episodeIds.length) return;
    const db = this.db.db as any;
    await this.ensurePatientAccess(patientId, userId);
    const rows = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.patientId, patientId), inArray(episodes.id, episodeIds)));
    if (!rows.length || rows.length !== episodeIds.length) {
      throw new NotFoundException('EPISODE_NOT_FOUND');
    }
    await db
      .update(episodes)
      .set({
        status: 'resolved',
        endedAtType,
        endedAtId,
      })
      .where(and(eq(episodes.patientId, patientId), inArray(episodes.id, episodeIds)));
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

  async getById(episodeId: string, userId: string) {
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

    return {
      id: row.id,
      patientId: row.patientId,
      conditionId: row.conditionId ?? null,
      name: row.name,
      status: row.status,
      startedAtType: row.startedAtType,
      startedAtId: row.startedAtId,
      endedAtType: row.endedAtType,
      endedAtId: row.endedAtId,
      notes: row.notes,
      observationIds: Array.from(new Set<string>(observationIds)),
      interventionIds: Array.from(new Set<string>(interventionIds)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listForPatient(patientId: string, userId: string, status?: 'active' | 'resolved') {
    const db = this.db.db as any;
    await this.ensurePatientAccess(patientId, userId);
    let rows = await db.select().from(episodes).where(eq(episodes.patientId, patientId));
    if (status) {
      rows = rows.filter((r: any) => r.status === status);
    }
    return Promise.all(
      rows.map(async (r: any) => ({
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
        createdAt: normalizeTs(r.createdAt),
        updatedAt: normalizeTs(r.updatedAt),
      })),
    );
  }

  async listActiveForUser(userId: string) {
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
      .map((r: any) => ({
        id: r.episode.id,
        patientId: r.patient.id,
        patientName: r.patient.fullName,
        name: r.episode.name,
        status: r.episode.status,
        startedAtType: r.episode.startedAtType,
        startedAtId: r.episode.startedAtId,
        endedAtType: r.episode.endedAtType,
        endedAtId: r.episode.endedAtId,
        notes: r.episode.notes,
        createdAt: r.episode.createdAt,
        updatedAt: r.episode.updatedAt,
      }));
  }
}
