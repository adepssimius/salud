import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import {
  careTeamMemberships,
  conditions,
  episodes,
  interventionSchedules,
  protocols,
} from '../../db/schema';
import { CreateConditionDto } from './dto/create-condition.dto';
import { UpdateConditionDto } from './dto/update-condition.dto';
import { RevisionsService } from '../revisions/revisions.service';

function normalizeTs(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

@Injectable()
export class ConditionsService {
  constructor(
    private readonly db: DatabaseService,
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

  private pickCondition(row: any) {
    return {
      id: row.id,
      patientId: row.patientId,
      name: row.name,
      diagnosisText: row.diagnosisText ?? null,
      status: row.status,
      baselines: row.baselines ? JSON.parse(row.baselines) : [],
      devices: row.devices ? JSON.parse(row.devices) : [],
      contacts: row.contacts ? JSON.parse(row.contacts) : [],
      createdByUserId: row.createdByUserId,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  private pickProtocol(row: any) {
    return {
      id: row.id,
      conditionId: row.conditionId,
      name: row.name,
      triggerMetric: row.triggerMetric,
      triggerOperator: row.triggerOperator,
      triggerValue: row.triggerValue,
      instructionText: row.instructionText,
      sourceText: row.sourceText,
      active: row.active,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  private async getRawCondition(id: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(conditions).where(eq(conditions.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('CONDITION_NOT_FOUND');
    return rows[0];
  }

  // Used by ProtocolsService/SchedulesService/EpisodesService to authorize access to a condition's
  // patient without duplicating the membership check.
  async getAuthorizedCondition(id: string, userId: string) {
    const row = await this.getRawCondition(id);
    await this.ensurePatientAccess(row.patientId, userId);
    return row;
  }

  async create(patientId: string, userId: string, dto: CreateConditionDto) {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const id = randomUUID();
    await db.insert(conditions).values({
      id,
      patientId,
      name: dto.name,
      diagnosisText: dto.diagnosisText ?? null,
      status: dto.status ?? 'active',
      baselines: dto.baselines ? JSON.stringify(dto.baselines) : null,
      devices: dto.devices ? JSON.stringify(dto.devices) : null,
      contacts: dto.contacts ? JSON.stringify(dto.contacts) : null,
      createdByUserId: userId,
    });
    return this.pickCondition(await this.getRawCondition(id));
  }

  async listForPatient(patientId: string, userId: string, status?: 'active' | 'resolved') {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    let rows = await db.select().from(conditions).where(eq(conditions.patientId, patientId));
    if (status) rows = rows.filter((r: any) => r.status === status);
    return rows.map((r: any) => this.pickCondition(r));
  }

  async get(id: string, userId: string) {
    const row = await this.getAuthorizedCondition(id, userId);
    const db = this.db.db as any;
    const episodeRows = await db.select().from(episodes).where(eq(episodes.conditionId, id));
    const scheduleRows = await db
      .select()
      .from(interventionSchedules)
      .where(eq(interventionSchedules.conditionId, id));
    const protocolRows = await db.select().from(protocols).where(eq(protocols.conditionId, id));
    return {
      ...this.pickCondition(row),
      episodeIds: episodeRows.map((r: any) => r.id),
      scheduleIds: scheduleRows.map((r: any) => r.id),
      protocols: protocolRows.map((r: any) => this.pickProtocol(r)),
    };
  }

  async update(id: string, userId: string, dto: UpdateConditionDto) {
    const preUpdateRow = await this.getAuthorizedCondition(id, userId);
    await this.revisionsService.capture('condition', id, this.pickCondition(preUpdateRow), userId);
    const db = this.db.db as any;
    const updates: Record<string, any> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.diagnosisText !== undefined) updates.diagnosisText = dto.diagnosisText;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.baselines !== undefined) updates.baselines = JSON.stringify(dto.baselines);
    if (dto.devices !== undefined) updates.devices = JSON.stringify(dto.devices);
    if (dto.contacts !== undefined) updates.contacts = JSON.stringify(dto.contacts);
    if (Object.keys(updates).length) {
      await db.update(conditions).set(updates).where(eq(conditions.id, id));
    }
    return this.pickCondition(await this.getRawCondition(id));
  }

  async remove(id: string, userId: string) {
    await this.getAuthorizedCondition(id, userId);
    const db = this.db.db as any;
    await db.delete(protocols).where(eq(protocols.conditionId, id));
    await db.delete(conditions).where(eq(conditions.id, id));
    return { deleted: true };
  }

  async getRevisions(id: string, userId: string) {
    await this.getAuthorizedCondition(id, userId); // enforces existence + patient access
    return this.revisionsService.listFor('condition', id);
  }
}
