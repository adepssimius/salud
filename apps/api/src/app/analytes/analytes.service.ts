import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  Analyte,
  AnalyteHistory,
  AnalyteHistoryPoint,
  AnalyteRange,
  ResolveAnalyteInput,
  ResolveAnalytesResult,
  ResolvedRange,
} from '@salud/shared/types';
import { DatabaseService } from '../persistence/database.service';
import {
  analyteRanges,
  analytes,
  careTeamMemberships,
  observationEntries,
  observations,
} from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { analyteDependencies } from './analyte-dependencies';
import { CreateAnalyteDto } from './dto/create-analyte.dto';
import { UpdateAnalyteDto } from './dto/update-analyte.dto';
import { CreateAnalyteRangeDto } from './dto/create-analyte-range.dto';
import { UpdateAnalyteRangeDto } from './dto/update-analyte-range.dto';

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

// A lineage is one named band's history: rows sharing these four things are successive versions
// of the same standard, and only they compete to be "in effect" at a moment.
const lineageKey = (r: { patientId: string; analyteId: string; kind: string; label: string }) =>
  `${r.patientId}\u0000${r.analyteId}\u0000${r.kind}\u0000${normalizeName(r.label)}`;

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

  private pickRange(row: any): AnalyteRange {
    return {
      id: row.id,
      analyteId: row.analyteId,
      patientId: row.patientId,
      kind: row.kind,
      label: row.label,
      low: row.low ?? null,
      high: row.high ?? null,
      refText: row.refText ?? null,
      effectiveFrom: normalizeTs(row.effectiveFrom) as number,
      source: row.source ?? null,
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
    // Every patient's ranges go with it — see analyte-dependencies.ts for why this cascades where
    // the medication catalog refuses to.
    await db.delete(analyteRanges).where(eq(analyteRanges.analyteId, id));
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

  // --- Ranges ---------------------------------------------------------------------------------

  /**
   * The row in effect at `atTs` **within one lineage**: the greatest `effectiveFrom` at or before
   * it. Same filter-then-rank shape as DosingService.resolveGuideline, evaluated at the *event's*
   * time rather than now, so a result recorded years ago keeps being read against the standard
   * that applied when the specimen was drawn. Nothing is in effect before the earliest row.
   */
  static resolveRangeAt(ranges: AnalyteRange[], atTs: number): AnalyteRange | null {
    let winner: AnalyteRange | null = null;
    for (const range of ranges) {
      if (range.effectiveFrom > atTs) continue;
      if (!winner || range.effectiveFrom > winner.effectiveFrom) winner = range;
    }
    return winner;
  }

  /**
   * One effective row per lineage — what a reader needs to judge a value: the lab's "Reference"
   * and the caregiver's own "Athletic goal" side by side, each at its own version for that moment.
   */
  static resolveLineagesAt(ranges: AnalyteRange[], atTs: number): AnalyteRange[] {
    const byLineage = new Map<string, AnalyteRange[]>();
    for (const range of ranges) {
      const key = lineageKey(range);
      const bucket = byLineage.get(key);
      if (bucket) bucket.push(range);
      else byLineage.set(key, [range]);
    }
    const out: AnalyteRange[] = [];
    for (const bucket of byLineage.values()) {
      const winner = AnalytesService.resolveRangeAt(bucket, atTs);
      if (winner) out.push(winner);
    }
    // Reference first, then by label, so a rendered list is stable rather than insertion-ordered.
    out.sort((a, b) =>
      a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'reference' ? -1 : 1,
    );
    return out;
  }

  /** A resolved row as it appears on a read: its identity and bounds, nothing else. */
  static rangeContext(range: AnalyteRange): ResolvedRange {
    return {
      id: range.id,
      kind: range.kind,
      label: range.label,
      low: range.low,
      high: range.high,
      refText: range.refText,
      effectiveFrom: range.effectiveFrom,
    };
  }

  private assertRangeNotEmpty(low: unknown, high: unknown, refText: unknown) {
    const hasBound = typeof low === 'number' || typeof high === 'number';
    const hasText = typeof refText === 'string' && refText.trim().length > 0;
    if (!hasBound && !hasText) throw new BadRequestException('ANALYTE_RANGE_EMPTY');
  }

  /** All of one patient's ranges for one analyte, every lineage, newest first. */
  async listRanges(patientId: string, analyteId: string, userId: string): Promise<AnalyteRange[]> {
    await this.ensurePatientAccess(patientId, userId);
    await this.get(analyteId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(analyteRanges)
      .where(and(eq(analyteRanges.patientId, patientId), eq(analyteRanges.analyteId, analyteId)))
      .orderBy(desc(analyteRanges.effectiveFrom));
    return rows.map((r: any) => this.pickRange(r));
  }

  async createRange(
    patientId: string,
    analyteId: string,
    userId: string,
    dto: CreateAnalyteRangeDto,
  ): Promise<AnalyteRange> {
    await this.ensurePatientAccess(patientId, userId);
    await this.get(analyteId);
    this.assertRangeNotEmpty(dto.low, dto.high, dto.refText);
    const db = this.db.db as any;
    const kind = dto.kind ?? 'custom';
    const label = dto.label.trim();
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveFromTs = Math.floor(effectiveFrom.getTime() / 1000);

    // Retry-safe: an import that partially failed and is being re-run must not stack identical
    // rows. Compared within the lineage against whatever was in effect at that moment, not by
    // exact date — re-posting the same standard is a no-op whichever date it carries.
    const existing = await this.listRanges(patientId, analyteId, userId);
    const sameLineage = existing.filter(
      (r) => r.kind === kind && normalizeName(r.label) === normalizeName(label),
    );
    const inEffect = AnalytesService.resolveRangeAt(sameLineage, effectiveFromTs);
    if (
      inEffect &&
      (inEffect.low ?? null) === (dto.low ?? null) &&
      (inEffect.high ?? null) === (dto.high ?? null) &&
      (inEffect.refText ?? null) === (dto.refText ?? null)
    ) {
      return inEffect;
    }

    const id = randomUUID();
    await db.insert(analyteRanges).values({
      id,
      analyteId,
      patientId,
      kind,
      label,
      low: dto.low ?? null,
      high: dto.high ?? null,
      refText: dto.refText ?? null,
      effectiveFrom,
      source: dto.source ?? null,
    });
    return this.getRange(id, userId);
  }

  /**
   * A range is found through its own patient: membership is checked against the row's `patientId`,
   * and a non-member gets the same 404 a bad id gets — the row's existence is not confirmed to
   * someone who has no business with that patient.
   */
  async getRange(id: string, userId: string): Promise<AnalyteRange> {
    const db = this.db.db as any;
    const rows = await db.select().from(analyteRanges).where(eq(analyteRanges.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('ANALYTE_RANGE_NOT_FOUND');
    const range = this.pickRange(rows[0]);
    try {
      await this.ensurePatientAccess(range.patientId, userId);
    } catch {
      throw new NotFoundException('ANALYTE_RANGE_NOT_FOUND');
    }
    return range;
  }

  async updateRange(id: string, userId: string, dto: UpdateAnalyteRangeDto) {
    const db = this.db.db as any;
    const current = await this.getRange(id, userId);
    const merged = {
      low: dto.low !== undefined ? dto.low : current.low,
      high: dto.high !== undefined ? dto.high : current.high,
      refText: dto.refText !== undefined ? dto.refText : current.refText,
    };
    // Against the merged row, not the submitted fields: clearing the last bound through a partial
    // PATCH is invisible to any per-field validator, and an empty range matches nothing at read
    // time.
    this.assertRangeNotEmpty(merged.low, merged.high, merged.refText);
    const updates: Record<string, any> = { ...merged, updatedAt: new Date() };
    if (dto.label !== undefined) updates.label = dto.label.trim();
    if (dto.kind !== undefined) updates.kind = dto.kind;
    if (dto.effectiveFrom !== undefined) updates.effectiveFrom = new Date(dto.effectiveFrom);
    if (dto.source !== undefined) updates.source = dto.source;
    await db.update(analyteRanges).set(updates).where(eq(analyteRanges.id, id));
    return this.getRange(id, userId);
  }

  async removeRange(id: string, userId: string) {
    await this.getRange(id, userId);
    const db = this.db.db as any;
    await db.delete(analyteRanges).where(eq(analyteRanges.id, id));
    return { deleted: true };
  }

  // --- Read-time hydration --------------------------------------------------------------------

  /**
   * Everything the observation read paths need to attach `labContext` to lab_result entries, in
   * one batched pass per patient (the `medicationNames` shape, not the N+1 one). Callers resolve
   * the lineages themselves with resolveLineagesAt at each observation's own observedAt.
   */
  async labContextSources(
    patientId: string,
    analyteIds: string[],
  ): Promise<Map<string, { displayName: string; ranges: AnalyteRange[] }>> {
    const out = new Map<string, { displayName: string; ranges: AnalyteRange[] }>();
    const ids = Array.from(new Set(analyteIds.filter(Boolean)));
    if (!ids.length) return out;
    const db = this.db.db as any;
    const [analyteRows, rangeRows] = await Promise.all([
      db.select().from(analytes).where(inArray(analytes.id, ids)),
      db
        .select()
        .from(analyteRanges)
        .where(and(eq(analyteRanges.patientId, patientId), inArray(analyteRanges.analyteId, ids))),
    ]);

    for (const row of analyteRows) {
      out.set(row.id, {
        displayName: row.displayName,
        ranges: rangeRows.filter((r: any) => r.analyteId === row.id).map((r: any) => this.pickRange(r)),
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

    const ranges = (await this.listRanges(patientId, analyteId, userId))
      .slice()
      .sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    return { analyte, ranges, points };
  }
}
