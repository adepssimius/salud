import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { protocols } from '../../db/schema';
import { ConditionsService } from '../conditions/conditions.service';
import { CreateProtocolDto } from './dto/create-protocol.dto';
import { UpdateProtocolDto } from './dto/update-protocol.dto';

function normalizeTs(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

@Injectable()
export class ProtocolsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly conditionsService: ConditionsService,
  ) {}

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

  private async getRawProtocol(id: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(protocols).where(eq(protocols.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('PROTOCOL_NOT_FOUND');
    return rows[0];
  }

  async create(conditionId: string, userId: string, dto: CreateProtocolDto) {
    await this.conditionsService.getAuthorizedCondition(conditionId, userId);
    const db = this.db.db as any;
    const id = randomUUID();
    await db.insert(protocols).values({
      id,
      conditionId,
      name: dto.name,
      triggerMetric: dto.triggerMetric,
      triggerOperator: dto.triggerOperator,
      triggerValue: dto.triggerValue,
      instructionText: dto.instructionText,
      sourceText: dto.sourceText,
      active: dto.active ?? true,
    });
    return this.pickProtocol(await this.getRawProtocol(id));
  }

  async listForCondition(conditionId: string, userId: string) {
    await this.conditionsService.getAuthorizedCondition(conditionId, userId);
    const db = this.db.db as any;
    const rows = await db.select().from(protocols).where(eq(protocols.conditionId, conditionId));
    return rows.map((r: any) => this.pickProtocol(r));
  }

  async get(id: string, userId: string) {
    const row = await this.getRawProtocol(id);
    await this.conditionsService.getAuthorizedCondition(row.conditionId, userId);
    return this.pickProtocol(row);
  }

  async update(id: string, userId: string, dto: UpdateProtocolDto) {
    const row = await this.getRawProtocol(id);
    await this.conditionsService.getAuthorizedCondition(row.conditionId, userId);
    const db = this.db.db as any;
    const updates: Record<string, any> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.triggerMetric !== undefined) updates.triggerMetric = dto.triggerMetric;
    if (dto.triggerOperator !== undefined) updates.triggerOperator = dto.triggerOperator;
    if (dto.triggerValue !== undefined) updates.triggerValue = dto.triggerValue;
    if (dto.instructionText !== undefined) updates.instructionText = dto.instructionText;
    if (dto.sourceText !== undefined) updates.sourceText = dto.sourceText;
    if (dto.active !== undefined) updates.active = dto.active;
    if (Object.keys(updates).length) {
      await db.update(protocols).set(updates).where(eq(protocols.id, id));
    }
    return this.pickProtocol(await this.getRawProtocol(id));
  }

  async remove(id: string, userId: string) {
    const row = await this.getRawProtocol(id);
    await this.conditionsService.getAuthorizedCondition(row.conditionId, userId);
    const db = this.db.db as any;
    await db.delete(protocols).where(eq(protocols.id, id));
    return { deleted: true };
  }
}
