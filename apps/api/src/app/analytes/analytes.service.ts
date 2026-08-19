import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  Analyte,
  AnalyteHistory,
  AnalyteHistoryDose,
  AnalyteHistoryPoint,
  AnalyteRange,
  ChartOverlayDefault,
  ChartOverlayDefaultsResponse,
  ResolveAnalyteInput,
  ResolveAnalytesResult,
  ResolvedRange,
  SetChartOverlayDefaultsDto,
  VitalMetric,
} from '@salud/shared/types';
import { DatabaseService } from '../persistence/database.service';
import {
  analyteRanges,
  analytes,
  careTeamMemberships,
  chartOverlayDefaults,
  interventions,
  medications,
  observationEntries,
  observations,
} from '../../db/schema';
import { normalizeTs } from '../persistence/time';
import { matchesOverlayTags, parseMedicationTags } from '../medications/medication-tags';
import { analyteDependencies } from './analyte-dependencies';
import { ensureVitalAnalytes } from './vital-analytes';
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
      vitalMetric: (row.vitalMetric ?? null) as VitalMetric | null,
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
    // Scoped to lab rows. The seeded vitals are a separate namespace of exactly five, and a report
    // printing "TEMPERATURE" has to be able to create its own analyte: it is excluded from
    // matching the vital (see resolve), so a catalog-wide check would leave it with nowhere to go
    // (data-model.md → "Analyte catalog").
    const rows = await db.select().from(analytes).where(isNull(analytes.vitalMetric));
    const clash = rows.some((r: any) => r.id !== excludeId && normalizeName(String(r.name ?? '')) === target);
    if (clash) throw new ConflictException('ANALYTE_NAME_TAKEN');
  }

  private async getRaw(id: string) {
    const db = this.db.db as any;
    const rows = await db.select().from(analytes).where(eq(analytes.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('ANALYTE_NOT_FOUND');
    return rows[0];
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

  /**
   * `kind` defaults to `lab`, which excludes the seeded vitals. Every existing caller of this
   * endpoint is lab-facing (the catalog page, the import resolver's review step), so the default
   * keeps their results exactly as they were when vitals joined the table.
   */
  async list(params: { q?: string; kind?: 'lab' | 'vital' | 'all' } = {}): Promise<Analyte[]> {
    const db = this.db.db as any;
    await ensureVitalAnalytes(db);
    const kind = params.kind ?? 'lab';
    const where =
      kind === 'lab' ? isNull(analytes.vitalMetric) : kind === 'vital' ? isNotNull(analytes.vitalMetric) : undefined;
    const query = db.select().from(analytes);
    const rows = await (where ? query.where(where) : query).orderBy(asc(analytes.displayName));
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
    const row = await this.getRaw(id);
    const updates: Record<string, any> = {};
    if (dto.name !== undefined) {
      // A vital's `name` is fixed: the five are seeded, and uniqueness is only checked among lab
      // rows, so a rename here could walk a vital into a collision nothing would catch. Its
      // displayName and unit are ordinary labels and stay editable.
      if (row.vitalMetric) throw new ConflictException('ANALYTE_IS_VITAL');
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
    const row = await this.getRaw(id);
    const db = this.db.db as any;
    // Checked BEFORE the dependency count, which is structurally zero for a vital: its
    // measurements are `temperature` entries, not `lab_result` ones, so the guard below would read
    // it as unreferenced and cascade away every patient's temperature bands with it.
    if (row.vitalMetric) throw new ConflictException('ANALYTE_IS_VITAL');
    const dependents = await analyteDependencies(db, id);
    if (Object.keys(dependents).length) {
      throw new ConflictException({ message: 'ANALYTE_IN_USE', dependents });
    }
    // Every patient's ranges go with it — see analyte-dependencies.ts for why this cascades where
    // the medication catalog refuses to. Chart overlay defaults follow the same rule: rows about
    // a chart have no independent referents either.
    await db.delete(analyteRanges).where(eq(analyteRanges.analyteId, id));
    await db.delete(chartOverlayDefaults).where(eq(chartOverlayDefaults.analyteId, id));
    await db.delete(analytes).where(eq(analytes.id, id));
    return { deleted: true };
  }

  /**
   * Which dose markers this metric's chart shows by default (api.md → "Chart overlay defaults").
   *
   * Household-global like the catalog itself — no patient scoping, authentication only. A display
   * default and nothing more: the row never claims the doses relate to the readings (P6).
   */
  async listChartDefaults(analyteId: string): Promise<ChartOverlayDefaultsResponse> {
    // getRaw, not assertExists: these are ordinary by-id routes answering 404, where assertExists
    // carries the observation-write path's 400 (api.md → Error codes, ANALYTE_NOT_FOUND).
    await this.getRaw(analyteId);
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(chartOverlayDefaults)
      .where(eq(chartOverlayDefaults.analyteId, analyteId))
      .orderBy(asc(chartOverlayDefaults.value));
    return { overlays: rows.map((row: any) => this.mapOverlay(row)) };
  }

  private mapOverlay(row: any): ChartOverlayDefault {
    return { id: row.id, kind: row.kind, value: row.value };
  }

  /**
   * Replace this metric's overlay defaults wholesale (the `patients.devices` edit-whole shape).
   *
   * Duplicate (kind, value) pairs collapse rather than conflict, and an empty list is a valid,
   * respected choice — it clears the metric's defaults, which is how a household opts a chart out
   * of markers entirely. A tag no medication currently carries is accepted: it matches nothing
   * today and starts working the day a medication gains it.
   */
  async setChartDefaults(analyteId: string, dto: SetChartOverlayDefaultsDto): Promise<ChartOverlayDefaultsResponse> {
    await this.getRaw(analyteId);
    const db = this.db.db as any;
    const seen = new Set<string>();
    const rows: Array<{ id: string; analyteId: string; kind: string; value: string }> = [];
    for (const overlay of dto.overlays ?? []) {
      const value = overlay.value.trim();
      if (!value) continue;
      const key = `${overlay.kind} ${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ id: randomUUID(), analyteId, kind: overlay.kind, value });
    }
    // Replace rather than diff: the list is tiny, and a wholesale swap is what makes the endpoint's
    // contract ("the submitted list replaces the stored one") true by construction.
    await db.delete(chartOverlayDefaults).where(eq(chartOverlayDefaults.analyteId, analyteId));
    if (rows.length) await db.insert(chartOverlayDefaults).values(rows);
    return this.listChartDefaults(analyteId);
  }

  /**
   * The overlay tags for a vital metric, for callers holding a metric name rather than an analyte
   * id — the timeline's `temperatureOverlayTags` (api.md → Timeline & dashboard).
   */
  async vitalOverlayTags(metric: VitalMetric): Promise<string[]> {
    const analyteId = (await ensureVitalAnalytes(this.db.db as any)).get(metric);
    if (!analyteId) return [];
    return this.chartOverlayTags(analyteId);
  }

  /** The overlay tags for one analyte, reduced to the strings a chart matches doses against. */
  async chartOverlayTags(analyteId: string): Promise<string[]> {
    const db = this.db.db as any;
    const rows = await db
      .select()
      .from(chartOverlayDefaults)
      .where(and(eq(chartOverlayDefaults.analyteId, analyteId), eq(chartOverlayDefaults.kind, 'medication_tag')));
    return rows.map((row: any) => row.value);
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
    // Lab rows only. A printed "TEMPERATURE" line must never resolve onto the seeded vital, whose
    // ranges are the household's fever thresholds — a lab's printed reference range is not theirs
    // to overwrite (data-model.md → "Analyte catalog"). It creates its own lab analyte instead,
    // which the scoped uniqueness check in assertNameAvailable leaves room for.
    const existing = await db.select().from(analytes).where(isNull(analytes.vitalMetric));
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

  /**
   * Every listed patient's bands for one vital, each lineage resolved to `atTs`, reference first.
   *
   * Batched deliberately — one query for the whole sick-card set, in the `labContextSources` shape
   * rather than the N+1 one. Home is a single request, and resolving ranges per card is exactly the
   * fan-out that rule exists to prevent (api.md → GET /api/dashboard).
   */
  async vitalRangesForPatients(
    metric: VitalMetric,
    patientIds: string[],
    atTs: number,
  ): Promise<Array<{ patientId: string; ranges: ResolvedRange[] }>> {
    if (!patientIds.length) return [];
    const db = this.db.db as any;
    const analyteId = (await ensureVitalAnalytes(db)).get(metric);
    if (!analyteId) return patientIds.map((patientId) => ({ patientId, ranges: [] }));

    const rows = await db
      .select()
      .from(analyteRanges)
      .where(and(eq(analyteRanges.analyteId, analyteId), inArray(analyteRanges.patientId, patientIds)));

    const byPatient = new Map<string, AnalyteRange[]>(patientIds.map((id) => [id, []]));
    for (const row of rows) byPatient.get(row.patientId)?.push(this.pickRange(row));

    return patientIds.map((patientId) => ({
      patientId,
      ranges: AnalytesService.resolveLineagesAt(byPatient.get(patientId) ?? [], atTs).map((r) =>
        AnalytesService.rangeContext(r),
      ),
    }));
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
    const doses = await this.overlayDosesFor(patientId, analyteId);
    return { analyte, ranges, points, doses };
  }

  /**
   * This patient's doses whose medication carries one of the metric's chart overlay defaults —
   * what the history chart draws as markers, so it needs no timeline fan-out.
   *
   * Presence data only: which doses happened and when, never an annotation about what they did
   * (P6). No defaults, or nothing matching them, is an empty array and a chart with no markers.
   */
  private async overlayDosesFor(patientId: string, analyteId: string): Promise<AnalyteHistoryDose[]> {
    const overlayTags = await this.chartOverlayTags(analyteId);
    if (!overlayTags.length) return [];
    const db = this.db.db as any;
    const wanted = new Set(overlayTags);

    const medicationRows = await db.select().from(medications);
    const matching = new Map<string, { name: string; tags: string[] }>();
    for (const row of medicationRows) {
      const tags = parseMedicationTags(row.tags);
      if (matchesOverlayTags(tags, wanted)) matching.set(row.id, { name: row.name, tags });
    }
    if (!matching.size) return [];

    const doseRows = await db
      .select()
      .from(interventions)
      .where(and(eq(interventions.patientId, patientId), eq(interventions.type, 'medication_dose')));

    const out: AnalyteHistoryDose[] = [];
    for (const row of doseRows) {
      let metadata: any;
      try {
        metadata = row.metadata ? JSON.parse(row.metadata) : {};
      } catch {
        continue;
      }
      const medication = matching.get(metadata?.medicationId);
      if (!medication) continue;
      out.push({
        interventionId: row.id,
        performedAt: normalizeTs(row.performedAt) as number,
        medicationId: metadata.medicationId,
        medicationName: medication.name,
        amountMg: typeof metadata.amountMg === 'number' ? metadata.amountMg : null,
        medicationTags: medication.tags,
      });
    }
    out.sort((a, b) => a.performedAt - b.performedAt);
    return out;
  }
}
