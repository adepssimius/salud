import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { medications } from '../../db/schema';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { normalizeTs } from '../persistence/time';
import { medicationDependencies } from './catalog-dependencies';

@Injectable()
export class MedicationsService {
  constructor(private readonly db: DatabaseService) {}

  private pickMedication(row: any) {
    return {
      id: row.id,
      name: row.name,
      brandNames: row.brandNames ? JSON.parse(row.brandNames) : [],
      description: row.description ?? null,
      tags: row.tags ? JSON.parse(row.tags) : [],
      defaultActive: row.defaultActive,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  // Service-level and case-insensitive rather than a unique index. An index would need a migration
  // and can't express case-insensitivity portably -- sqlite needs COLLATE NOCASE, postgres a
  // functional index, mysql's default collation already does it -- and a driver constraint error
  // carries no machine-readable code for the client to branch on. The catalog is one household's
  // medicine cabinet, so scanning it costs nothing; list() already selects the whole table.
  //
  // Compared against `name` only: a collision with another medication's brandNames is allowed,
  // since that would change what "duplicate" means (data-model.md).
  private async assertNameAvailable(name: string, excludeId?: string) {
    const db = this.db.db as any;
    const target = name.trim().toLowerCase();
    const rows = await db.select().from(medications);
    const clash = rows.some(
      (r: any) => r.id !== excludeId && String(r.name ?? '').trim().toLowerCase() === target,
    );
    if (clash) throw new ConflictException('MEDICATION_NAME_TAKEN');
  }

  async create(dto: CreateMedicationDto) {
    await this.assertNameAvailable(dto.name);
    const db = this.db.db as any;
    const id = randomUUID();
    await db.insert(medications).values({
      id,
      name: dto.name,
      brandNames: dto.brandNames ? JSON.stringify(dto.brandNames) : null,
      description: dto.description ?? null,
      tags: dto.tags ? JSON.stringify(dto.tags) : null,
      defaultActive: dto.defaultActive ?? true,
    });
    return this.get(id);
  }

  async list(params: { q?: string; tag?: string; activeOnly?: boolean }) {
    const db = this.db.db as any;
    const rows = await db.select().from(medications);
    const mapped = rows.map((r: any) => this.pickMedication(r));

    let result = mapped;
    if (params.activeOnly) {
      result = result.filter((m: any) => m.defaultActive);
    }
    if (params.tag) {
      result = result.filter((m: any) => m.tags.includes(params.tag));
    }
    if (params.q) {
      const q = params.q.toLowerCase();
      result = result.filter(
        (m: any) =>
          m.name.toLowerCase().includes(q) ||
          m.brandNames.some((b: string) => b.toLowerCase().includes(q)) ||
          m.tags.some((t: string) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }

  async get(id: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(medications).where(eq(medications.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('MEDICATION_NOT_FOUND');
    return this.pickMedication(rows[0]);
  }

  async update(id: string, dto: UpdateMedicationDto) {
    const db = this.db.db as any;
    await this.get(id);
    const updates: Record<string, any> = {};
    if (dto.name !== undefined) {
      // excludeId so renaming a medication to the name it already has is a no-op, not a conflict.
      await this.assertNameAvailable(dto.name, id);
      updates.name = dto.name;
    }
    if (dto.brandNames !== undefined) updates.brandNames = JSON.stringify(dto.brandNames);
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.tags !== undefined) updates.tags = JSON.stringify(dto.tags);
    if (dto.defaultActive !== undefined) updates.defaultActive = dto.defaultActive;
    if (Object.keys(updates).length) {
      await db.update(medications).set(updates).where(eq(medications.id, id));
    }
    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    const db = this.db.db as any;
    // Refuse rather than orphan. Deleting dosing reference data out from under a logged dose is
    // silent data loss; the response says what's in the way so the caller can act on it
    // (api.md -> Medications). Retirement is `defaultActive: false`, not deletion.
    const dependents = await medicationDependencies(db, id);
    if (Object.keys(dependents).length) {
      throw new ConflictException({ message: 'MEDICATION_IN_USE', dependents });
    }
    await db.delete(medications).where(eq(medications.id, id));
    return { deleted: true };
  }
}
