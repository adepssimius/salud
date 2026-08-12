import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  Analyte,
  AnalyteGoal,
  AnalyteHistory,
  AnalyteHistoryPoint,
  AnalyteReferenceRange,
  LabResultContext,
  ResolveAnalyteInput,
  ResolveAnalytesResult,
} from '@salud/shared/types';
import { DatabaseService } from '../persistence/database.service';
import {
  analyteGoals,
  analyteReferenceRanges,
  analytes,
  careTeamMemberships,
  observationEntries,
  observations,
} from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { analyteDependencies } from './analyte-dependencies';
import { CreateAnalyteDto } from './dto/create-analyte.dto';
import { UpdateAnalyteDto } from './dto/update-analyte.dto';
import { CreateReferenceRangeDto } from './dto/create-reference-range.dto';
import { UpdateReferenceRangeDto } from './dto/update-reference-range.dto';
import { UpsertAnalyteGoalDto } from './dto/upsert-analyte-goal.dto';

/**
 * Title-case a lab's printed analyte name for the default display name.
 *
 * Lab reports print in caps, and blanket title-casing mangles the abbreviations they are full of:
 * "MCV" would become "Mcv", "VITAMIN D,25-OH,TOTAL,IA" would lose both "OH" and "IA". A token is
 * left alone when it is short (≤ 2 chars) or has no vowel — which is what medical abbreviations
 * look like — and title-cased otherwise. It only has to be a good *default*; displayName is
 * editable precisely because no rule gets every name right.
 */
export function titleCaseAnalyte(name: string): string {
  return name.replace(/[A-Za-z][A-Za-z']*/g, (word) => {
    if (word.length <= 2) return word;
    if (!/[AEIOUaeiou]/.test(word)) return word;
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  });
}

const normalizeName = (name: string) => name.trim().toLowerCase();

@Injectable()
export class AnalytesService {
  constructor(private readonly db: DatabaseService) {}

  private pickAnalyte(row: any): Analyte {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      unit: row.unit ?? null,
      panel: row.panel ?? null,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  private pickRange(row: any): AnalyteReferenceRange {
    return {
      id: row.id,
      analyteId: row.analyteId,
      refLow: row.refLow ?? null,
      refHigh: row.refHigh ?? null,
      refText: row.refText ?? null,
      effectiveFrom: normalizeTs(row.effectiveFrom) as number,
      source: row.source ?? null,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

  private pickGoal(row: any): AnalyteGoal {
    return {
      id: row.id,
      patientId: row.patientId,
      analyteId: row.analyteId,
      goalLow: row.goalLow ?? null,
      goalHigh: row.goalHigh ?? null,
      note: row.note ?? null,
      createdAt: normalizeTs(row.createdAt),
      updatedAt: normalizeTs(row.updatedAt),
    };
  }

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

  // Service-level and case-insensitive rather than a unique index, for the reasons spelled out on
  // MedicationsService.assertNameAvailable: portability, and a driver constraint error carrying no
  // machine-readable code. The catalog is one household's lab vocabulary; scanning it costs nothing.
  private async assertNameAvailable(name: string, excludeId?: string) {
    const db = this.db.db as any;
    const target = normalizeName(name);
    const rows = await db.select().from(analytes);
    const clash = rows.some((r: any) => r.id !== excludeId && normalizeName(String(r.name ?? '')) === target);
    if (clash) throw new ConflictException('ANALYTE_NAME_TAKEN');
  }

  async create(dto: CreateAnalyteDto): Promise<Analyte> {
    await this.assertNameAvailable(dto.name);
    const db = this.db.db as any;
    const id = randomUUID();
    await db.insert(analytes).values({
      id,
      name: dto.name,
      displayName: dto.displayName?.trim() || titleCaseAnalyte(dto.name),
      unit: dto.unit ?? null,
      panel: dto.panel ?? null,
    });
    return this.get(id);
  }

  async list(params: { q?: string } = {}): Promise<Analyte[]> {
    const db = this.db.db as any;
    const rows = await db.select().from(analytes).orderBy(asc(analytes.displayName));
    const mapped: Analyte[] = rows.map((r: any) => this.pickAnalyte(r));
    if (!params.q) return mapped;
    const q = params.q.toLowerCase();
    // Panel is searchable too: "iron" should find % Saturation, which never says "iron" itself.
    return mapped.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        (a.panel ?? '').toLowerCase().includes(q),
    );
  }

  async get(id: string): Promise<Analyte> {
    const db = this.db.db as any;
    const rows = await db.select().from(analytes).where(eq(analytes.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('ANALYTE_NOT_FOUND');
    return this.pickAnalyte(rows[0]);
  }

  /** Existence check for callers writing lab_result entries; 400 rather than 404 — it's a bad body. */
  async assertExists(id: string) {
    const db = this.db.db as any;
    const rows = await db.select({ id: analytes.id }).from(analytes).where(eq(analytes.id, id)).limit(1);
    if (!rows.length) throw new BadRequestException('ANALYTE_NOT_FOUND');
  }

  async update(id: string, dto: UpdateAnalyteDto): Promise<Analyte> {
    const db = this.db.db as any;
    await this.get(id);
    const updates: Record<string, any> = {};
    if (dto.name !== undefined) {
      // excludeId so renaming an analyte to the name it already has is a no-op, not a conflict.
      await this.assertNameAvailable(dto.name, id);
      updates.name = dto.name;
    }
    if (dto.displayName !== undefined) updates.displayName = dto.displayName;
    if (dto.unit !== undefined) updates.unit = dto.unit;
    if (dto.panel !== undefined) updates.panel = dto.panel;
    if (Object.keys(updates).length) {
      updates.updatedAt = new Date();
      await db.update(analytes).set(updates).where(eq(analytes.id, id));
    }
    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    const db = this.db.db as any;
    const dependents = await analyteDependencies(db, id);
    if (Object.keys(dependents).length) {
      throw new ConflictException({ message: 'ANALYTE_IN_USE', dependents });
    }
    // Ranges and goals go with it — see analyte-dependencies.ts for why this cascades where the
    // medication catalog refuses to.
    await db.delete(analyteReferenceRanges).where(eq(analyteReferenceRanges.analyteId, id));
    await db.delete(analyteGoals).where(eq(analyteGoals.analyteId, id));
    await db.delete(analytes).where(eq(analytes.id, id));
    return { deleted: true };
  }

  /**
   * Turn printed names into analyte ids, creating what's missing. Idempotent, and the only way a
   * client is meant to obtain an `analyteId` for a `lab_result` entry (api.md → Analytes).
   *
   * The unit and panel a report printed are used **only when creating**. An import never rewrites
   * what the catalog already says — the same rule the reference-range conflict prompt follows.
   *
   * Results come back in input order, including duplicates within the same request: the caller
   * zips them against its own rows. Two concurrent resolves of the same brand-new name could both
   * insert — acceptable at household scale, and the duplicate is fixable by renaming one.
   */
  async resolve(inputs: ResolveAnalyteInput[]): Promise<ResolveAnalytesResult[]> {
    const db = this.db.db as any;
    const existing = await db.select().from(analytes);
    const byNormalized = new Map<string, any>(existing.map((r: any) => [normalizeName(String(r.name ?? '')), r]));

    for (const input of inputs) {
      const key = normalizeName(input.name);
      if (!key || byNormalized.has(key)) continue;
      const id = randomUUID();
      const row = {
        id,
        name: input.name,
        displayName: titleCaseAnalyte(input.name),
        unit: input.unit ?? null,
        panel: input.panel ?? null,
      };
      await db.insert(analytes).values(row);
      byNormalized.set(key, { ...row, created: true });
    }

    return inputs.map((input) => {
      const row = byNormalized.get(normalizeName(input.name));
      return {
        name: input.name,
        analyteId: row.id,
        displayName: row.displayName,
        created: row.created === true,
      };
    });
  }

  // --- Reference ranges -----------------------------------------------------------------------

  /**
   * The range in effect at `atTs`: the row with the greatest `effectiveFrom` at or before it.
   * Same filter-then-rank shape as DosingService.resolveGuideline, evaluated at the *event's*
   * time rather than now, so a result recorded years ago keeps being read against the standard
   * that applied when the specimen was drawn. Nothing is in effect before the earliest row.
   */
  static resolveRangeAt(ranges: AnalyteReferenceRange[], atTs: number): AnalyteReferenceRange | null {
    let winner: AnalyteReferenceRange | null = null;
    for (const range of ranges) {
      if (range.effectiveFrom > atTs) continue;
      if (!winner || range.effectiveFrom > winner.effectiveFrom) winner = range;
    }
    return winner;
  }

  /** The resolved range as it appears on a read: the row's identity and its bounds, nothing else. */
  static rangeContext(range: AnalyteReferenceRange | null): LabResultContext['referenceRange'] {
    if (!range) return null;
    return {
      id: range.id,
      refLow: range.refLow,
      refHigh: range.refHigh,
      refText: range.refText,
      effectiveFrom: range.effectiveFrom,
    };
  }

  private assertRangeNotEmpty(refLow: unknown, refHigh: unknown, refText: unknown) {
    const hasBound = typeof refLow === 'number' || typeof refHigh === 'number';
    const hasText = typeof refText === 'string' && refText.trim().length > 0;
    if (!hasBound && !hasText) throw new BadRequestException('ANALYTE_RANGE_EMPTY');
  }

  async listRanges(analyteId: string): Promise<AnalyteReferenceRange[]> {
    await this.get(analyteId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(analyteReferenceRanges)
      .where(eq(analyteReferenceRanges.analyteId, analyteId))
      .orderBy(desc(analyteReferenceRanges.effectiveFrom));
    return rows.map((r: any) => this.pickRange(r));
  }

  async createRange(analyteId: string, dto: CreateReferenceRangeDto): Promise<AnalyteReferenceRange> {
    await this.get(analyteId);
    this.assertRangeNotEmpty(dto.refLow, dto.refHigh, dto.refText);
    const db = this.db.db as any;
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveFromTs = Math.floor(effectiveFrom.getTime() / 1000);

    // Retry-safe: an import that partially failed and is being re-run must not stack identical
    // ranges. Compares against the row already in effect at that moment, not just an exact-date
    // match — re-posting the same standard is a no-op whichever date it carries.
    const existing = await this.listRanges(analyteId);
    const inEffect = AnalytesService.resolveRangeAt(existing, effectiveFromTs);
    if (
      inEffect &&
      (inEffect.refLow ?? null) === (dto.refLow ?? null) &&
      (inEffect.refHigh ?? null) === (dto.refHigh ?? null) &&
      (inEffect.refText ?? null) === (dto.refText ?? null)
    ) {
      return inEffect;
    }

    const id = randomUUID();
    await db.insert(analyteReferenceRanges).values({
      id,
      analyteId,
      refLow: dto.refLow ?? null,
      refHigh: dto.refHigh ?? null,
      refText: dto.refText ?? null,
      effectiveFrom,
      source: dto.source ?? null,
    });
    return this.getRange(id);
  }

  async getRange(id: string): Promise<AnalyteReferenceRange> {
    const db = this.db.db as any;
    const rows = await db.select().from(analyteReferenceRanges).where(eq(analyteReferenceRanges.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('ANALYTE_RANGE_NOT_FOUND');
    return this.pickRange(rows[0]);
  }

  async updateRange(id: string, dto: UpdateReferenceRangeDto) {
    const db = this.db.db as any;
    const current = await this.getRange(id);
    const merged = {
      refLow: dto.refLow !== undefined ? dto.refLow : current.refLow,
      refHigh: dto.refHigh !== undefined ? dto.refHigh : current.refHigh,
      refText: dto.refText !== undefined ? dto.refText : current.refText,
    };
    // Against the merged row, not the submitted fields: clearing the last bound of a range through
    // a partial PATCH is invisible to any per-field validator, and an empty range silently matches
    // nothing at read time.
    this.assertRangeNotEmpty(merged.refLow, merged.refHigh, merged.refText);
    const updates: Record<string, any> = { ...merged, updatedAt: new Date() };
    if (dto.effectiveFrom !== undefined) updates.effectiveFrom = new Date(dto.effectiveFrom);
    if (dto.source !== undefined) updates.source = dto.source;
    await db.update(analyteReferenceRanges).set(updates).where(eq(analyteReferenceRanges.id, id));
    return this.getRange(id);
  }

  async removeRange(id: string) {
    await this.getRange(id);
    const db = this.db.db as any;
    await db.delete(analyteReferenceRanges).where(eq(analyteReferenceRanges.id, id));
    return { deleted: true };
  }

  // --- Goals ----------------------------------------------------------------------------------

  async listGoals(patientId: string, userId: string): Promise<AnalyteGoal[]> {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db.select().from(analyteGoals).where(eq(analyteGoals.patientId, patientId));
    if (!rows.length) return [];
    const names = await db
      .select({ id: analytes.id, displayName: analytes.displayName })
      .from(analytes)
      .where(inArray(analytes.id, rows.map((r: any) => r.analyteId)));
    const nameById = new Map<string, string>(names.map((n: any) => [n.id, n.displayName]));
    return rows.map((r: any) => ({ ...this.pickGoal(r), displayName: nameById.get(r.analyteId) }));
  }

  async getGoal(patientId: string, analyteId: string, userId: string): Promise<AnalyteGoal | null> {
    await this.ensurePatientAccess(patientId, userId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(analyteGoals)
      .where(and(eq(analyteGoals.patientId, patientId), eq(analyteGoals.analyteId, analyteId)))
      .limit(1);
    return rows.length ? this.pickGoal(rows[0]) : null;
  }

  async upsertGoal(patientId: string, analyteId: string, userId: string, dto: UpsertAnalyteGoalDto) {
    await this.ensurePatientAccess(patientId, userId);
    await this.get(analyteId);
    if (typeof dto.goalLow !== 'number' && typeof dto.goalHigh !== 'number') {
      throw new BadRequestException('ANALYTE_GOAL_EMPTY');
    }
    const db = this.db.db as any;
    const existing = await this.getGoal(patientId, analyteId, userId);
    if (existing) {
      await db
        .update(analyteGoals)
        .set({
          goalLow: dto.goalLow ?? null,
          goalHigh: dto.goalHigh ?? null,
          note: dto.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(analyteGoals.id, existing.id));
    } else {
      await db.insert(analyteGoals).values({
        id: randomUUID(),
        patientId,
        analyteId,
        goalLow: dto.goalLow ?? null,
        goalHigh: dto.goalHigh ?? null,
        note: dto.note ?? null,
      });
    }
    return (await this.getGoal(patientId, analyteId, userId)) as AnalyteGoal;
  }

  async removeGoal(patientId: string, analyteId: string, userId: string) {
    const existing = await this.getGoal(patientId, analyteId, userId);
    if (!existing) throw new NotFoundException('ANALYTE_GOAL_NOT_FOUND');
    const db = this.db.db as any;
    await db.delete(analyteGoals).where(eq(analyteGoals.id, existing.id));
    return { deleted: true };
  }

  // --- Read-time hydration --------------------------------------------------------------------

  /**
   * Everything the observation read paths need to attach `labContext` to lab_result entries, in
   * one batched pass per patient (the `medicationNames` shape, not the N+1 one). Callers resolve
   * the range themselves with resolveRangeAt at each observation's own observedAt.
   */
  async labContextSources(
    patientId: string,
    analyteIds: string[],
  ): Promise<Map<string, { displayName: string; ranges: AnalyteReferenceRange[]; goal: LabResultContext['goal'] }>> {
    const out = new Map<string, { displayName: string; ranges: AnalyteReferenceRange[]; goal: LabResultContext['goal'] }>();
    const ids = Array.from(new Set(analyteIds.filter(Boolean)));
    if (!ids.length) return out;
    const db = this.db.db as any;
    const [analyteRows, rangeRows, goalRows] = await Promise.all([
      db.select().from(analytes).where(inArray(analytes.id, ids)),
      db.select().from(analyteReferenceRanges).where(inArray(analyteReferenceRanges.analyteId, ids)),
      db
        .select()
        .from(analyteGoals)
        .where(and(eq(analyteGoals.patientId, patientId), inArray(analyteGoals.analyteId, ids))),
    ]);

    const goalByAnalyte = new Map<string, LabResultContext['goal']>(
      goalRows.map((g: any) => [
        g.analyteId,
        { goalLow: g.goalLow ?? null, goalHigh: g.goalHigh ?? null, note: g.note ?? null },
      ]),
    );
    for (const row of analyteRows) {
      out.set(row.id, {
        displayName: row.displayName,
        ranges: rangeRows.filter((r: any) => r.analyteId === row.id).map((r: any) => this.pickRange(r)),
        goal: goalByAnalyte.get(row.id) ?? null,
      });
    }
    return out;
  }

  /** One analyte's recorded values for one patient, plus the standards to read them against. */
  async history(patientId: string, analyteId: string, userId: string): Promise<AnalyteHistory> {
    await this.ensurePatientAccess(patientId, userId);
    const analyte = await this.get(analyteId);
    const db = this.db.db as any;

    const rows = await db
      .select({
        observationId: observations.id,
        observedAt: observations.observedAt,
        metadata: observationEntries.metadata,
      })
      .from(observationEntries)
      .innerJoin(observations, eq(observationEntries.observationId, observations.id))
      .where(and(eq(observationEntries.type, 'lab_result'), eq(observations.patientId, patientId)));

    const points: AnalyteHistoryPoint[] = [];
    for (const row of rows) {
      if (!row.metadata) continue;
      let metadata: any;
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        continue; // unparseable blob can't be referencing this analyte
      }
      if (metadata?.analyteId !== analyteId) continue;
      points.push({
        observationId: row.observationId,
        observedAt: normalizeTs(row.observedAt) as number,
        valueText: metadata.valueText ?? '',
        value: typeof metadata.value === 'number' ? metadata.value : null,
        unit: metadata.unit ?? null,
        flag: metadata.flag ?? null,
      });
    }
    points.sort((a, b) => a.observedAt - b.observedAt);

    const ranges = (await this.listRanges(analyteId)).slice().sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    const goal = await this.getGoal(patientId, analyteId, userId);
    return { analyte, ranges, goal, points };
  }
}
