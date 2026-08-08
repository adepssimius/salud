import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { medicationEmbodiments, medications } from '../../db/schema';
import { CreateEmbodimentDto } from './dto/create-embodiment.dto';
import { UpdateEmbodimentDto } from './dto/update-embodiment.dto';
import { normalizeTs } from '../persistence/time';

@Injectable()
export class EmbodimentsService {
  constructor(private readonly db: DatabaseService) {}

  private pickEmbodiment(row: any) {
    return {
      id: row.id,
      medicationId: row.medicationId,
      label: row.label,
      concentrationMgPerMl: row.concentrationMgPerMl,
      strengthMgPerUnit: row.strengthMgPerUnit,
      unitType: row.unitType,
      notes: row.notes ?? null,
      atHome: row.atHome,
      expiresAt: normalizeTs(row.expiresAt),
      runningLow: row.runningLow,
      runningLowFlaggedByUserId: row.runningLowFlaggedByUserId ?? null,
      runningLowFlaggedAt: normalizeTs(row.runningLowFlaggedAt),
    };
  }

  private async ensureMedicationExists(medicationId: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(medications).where(eq(medications.id, medicationId)).limit(1);
    if (!rows.length) throw new NotFoundException('MEDICATION_NOT_FOUND');
  }

  async create(medicationId: string, dto: CreateEmbodimentDto) {
    await this.ensureMedicationExists(medicationId);
    const db = this.db.db as any;
    const id = randomUUID();
    await db.insert(medicationEmbodiments).values({
      id,
      medicationId,
      label: dto.label,
      concentrationMgPerMl: dto.concentrationMgPerMl ?? null,
      strengthMgPerUnit: dto.strengthMgPerUnit ?? null,
      unitType: dto.unitType,
      notes: dto.notes ?? null,
    });
    return this.get(id);
  }

  async listForMedication(medicationId: string) {
    await this.ensureMedicationExists(medicationId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(medicationEmbodiments)
      .where(eq(medicationEmbodiments.medicationId, medicationId));
    return rows.map((r: any) => this.pickEmbodiment(r));
  }

  async get(id: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(medicationEmbodiments).where(eq(medicationEmbodiments.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('EMBODIMENT_NOT_FOUND');
    return this.pickEmbodiment(rows[0]);
  }

  async update(id: string, userId: string, dto: UpdateEmbodimentDto) {
    await this.get(id);
    const db = this.db.db as any;
    const updates: Record<string, any> = {};
    if (dto.label !== undefined) updates.label = dto.label;
    if (dto.concentrationMgPerMl !== undefined) updates.concentrationMgPerMl = dto.concentrationMgPerMl;
    if (dto.strengthMgPerUnit !== undefined) updates.strengthMgPerUnit = dto.strengthMgPerUnit;
    if (dto.unitType !== undefined) updates.unitType = dto.unitType;
    if (dto.notes !== undefined) updates.notes = dto.notes;
    if (dto.atHome !== undefined) updates.atHome = dto.atHome;
    if (dto.expiresAt !== undefined) {
      updates.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    if (dto.runningLow !== undefined) {
      updates.runningLow = dto.runningLow;
      updates.runningLowFlaggedByUserId = dto.runningLow ? userId : null;
      updates.runningLowFlaggedAt = dto.runningLow ? new Date() : null;
    }
    if (Object.keys(updates).length) {
      await db.update(medicationEmbodiments).set(updates).where(eq(medicationEmbodiments.id, id));
    }
    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    const db = this.db.db as any;
    await db.delete(medicationEmbodiments).where(eq(medicationEmbodiments.id, id));
    return { deleted: true };
  }
}
