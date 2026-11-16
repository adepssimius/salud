import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { advisories, careTeamMemberships, conditions, protocols } from '../../db/schema';
import {
  Advisory,
  AdvisorySeverity,
  AdvisorySourceType,
  AdvisoryType,
} from '@salud/shared/types';
import { normalizeTs } from '../persistence/time';

export interface CreateAdvisoryInput {
  patientId: string;
  type: AdvisoryType;
  severity: AdvisorySeverity;
  sourceType?: AdvisorySourceType;
  sourceId?: string;
  contextType?: 'observation' | 'intervention';
  contextId?: string;
  payload?: Record<string, any>;
  // When provided, the advisory is created already-acknowledged (saving past a warning
  // is itself the acknowledgment — see advisories.md).
  acknowledgedByUserId?: string;
}

@Injectable()
export class AdvisoriesService {
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

  private pickAdvisory(row: any) {
    return {
      id: row.id,
      patientId: row.patientId,
      type: row.type,
      severity: row.severity,
      sourceType: row.sourceType ?? null,
      sourceId: row.sourceId ?? null,
      contextType: row.contextType ?? null,
      contextId: row.contextId ?? null,
      payload: row.payload ? JSON.parse(row.payload) : null,
      acknowledgedByUserId: row.acknowledgedByUserId ?? null,
      acknowledgedAt: normalizeTs(row.acknowledgedAt),
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  // Called by services persisting the event that triggered the advisory (e.g. InterventionsService
  // on a medication_dose create). Not itself an HTTP endpoint.
  //
  // `tx` is a `DatabaseService.withTransaction` handle, for a caller writing the advisory in the
  // same transaction as the event (the correction PATCHes); `input.id` lets that caller have
  // decided the id beforehand. Writes only.
  async create(input: CreateAdvisoryInput & { id?: string }, tx?: any) {
    const db = tx ?? (this.db.db as any);
    const id = input.id ?? randomUUID();
    await db.insert(advisories).values({
      id,
      patientId: input.patientId,
      type: input.type,
      severity: input.severity,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      contextType: input.contextType ?? null,
      contextId: input.contextId ?? null,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      acknowledgedByUserId: input.acknowledgedByUserId ?? null,
      acknowledgedAt: input.acknowledgedByUserId ? new Date() : null,
    });
    return id;
  }

  async listForPatient(patientId: string, userId: string) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(advisories)
      .where(eq(advisories.patientId, patientId))
      .orderBy(desc(advisories.createdAt));
    return rows.map((r: any) => this.pickAdvisory(r));
  }

  private extractMetricValue(metric: string, metadata: Record<string, any>): number | null {
    switch (metric) {
      case 'temperature':
        if (typeof metadata.value !== 'number') return null;
        return metadata.unit === 'F'
          ? Math.round((((metadata.value - 32) * 5) / 9) * 10) / 10
          : metadata.value;
      case 'heart_rate':
        return typeof metadata.bpm === 'number' ? metadata.bpm : null;
      case 'respiratory_rate':
        return typeof metadata.breathsPerMin === 'number' ? metadata.breathsPerMin : null;
      case 'oxygen_saturation':
        return typeof metadata.percent === 'number' ? metadata.percent : null;
      case 'pain_score':
        return typeof metadata.score === 'number' ? metadata.score : null;
      default:
        return null;
    }
  }

  // Runs on every observation create (ObservationsService). Matches entries against the active
  // Protocols of the patient's active Conditions and persists a self-acknowledged protocol_fired
  // advisory for each trip, in the same request as the observation (data-model.md → "Data
  // integrity rules"). Returns the advisories just fired so the create response can surface the
  // protocol card immediately (frontend.md → "Protocol card").
  async evaluateProtocols(
    patientId: string,
    userId: string,
    observationId: string,
    entries: Array<{ type: string; metadata?: Record<string, any> | null }>,
  ): Promise<Advisory[]> {
    const trips = await this.planProtocolTrips(patientId, userId, observationId, entries);
    for (const trip of trips) await this.create(trip);
    return trips.map((trip) => this.firedFromInput(trip));
  }

  /**
   * The reads half of `evaluateProtocols`, for a caller that must write inside its own transaction
   * (the observation correction PATCH — api.md → "Protocols are re-checked"). Returns the
   * advisories to write, ids already chosen; hand each to `create(input, tx)` and report them with
   * `firedFromInput`.
   *
   * `skipAlreadyFired` drops a trip when a `protocol_fired` advisory for the same Protocol already
   * has this observation as its context, so a correction never fires a protocol twice for one
   * observation. Create has no prior advisories to skip and leaves it off.
   */
  async planProtocolTrips(
    patientId: string,
    userId: string,
    observationId: string,
    entries: Array<{ type: string; metadata?: Record<string, any> | null }>,
    options: { skipAlreadyFired?: boolean } = {},
  ): Promise<Array<CreateAdvisoryInput & { id: string }>> {
    const db = this.db.db as any;
    const conditionRows = await db
      .select()
      .from(conditions)
      .where(and(eq(conditions.patientId, patientId), eq(conditions.status, 'active')));
    if (!conditionRows.length) return [];
    const conditionIds = conditionRows.map((c: any) => c.id);
    const conditionNameById = new Map(conditionRows.map((c: any) => [c.id, c.name]));

    const protocolRows = await db
      .select()
      .from(protocols)
      .where(and(inArray(protocols.conditionId, conditionIds), eq(protocols.active, true)));
    if (!protocolRows.length) return [];

    const alreadyFired = new Set<string>();
    if (options.skipAlreadyFired) {
      const prior = await db
        .select()
        .from(advisories)
        .where(
          and(
            eq(advisories.type, 'protocol_fired'),
            eq(advisories.contextType, 'observation'),
            eq(advisories.contextId, observationId),
          ),
        );
      for (const row of prior) if (row.sourceId) alreadyFired.add(row.sourceId);
    }

    const trips: Array<CreateAdvisoryInput & { id: string }> = [];
    for (const protocol of protocolRows) {
      if (alreadyFired.has(protocol.id)) continue;
      const entry = entries.find((e) => e.type === protocol.triggerMetric);
      if (!entry || !entry.metadata) continue;
      const value = this.extractMetricValue(protocol.triggerMetric, entry.metadata);
      if (value === null) continue;
      const tripped =
        protocol.triggerOperator === 'gte' ? value >= protocol.triggerValue : value <= protocol.triggerValue;
      if (!tripped) continue;

      trips.push({
        id: randomUUID(),
        patientId,
        type: 'protocol_fired',
        severity: 'danger',
        sourceType: 'protocol',
        sourceId: protocol.id,
        contextType: 'observation',
        contextId: observationId,
        payload: {
          conditionId: protocol.conditionId,
          conditionName: conditionNameById.get(protocol.conditionId) ?? null,
          protocolName: protocol.name,
          instructionText: protocol.instructionText,
          sourceText: protocol.sourceText,
          triggerMetric: protocol.triggerMetric,
          triggerOperator: protocol.triggerOperator,
          triggerValue: protocol.triggerValue,
          observedValue: value,
        },
        acknowledgedByUserId: userId,
      });
    }
    return trips;
  }

  /** The response shape of a protocol trip `planProtocolTrips` returned and `create` wrote. */
  firedFromInput(input: CreateAdvisoryInput & { id: string }): Advisory {
    const nowTs = Math.floor(Date.now() / 1000);
    return {
      id: input.id,
      patientId: input.patientId,
      type: input.type,
      severity: input.severity,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      contextType: input.contextType ?? null,
      contextId: input.contextId ?? null,
      payload: input.payload ?? null,
      acknowledgedByUserId: input.acknowledgedByUserId ?? null,
      acknowledgedAt: input.acknowledgedByUserId ? nowTs : null,
      createdAt: nowTs,
      updatedAt: nowTs,
    } as Advisory;
  }

  async ack(id: string, userId: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(advisories).where(eq(advisories.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('ADVISORY_NOT_FOUND');
    const row = rows[0];
    await this.ensurePatientAccess(row.patientId, userId);

    if (!row.acknowledgedByUserId) {
      await db
        .update(advisories)
        .set({ acknowledgedByUserId: userId, acknowledgedAt: new Date() })
        .where(eq(advisories.id, id));
    }

    const updated = await db.select().from(advisories).where(eq(advisories.id, id)).limit(1);
    return this.pickAdvisory(updated[0]);
  }
}
