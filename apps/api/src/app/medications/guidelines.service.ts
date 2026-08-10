import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { medicationGuidelines, medications } from '../../db/schema';
import { CreateGuidelineDto } from './dto/create-guideline.dto';
import { UpdateGuidelineDto } from './dto/update-guideline.dto';
import { guidelineDependencies } from './catalog-dependencies';

@Injectable()
export class GuidelinesService {
  constructor(private readonly db: DatabaseService) {}

  private pickGuideline(row: any) {
    return {
      id: row.id,
      medicationId: row.medicationId,
      medicationEmbodimentId: row.medicationEmbodimentId ?? null,
      source: row.source,
      type: row.type,
      mgPerKg: row.mgPerKg,
      maxMgPerDose: row.maxMgPerDose,
      maxMgPerDay: row.maxMgPerDay,
      minIntervalHours: row.minIntervalHours,
      ageMinMonths: row.ageMinMonths,
      ageMaxMonths: row.ageMaxMonths,
      doseMg: row.doseMg,
      doseMl: row.doseMl,
      pillCount: row.pillCount,
      frequencyPerDay: row.frequencyPerDay,
      notes: row.notes ?? null,
    };
  }

  private async ensureMedicationExists(medicationId: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(medications).where(eq(medications.id, medicationId)).limit(1);
    if (!rows.length) throw new NotFoundException('MEDICATION_NOT_FOUND');
  }

  async create(medicationId: string, dto: CreateGuidelineDto) {
    await this.ensureMedicationExists(medicationId);
    const db = this.db.db as any;
    const id = randomUUID();
    await db.insert(medicationGuidelines).values({
      id,
      medicationId,
      medicationEmbodimentId: dto.medicationEmbodimentId ?? null,
      source: dto.source,
      type: dto.type,
      mgPerKg: dto.mgPerKg ?? null,
      maxMgPerDose: dto.maxMgPerDose ?? null,
      maxMgPerDay: dto.maxMgPerDay,
      minIntervalHours: dto.minIntervalHours ?? null,
      ageMinMonths: dto.ageMinMonths ?? null,
      ageMaxMonths: dto.ageMaxMonths ?? null,
      doseMg: dto.doseMg ?? null,
      doseMl: dto.doseMl ?? null,
      pillCount: dto.pillCount ?? null,
      frequencyPerDay: dto.frequencyPerDay ?? null,
      notes: dto.notes ?? null,
    });
    return this.get(id);
  }

  async listForMedication(medicationId: string) {
    await this.ensureMedicationExists(medicationId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(medicationGuidelines)
      .where(eq(medicationGuidelines.medicationId, medicationId));
    return rows.map((r: any) => this.pickGuideline(r));
  }

  async get(id: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(medicationGuidelines).where(eq(medicationGuidelines.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('GUIDELINE_NOT_FOUND');
    return this.pickGuideline(rows[0]);
  }

  // Against the merged row, not just the submitted fields. UpdateGuidelineDto makes both halves
  // independently optional, so `PATCH { ageMinMonths: 200 }` against a row whose max is 60 is
  // invisible to any DTO constraint -- and an inverted band fails *silently*: it matches no
  // patient, so guidance just never appears with nothing on screen to say why.
  private assertAgeRangeOrdered(min: unknown, max: unknown) {
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      throw new BadRequestException('GUIDELINE_AGE_RANGE_INVALID');
    }
  }

  async update(id: string, dto: UpdateGuidelineDto) {
    const existing = await this.get(id);
    const db = this.db.db as any;
    const updates: Record<string, any> = {};
    const fields = [
      'medicationEmbodimentId',
      'source',
      'mgPerKg',
      'maxMgPerDose',
      'maxMgPerDay',
      'minIntervalHours',
      'ageMinMonths',
      'ageMaxMonths',
      'doseMg',
      'doseMl',
      'pillCount',
      'frequencyPerDay',
      'notes',
    ] as const;
    for (const field of fields) {
      if (dto[field] !== undefined) updates[field] = dto[field];
    }
    this.assertAgeRangeOrdered(
      updates.ageMinMonths ?? existing.ageMinMonths,
      updates.ageMaxMonths ?? existing.ageMaxMonths,
    );

    if (Object.keys(updates).length) {
      await db.update(medicationGuidelines).set(updates).where(eq(medicationGuidelines.id, id));
    }
    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    const db = this.db.db as any;
    // Refuse rather than orphan. Deleting dosing reference data out from under a logged dose is
    // silent data loss; the response says what's in the way so the caller can act on it
    // (api.md -> Medications). Retirement is `defaultActive: false`, not deletion.
    const dependents = await guidelineDependencies(db, id);
    if (Object.keys(dependents).length) {
      throw new ConflictException({ message: 'GUIDELINE_IN_USE', dependents });
    }
    await db.delete(medicationGuidelines).where(eq(medicationGuidelines.id, id));
    return { deleted: true };
  }
}
