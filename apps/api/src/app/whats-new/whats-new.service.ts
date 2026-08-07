import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { advisories, careTeamMemberships, interventionSchedules } from '../../db/schema';
import { TimelineService } from '../timeline/timeline.service';
import { advisoriesSince, isNowDue, whatsNewSince } from './whats-new-window';
import { AckWhatsNewResponse, TimelineEntry, WhatsNewResponse } from '@salud/shared/types';

function normalizeTs(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

@Injectable()
export class WhatsNewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly timelineService: TimelineService,
  ) {}

  private async getMembership(patientId: string, userId: string) {
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(careTeamMemberships)
      .where(and(eq(careTeamMemberships.patientId, patientId), eq(careTeamMemberships.userId, userId)))
      .limit(1);
    if (!rows.length) throw new NotFoundException('PATIENT_NOT_FOUND');
    return rows[0];
  }

  async getWhatsNew(patientId: string, userId: string): Promise<WhatsNewResponse> {
    const membership = await this.getMembership(patientId, userId);
    const nowTs = Math.floor(Date.now() / 1000);
    // Watermark rule and the three window predicates below are shared with the dashboard's count
    // version of this same diff (whats-new-window.ts) — that's what keeps the card and this page
    // from reporting different numbers.
    const since = whatsNewSince(normalizeTs(membership.lastSeenAt), nowTs);

    const timeline = await this.timelineService.getTimeline(patientId, userId, { from: since });
    // The timeline merge only carries protocol_fired advisories (it's built for the dose-marker/
    // episode view); whats-new wants every advisory type that's fired since the watermark.
    const events = (timeline.entries as TimelineEntry[]).filter((e) => e.kind !== 'advisory');

    const db = this.db.db as any;
    const advisoryRows = await db.select().from(advisories).where(advisoriesSince(patientId, since));
    const advisoriesFired = advisoryRows.map((r: any) => ({
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

    const scheduleRows = await db
      .select()
      .from(interventionSchedules)
      .where(and(eq(interventionSchedules.patientId, patientId), eq(interventionSchedules.status, 'active')));
    const nowDue = scheduleRows
      .map((r: any) => {
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
      })
      .filter((s: any) => isNowDue(s.nextDueAt, nowTs));

    return { since, events, advisoriesFired, nowDue };
  }

  async ack(patientId: string, userId: string): Promise<AckWhatsNewResponse> {
    const membership = await this.getMembership(patientId, userId);
    const db = this.db.db as any;
    const ackedAt = new Date();
    await db.update(careTeamMemberships).set({ lastSeenAt: ackedAt }).where(eq(careTeamMemberships.id, membership.id));
    return { ackedAt: Math.floor(ackedAt.getTime() / 1000) };
  }
}
