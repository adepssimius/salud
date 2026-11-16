import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../persistence/database.service';
import { medicationEmbodiments, medications } from '../../db/schema';
import { CreateEmbodimentDto } from './dto/create-embodiment.dto';
import { UpdateEmbodimentDto } from './dto/update-embodiment.dto';
import { normalizeTs } from '../persistence/time';
import { embodimentDependencies, embodimentDosingDependencies } from './catalog-dependencies';

@Injectable()
export class EmbodimentsService {
  constructor(private readonly db: DatabaseService) {}

  private pickEmbodiment(row: any) {
    return {
      id: row.id,
      medicationId: row.medicationId,
      label: row.label,
      concentrationMgPerMl: row.concentrationMgPerMl,
      concentrationMg: row.concentrationMg ?? null,
      concentrationVolumeMl: row.concentrationVolumeMl ?? null,
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

  // "The flag carries who set it" (data-model.md). Shared by create and update so the two can't
  // drift -- an attribution that only one path stamps is worse than none.
  private runningLowStamp(runningLow: boolean | undefined, userId: string) {
    if (runningLow === undefined) return {};
    return {
      runningLow,
      runningLowFlaggedByUserId: runningLow ? userId : null,
      runningLowFlaggedAt: runningLow ? new Date() : null,
    };
  }

  // The one place the three concentration columns are decided, shared by create and update so they
  // cannot drift. Returns the exact column values to write, or {} when the request says nothing
  // about concentration at all.
  //
  // Why the pair exists: a caregiver holding a bottle that reads "160 mg per 5 mL" should type
  // those two numbers, not 32. That division is a dosing calculation, so the server does it —
  // api.md -> "Concentration: the label pair vs. mg/mL". `existing` is the stored row on update
  // (null on create), because a PATCH sending one half of the pair is only meaningful against the
  // other half already on file.
  private resolveConcentration(
    dto: CreateEmbodimentDto | UpdateEmbodimentDto,
    existing: {
      concentrationMgPerMl: number | null;
      concentrationMg: number | null;
      concentrationVolumeMl: number | null;
    } | null,
  ): Record<string, number | null> {
    const perMlGiven = 'concentrationMgPerMl' in dto && dto.concentrationMgPerMl !== undefined;
    const mgGiven = 'concentrationMg' in dto && dto.concentrationMg !== undefined;
    const mlGiven = 'concentrationVolumeMl' in dto && dto.concentrationVolumeMl !== undefined;
    if (!perMlGiven && !mgGiven && !mlGiven) return {};

    const perMl = perMlGiven ? (dto.concentrationMgPerMl ?? null) : null;
    const mg = mgGiven ? (dto.concentrationMg ?? null) : null;
    const ml = mlGiven ? (dto.concentrationVolumeMl ?? null) : null;

    // Two sources for one number. Don't guess which the caller meant.
    if (perMl != null && (mg != null || ml != null)) {
      throw new BadRequestException('CONCENTRATION_INPUT_CONFLICT');
    }

    // A per-mL figure given on its own wins outright, and clears the pair: the printed figures on
    // file would no longer describe the stored concentration.
    if (perMl != null) {
      return { concentrationMgPerMl: perMl, concentrationMg: null, concentrationVolumeMl: null };
    }

    // Clearing either half clears the pair *and* the figure derived from it — the derived value has
    // no independent existence once its inputs are gone.
    if ((mgGiven && mg == null) || (mlGiven && ml == null)) {
      return { concentrationMgPerMl: null, concentrationMg: null, concentrationVolumeMl: null };
    }

    if (mg == null && ml == null) {
      // Only `concentrationMgPerMl: null` was sent — clear everything.
      return { concentrationMgPerMl: null, concentrationMg: null, concentrationVolumeMl: null };
    }

    // Merge against the stored row so `PATCH { concentrationMg: 200 }` re-derives from the volume
    // already on file rather than rejecting a request that is perfectly well-defined.
    const mergedMg = mg ?? existing?.concentrationMg ?? null;
    const mergedMl = ml ?? existing?.concentrationVolumeMl ?? null;
    // "160 mg per ?" has no meaning, and defaulting the missing half to 1 would invent a dosing
    // error of exactly the size this feature exists to prevent.
    if (mergedMg == null || mergedMl == null) {
      throw new BadRequestException('CONCENTRATION_PAIR_INCOMPLETE');
    }

    const derived = Math.round((mergedMg / mergedMl) * 1e6) / 1e6;
    if (!Number.isFinite(derived) || derived < 0.001 || derived > 10000) {
      throw new BadRequestException('CONCENTRATION_OUT_OF_RANGE');
    }
    return { concentrationMgPerMl: derived, concentrationMg: mergedMg, concentrationVolumeMl: mergedMl };
  }

  async create(medicationId: string, userId: string, dto: CreateEmbodimentDto) {
    await this.ensureMedicationExists(medicationId);
    const db = this.db.db as any;
    const id = randomUUID();
    await db.insert(medicationEmbodiments).values({
      id,
      medicationId,
      label: dto.label,
      concentrationMgPerMl: null,
      concentrationMg: null,
      concentrationVolumeMl: null,
      ...this.resolveConcentration(dto, null),
      strengthMgPerUnit: dto.strengthMgPerUnit ?? null,
      unitType: dto.unitType,
      notes: dto.notes ?? null,
      atHome: dto.atHome ?? false,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      ...this.runningLowStamp(dto.runningLow, userId),
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
    const existing = await this.get(id);
    const db = this.db.db as any;
    const updates: Record<string, any> = {};
    if (dto.label !== undefined) updates.label = dto.label;
    const dosing: Record<string, any> = this.resolveConcentration(dto, existing);
    if (dto.strengthMgPerUnit !== undefined) dosing.strengthMgPerUnit = dto.strengthMgPerUnit;
    if (dto.unitType !== undefined) dosing.unitType = dto.unitType;
    await this.ensureDosingEditable(id, existing, dosing);
    Object.assign(updates, dosing);
    if (dto.notes !== undefined) updates.notes = dto.notes;
    if (dto.atHome !== undefined) updates.atHome = dto.atHome;
    if (dto.expiresAt !== undefined) {
      updates.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    Object.assign(updates, this.runningLowStamp(dto.runningLow, userId));
    if (Object.keys(updates).length) {
      await db.update(medicationEmbodiments).set(updates).where(eq(medicationEmbodiments.id, id));
    }
    return this.get(id);
  }

  // The fields that decide what "one unit" or "5 mL" of this form *means*. A logged dose keeps its
  // embodiment id and shows the label live, and a schedule stores `doseMg` and `doseMl` side by
  // side and copies `amountMl` onto every dose it logs -- so changing any of these in place, once
  // something points at the row, silently rewrites what a recorded or scheduled amount means
  // (api.md -> Embodiments, "Concentration lock"; ISSUES #47). The fix for a relabelled bottle is a
  // new embodiment.
  private static readonly DOSING_FIELDS = [
    'concentrationMgPerMl',
    'concentrationMg',
    'concentrationVolumeMl',
    'strengthMgPerUnit',
    'unitType',
  ] as const;

  /**
   * Refuse a PATCH that would *change* a dosing field on an embodiment a logged dose or a schedule
   * references. "Change" is judged on the merged, normalised values `update()` is about to write,
   * not on which keys the body carried, so a client echoing the stored row back succeeds.
   *
   * Consequence worth knowing: sending `concentrationMgPerMl` alone against a row that holds a label
   * pair clears the pair (see resolveConcentration), so even an identical per-mL figure is a change
   * here. A client echoing a pair-backed row must echo the pair.
   *
   * Only doses and schedules lock the row. A guideline or reaction pointing at it does not: neither
   * stores an amount in this embodiment's units.
   */
  private async ensureDosingEditable(id: string, existing: Record<string, any>, next: Record<string, any>) {
    const changed = EmbodimentsService.DOSING_FIELDS.some(
      (field) => field in next && !sameDosingValue(existing[field], next[field]),
    );
    if (!changed) return;
    const dependents = await embodimentDosingDependencies(this.db.db as any, id);
    if (Object.keys(dependents).length) {
      throw new ConflictException({ message: 'EMBODIMENT_CONCENTRATION_IN_USE', dependents });
    }
  }

  async remove(id: string) {
    await this.get(id);
    const db = this.db.db as any;
    // Refuse rather than orphan. Deleting dosing reference data out from under a logged dose is
    // silent data loss; the response says what's in the way so the caller can act on it
    // (api.md -> Medications). Retirement is `defaultActive: false`, not deletion.
    const dependents = await embodimentDependencies(db, id);
    if (Object.keys(dependents).length) {
      throw new ConflictException({ message: 'EMBODIMENT_IN_USE', dependents });
    }
    await db.delete(medicationEmbodiments).where(eq(medicationEmbodiments.id, id));
    return { deleted: true };
  }
}

/**
 * Equality for a dosing field. Numbers compare with a relative tolerance because the derived
 * per-mL figure is rounded to 1e-6 and round-trips through a double column on Postgres and a REAL
 * on SQLite; null only equals null (clearing a value is a change).
 */
function sameDosingValue(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}
