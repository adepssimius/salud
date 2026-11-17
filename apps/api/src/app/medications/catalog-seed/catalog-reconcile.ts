import { randomUUID } from 'crypto';
import type {
  CatalogSeedApplyResult,
  CatalogSeedDifference,
  CatalogSeedNewEmbodiment,
  CatalogSeedNewGuideline,
  CatalogSeedNewMedication,
  CatalogSeedPresentItem,
  CatalogSeedValue,
} from '@salud/shared/types';
import { medicationEmbodiments, medicationGuidelines, medications } from '../../../db/schema';
import {
  CatalogFile,
  CatalogFileEmbodiment,
  CatalogFileGuideline,
  CatalogFileMedication,
  normalizeName,
} from './catalog-file';

/**
 * Reconciles the repo catalog file against the database (api.md → "Repo catalog").
 *
 * A plain module rather than a provider, like `catalog-dependencies.ts`, because
 * `tools/seed-catalog.ts` runs exactly this code against a database it opened itself — one
 * reconcile, so the dev seed and the button can never disagree about what "missing" means.
 *
 * The one rule everything here serves: **reconciling only ever inserts.** A row that matches is the
 * household's, edits included; the file's differing values are reported, never written.
 */

type Db = any;

export interface CatalogState {
  medications: any[];
  embodiments: any[];
  guidelines: any[];
}

export async function loadCatalogState(db: Db): Promise<CatalogState> {
  const [meds, embs, guides] = await Promise.all([
    db.select().from(medications),
    db.select().from(medicationEmbodiments),
    db.select().from(medicationGuidelines),
  ]);
  return { medications: meds, embodiments: embs, guidelines: guides };
}

type Op =
  | { kind: 'medication'; med: CatalogFileMedication }
  | { kind: 'embodiment'; medicationId: string; emb: CatalogFileEmbodiment }
  | { kind: 'guideline'; medicationId: string; embodimentId: string | null; guideline: CatalogFileGuideline };

export interface Reconciliation {
  newMedications: CatalogSeedNewMedication[];
  newEmbodiments: CatalogSeedNewEmbodiment[];
  newGuidelines: CatalogSeedNewGuideline[];
  present: CatalogSeedPresentItem[];
  /** selectionId → what adding it would write. Only the three offered kinds are here. */
  ops: Map<string, Op>;
  /**
   * selectionId → the offered item that already carries it. An embodiment of a new medication, or
   * a guideline of a new embodiment, is not offered on its own: it arrives with its parent.
   */
  coveredBy: Map<string, string>;
}

export const medicationSelectionId = (m: CatalogFileMedication) => m.key;
export const embodimentSelectionId = (m: CatalogFileMedication, e: CatalogFileEmbodiment) => `${m.key}/${e.key}`;
export const guidelineSelectionId = (
  m: CatalogFileMedication,
  e: CatalogFileEmbodiment | null,
  g: CatalogFileGuideline,
) => `${m.key}/${e ? e.key : ''}/${g.key}`;

// ---- comparing values ---------------------------------------------------------------------------

function sameNumber(a: unknown, b: unknown): boolean {
  const an = a == null ? null : Number(a);
  const bn = b == null ? null : Number(b);
  if (an === null || bn === null) return an === bn;
  if (an === bn) return true;
  return Math.abs(an - bn) <= 1e-9 * Math.max(Math.abs(an), Math.abs(bn));
}

function sameText(a: unknown, b: unknown): boolean {
  // Absent and empty are the same statement: "nothing recorded".
  return String(a ?? '').trim() === String(b ?? '').trim();
}

function sameList(a: string[], b: string[]): boolean {
  // A list of names, not an ordered sequence: order and case are not what the file is asserting.
  const norm = (xs: string[]) => [...new Set(xs.map((x) => normalizeName(x)))].sort().join('\u0000');
  return norm(a) === norm(b);
}

function parseList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function textValue(v: unknown): CatalogSeedValue {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function numberValue(v: unknown): CatalogSeedValue {
  return v == null ? null : Number(v);
}

/** The per-mL figure a file embodiment describes, derived the way the embodiments service does. */
export function fileConcentrationMgPerMl(e: CatalogFileEmbodiment): number | null {
  if (e.concentrationMg != null && e.concentrationVolumeMl != null) {
    return Math.round((e.concentrationMg / e.concentrationVolumeMl) * 1e6) / 1e6;
  }
  return e.concentrationMgPerMl ?? null;
}

function medicationDifferences(row: any, m: CatalogFileMedication): CatalogSeedDifference[] {
  const diffs: CatalogSeedDifference[] = [];
  if (!sameText(row.description, m.description)) {
    diffs.push({ field: 'description', database: textValue(row.description), file: textValue(m.description) });
  }
  const brands = parseList(row.brandNames);
  if (!sameList(brands, m.brandNames)) diffs.push({ field: 'brandNames', database: brands, file: m.brandNames });
  const tags = parseList(row.tags);
  if (!sameList(tags, m.tags)) diffs.push({ field: 'tags', database: tags, file: m.tags });
  return diffs;
}

function embodimentDifferences(row: any, e: CatalogFileEmbodiment): CatalogSeedDifference[] {
  const diffs: CatalogSeedDifference[] = [];
  if (row.unitType !== e.unitType) diffs.push({ field: 'unitType', database: row.unitType, file: e.unitType });
  const numeric: Array<[string, unknown, unknown]> = [
    ['concentrationMgPerMl', row.concentrationMgPerMl, fileConcentrationMgPerMl(e)],
    ['concentrationMg', row.concentrationMg, e.concentrationMg],
    ['concentrationVolumeMl', row.concentrationVolumeMl, e.concentrationVolumeMl],
    ['strengthMgPerUnit', row.strengthMgPerUnit, e.strengthMgPerUnit],
  ];
  for (const [field, db, file] of numeric) {
    if (!sameNumber(db, file)) diffs.push({ field, database: numberValue(db), file: numberValue(file) });
  }
  if (!sameText(row.notes, e.notes)) diffs.push({ field: 'notes', database: textValue(row.notes), file: textValue(e.notes) });
  return diffs;
}

const GUIDELINE_NUMBERS = [
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
] as const;

function guidelineDifferences(row: any, g: CatalogFileGuideline): CatalogSeedDifference[] {
  const diffs: CatalogSeedDifference[] = [];
  for (const field of GUIDELINE_NUMBERS) {
    if (!sameNumber(row[field], g[field])) {
      diffs.push({ field, database: numberValue(row[field]), file: numberValue(g[field]) });
    }
  }
  // Absent in the file means the default, so a household that never touched it shows no drift.
  const fileUnderDose = g.underDose ?? 'allowed';
  const dbUnderDose = row.underDose ?? 'allowed';
  if (fileUnderDose !== dbUnderDose) diffs.push({ field: 'underDose', database: dbUnderDose, file: fileUnderDose });
  if (!sameText(row.notes, g.notes)) diffs.push({ field: 'notes', database: textValue(row.notes), file: textValue(g.notes) });
  return diffs;
}

// ---- reconciling --------------------------------------------------------------------------------

function guidelineCount(m: CatalogFileMedication): number {
  return m.guidelines.length + m.embodiments.reduce((n, e) => n + e.guidelines.length, 0);
}

export function reconcileCatalog(file: CatalogFile, state: CatalogState): Reconciliation {
  const rec: Reconciliation = {
    newMedications: [],
    newEmbodiments: [],
    newGuidelines: [],
    present: [],
    ops: new Map(),
    coveredBy: new Map(),
  };

  for (const m of file.medications) {
    const medId = medicationSelectionId(m);
    // First match wins. Names are unique case-insensitively through the API, so more than one can
    // exist only in a database written before that check — still never a reason to add a third.
    const medRow = state.medications.find((r) => normalizeName(r.name) === normalizeName(m.name));

    if (!medRow) {
      rec.newMedications.push({
        selectionId: medId,
        name: m.name,
        brandNames: m.brandNames,
        tags: m.tags,
        embodimentLabels: m.embodiments.map((e) => e.label),
        guidelineCount: guidelineCount(m),
      });
      rec.ops.set(medId, { kind: 'medication', med: m });
      for (const e of m.embodiments) {
        rec.coveredBy.set(embodimentSelectionId(m, e), medId);
        for (const g of e.guidelines) rec.coveredBy.set(guidelineSelectionId(m, e, g), medId);
      }
      for (const g of m.guidelines) rec.coveredBy.set(guidelineSelectionId(m, null, g), medId);
      continue;
    }

    rec.present.push({
      kind: 'medication',
      selectionId: medId,
      id: medRow.id,
      medicationName: medRow.name,
      label: medRow.name,
      differences: medicationDifferences(medRow, m),
    });

    const medEmbodiments = state.embodiments.filter((r) => r.medicationId === medRow.id);
    const medGuidelines = state.guidelines.filter((r) => r.medicationId === medRow.id);

    const reconcileGuidelines = (e: CatalogFileEmbodiment | null, embodimentId: string | null) => {
      for (const g of e ? e.guidelines : m.guidelines) {
        const gId = guidelineSelectionId(m, e, g);
        const gRow = medGuidelines.find(
          (r) =>
            (r.medicationEmbodimentId ?? null) === embodimentId &&
            r.type === g.type &&
            normalizeName(r.source) === normalizeName(g.source),
        );
        if (gRow) {
          rec.present.push({
            kind: 'guideline',
            selectionId: gId,
            id: gRow.id,
            medicationName: medRow.name,
            label: gRow.source,
            differences: guidelineDifferences(gRow, g),
          });
        } else {
          rec.newGuidelines.push({
            selectionId: gId,
            medicationId: medRow.id,
            medicationName: medRow.name,
            embodimentLabel: e ? e.label : null,
            source: g.source,
            type: g.type,
          });
          rec.ops.set(gId, { kind: 'guideline', medicationId: medRow.id, embodimentId, guideline: g });
        }
      }
    };

    for (const e of m.embodiments) {
      const eId = embodimentSelectionId(m, e);
      const eRow = medEmbodiments.find((r) => normalizeName(r.label) === normalizeName(e.label));
      if (!eRow) {
        rec.newEmbodiments.push({
          selectionId: eId,
          medicationId: medRow.id,
          medicationName: medRow.name,
          label: e.label,
          unitType: e.unitType,
          guidelineCount: e.guidelines.length,
        });
        rec.ops.set(eId, { kind: 'embodiment', medicationId: medRow.id, emb: e });
        for (const g of e.guidelines) rec.coveredBy.set(guidelineSelectionId(m, e, g), eId);
        continue;
      }
      rec.present.push({
        kind: 'embodiment',
        selectionId: eId,
        id: eRow.id,
        medicationName: medRow.name,
        label: eRow.label,
        differences: embodimentDifferences(eRow, e),
      });
      reconcileGuidelines(e, eRow.id);
    }
    reconcileGuidelines(null, null);
  }

  return rec;
}

// ---- applying -----------------------------------------------------------------------------------

function embodimentValues(medicationId: string, e: CatalogFileEmbodiment) {
  const hasPair = e.concentrationMg != null && e.concentrationVolumeMl != null;
  return {
    id: randomUUID(),
    medicationId,
    label: e.label,
    concentrationMgPerMl: fileConcentrationMgPerMl(e),
    concentrationMg: hasPair ? e.concentrationMg : null,
    concentrationVolumeMl: hasPair ? e.concentrationVolumeMl : null,
    strengthMgPerUnit: e.strengthMgPerUnit ?? null,
    unitType: e.unitType,
    notes: e.notes ?? null,
    // Cabinet fields are never written: they describe one household's bottle, not the catalog.
  };
}

function guidelineValues(medicationId: string, embodimentId: string | null, g: CatalogFileGuideline) {
  return {
    id: randomUUID(),
    medicationId,
    medicationEmbodimentId: embodimentId,
    source: g.source,
    type: g.type,
    mgPerKg: g.mgPerKg ?? null,
    maxMgPerDose: g.maxMgPerDose ?? null,
    maxMgPerDay: g.maxMgPerDay,
    minIntervalHours: g.minIntervalHours ?? null,
    ageMinMonths: g.ageMinMonths ?? null,
    ageMaxMonths: g.ageMaxMonths ?? null,
    doseMg: g.doseMg ?? null,
    doseMl: g.doseMl ?? null,
    pillCount: g.pillCount ?? null,
    frequencyPerDay: g.frequencyPerDay ?? null,
    underDose: g.underDose ?? 'allowed',
    notes: g.notes ?? null,
  };
}

/**
 * Every row one op writes, computed up front. The SQLite transaction in
 * `DatabaseService.withTransaction` must hold nothing but a straight run of statements (see its
 * header), so ids and values are all decided before it opens.
 */
function rowsFor(op: Op) {
  const meds: any[] = [];
  const embs: any[] = [];
  const guides: any[] = [];
  if (op.kind === 'medication') {
    const medicationId = randomUUID();
    meds.push({
      id: medicationId,
      name: op.med.name,
      brandNames: JSON.stringify(op.med.brandNames),
      description: op.med.description ?? null,
      tags: JSON.stringify(op.med.tags),
      defaultActive: true,
    });
    for (const e of op.med.embodiments) {
      const row = embodimentValues(medicationId, e);
      embs.push(row);
      for (const g of e.guidelines) guides.push(guidelineValues(medicationId, row.id, g));
    }
    for (const g of op.med.guidelines) guides.push(guidelineValues(medicationId, null, g));
  } else if (op.kind === 'embodiment') {
    const row = embodimentValues(op.medicationId, op.emb);
    embs.push(row);
    for (const g of op.emb.guidelines) guides.push(guidelineValues(op.medicationId, row.id, g));
  } else {
    guides.push(guidelineValues(op.medicationId, op.embodimentId, op.guideline));
  }
  return { meds, embs, guides };
}

export type RunInTransaction = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/**
 * Adds each selected item that `rec` still finds missing. `rec` must come from a reconcile run
 * *now*, against the database as it stands, not the one the caregiver previewed: that is what
 * turns "another caregiver added it in the meantime" into a skip instead of a duplicate.
 */
export async function applyCatalogSelection(
  runInTransaction: RunInTransaction,
  rec: Reconciliation,
  select: string[],
): Promise<CatalogSeedApplyResult> {
  const result: CatalogSeedApplyResult = { added: [], skipped: [] };
  const wanted = [...new Set(select)];
  const wantedSet = new Set(wanted);
  const presentIds = new Set(rec.present.map((p) => p.selectionId));

  const toApply: string[] = [];
  for (const id of wanted) {
    if (rec.ops.has(id)) {
      toApply.push(id);
    } else if (rec.coveredBy.has(id)) {
      // Arrives with its parent when the parent was selected too; otherwise there is nothing to
      // attach it to. A grandchild's chain is one hop: coveredBy always names the offered item.
      if (!wantedSet.has(rec.coveredBy.get(id)!)) result.skipped.push({ selectionId: id, reason: 'parent_missing' });
    } else if (presentIds.has(id)) {
      result.skipped.push({ selectionId: id, reason: 'already_present' });
    } else {
      result.skipped.push({ selectionId: id, reason: 'unknown' });
    }
  }

  // Medications first, so a later guideline op never runs ahead of anything it might refer to.
  const order = { medication: 0, embodiment: 1, guideline: 2 } as const;
  toApply.sort((a, b) => order[rec.ops.get(a)!.kind] - order[rec.ops.get(b)!.kind]);

  for (const id of toApply) {
    const { meds, embs, guides } = rowsFor(rec.ops.get(id)!);
    // One transaction per offered item: a failure never leaves a medication with half its forms.
    await runInTransaction(async (tx) => {
      if (meds.length) await tx.insert(medications).values(meds);
      if (embs.length) await tx.insert(medicationEmbodiments).values(embs);
      if (guides.length) await tx.insert(medicationGuidelines).values(guides);
    });
    result.added.push(id);
  }
  return result;
}
