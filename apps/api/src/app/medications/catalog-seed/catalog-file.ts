import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import type { GuidelineType, MedicationUnitType } from '@salud/shared/types';
import { CreateMedicationDto } from '../dto/create-medication.dto';
import { CreateEmbodimentDto } from '../dto/create-embodiment.dto';
import { CreateGuidelineDto } from '../dto/create-guideline.dto';

/**
 * The repo catalog file, `catalog/medication-catalog.json` (development.md → "The repo catalog
 * file"). Parsed and validated here, by the same DTO classes the catalog's create routes use, so a
 * row the file can describe is exactly a row a caregiver could have typed in.
 *
 * The file is untrusted input even though it comes from our own repo: the API fetches it from
 * `main` at click time, and `main` may be ahead of — or simply different from — the code reading
 * it. Anything this module does not positively recognise is an error, not something to skip.
 */

/** The highest file `version` this build can read. An older image refuses a newer file. */
export const CATALOG_FILE_VERSION = 1;

export interface CatalogFileGuideline {
  key: string;
  source: string;
  type: GuidelineType;
  mgPerKg?: number;
  maxMgPerDose?: number;
  maxMgPerDay: number;
  minIntervalHours?: number;
  ageMinMonths?: number;
  ageMaxMonths?: number;
  doseMg?: number;
  doseMl?: number;
  pillCount?: number;
  frequencyPerDay?: number;
  notes?: string;
}

export interface CatalogFileEmbodiment {
  key: string;
  label: string;
  unitType: MedicationUnitType;
  concentrationMg?: number;
  concentrationVolumeMl?: number;
  concentrationMgPerMl?: number;
  strengthMgPerUnit?: number;
  notes?: string;
  guidelines: CatalogFileGuideline[];
}

export interface CatalogFileMedication {
  key: string;
  name: string;
  brandNames: string[];
  description?: string;
  tags: string[];
  embodiments: CatalogFileEmbodiment[];
  // Medication-wide guidelines: no embodiment, so they apply across all of them.
  guidelines: CatalogFileGuideline[];
}

export interface CatalogFile {
  version: number;
  medications: CatalogFileMedication[];
}

export class CatalogFileError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid catalog file: ${problems.slice(0, 10).join('; ')}`);
    this.name = 'CatalogFileError';
  }
}

const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Allowed keys per level. Rejecting anything else is how "no cabinet fields in the file" is
// enforced: an `atHome` or `expiresAt` here describes one household's bottle, and silently
// dropping it would hide the mistake from whoever wrote the entry.
const MEDICATION_KEYS = ['key', 'name', 'brandNames', 'description', 'tags', 'embodiments', 'guidelines'];
const EMBODIMENT_KEYS = [
  'key',
  'label',
  'unitType',
  'concentrationMg',
  'concentrationVolumeMl',
  'concentrationMgPerMl',
  'strengthMgPerUnit',
  'notes',
  'guidelines',
];
const GUIDELINE_KEYS = [
  'key',
  'source',
  'type',
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
];

/** Trimmed, lower-cased — the catalog's identity comparison (api.md → `MEDICATION_NAME_TAKEN`). */
export function normalizeName(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenErrors(errors: ValidationError[], prefix: string): string[] {
  const out: string[] = [];
  for (const e of errors) {
    for (const message of Object.values(e.constraints ?? {})) {
      out.push(`${prefix}.${e.property}: ${message}`);
    }
    if (e.children?.length) out.push(...flattenErrors(e.children, `${prefix}.${e.property}`));
  }
  return out;
}

function checkKeys(obj: Record<string, unknown>, allowed: string[], where: string, problems: string[]) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) problems.push(`${where}: unknown field "${k}"`);
  }
}

function checkKey(value: unknown, where: string, seen: Set<string>, problems: string[]): string {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    problems.push(`${where}.key: must be lower-kebab-case`);
    return '';
  }
  if (seen.has(value)) problems.push(`${where}.key: duplicate key "${value}"`);
  seen.add(value);
  return value;
}

/** Runs one of the create DTOs over the fields it owns, collecting its messages. */
function validateDto<T extends object>(cls: new () => T, plain: Record<string, unknown>, where: string, problems: string[]) {
  const instance = plainToInstance(cls, plain);
  // forbidUnknownValues off: unknown keys were already reported by checkKeys, with a better message.
  problems.push(...flattenErrors(validateSync(instance, { forbidUnknownValues: false }), where));
}

function pick(obj: Record<string, unknown>, omit: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !omit.includes(k)));
}

function parseGuidelines(
  raw: unknown,
  where: string,
  problems: string[],
  identities: Set<string>,
  embodimentLabel: string,
): CatalogFileGuideline[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${where}.guidelines: must be an array`);
    return [];
  }
  const seen = new Set<string>();
  return raw.flatMap((g, i) => {
    const at = `${where}.guidelines[${i}]`;
    if (!isPlainObject(g)) {
      problems.push(`${at}: must be an object`);
      return [];
    }
    checkKeys(g, GUIDELINE_KEYS, at, problems);
    checkKey(g.key, at, seen, problems);
    validateDto(CreateGuidelineDto, pick(g, ['key']), at, problems);
    // The match identity (api.md → Repo catalog): two guidelines sharing it would both match the
    // same database row, and the preview could not say which one was "present".
    const identity = `${embodimentLabel}|${String(g.type)}|${normalizeName(g.source as string)}`;
    if (identities.has(identity)) problems.push(`${at}: another guideline has the same embodiment, type and source`);
    identities.add(identity);
    return [g as unknown as CatalogFileGuideline];
  });
}

function checkConcentration(e: Record<string, unknown>, at: string, problems: string[]) {
  const hasPerMl = e.concentrationMgPerMl !== undefined;
  const hasMg = e.concentrationMg !== undefined;
  const hasMl = e.concentrationVolumeMl !== undefined;
  // Same three rules the embodiments service applies (api.md → "Concentration: the label pair vs.
  // mg/mL"), as file errors instead of 400s.
  if (hasPerMl && (hasMg || hasMl)) problems.push(`${at}: give the concentration pair or concentrationMgPerMl, not both`);
  if (hasMg !== hasMl) problems.push(`${at}: concentrationMg and concentrationVolumeMl go together`);
  if (hasMg && hasMl && typeof e.concentrationMg === 'number' && typeof e.concentrationVolumeMl === 'number') {
    const derived = e.concentrationMg / e.concentrationVolumeMl;
    if (!Number.isFinite(derived) || derived < 0.001 || derived > 10000) {
      problems.push(`${at}: derived concentration is outside 0.001–10000 mg/mL`);
    }
  }
}

/** Parses and validates the file's text. Throws `CatalogFileError` listing every problem found. */
export function parseCatalogFile(text: string): CatalogFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new CatalogFileError([`not valid JSON: ${(err as Error).message}`]);
  }
  if (!isPlainObject(raw)) throw new CatalogFileError(['top level must be an object']);

  const problems: string[] = [];
  checkKeys(raw, ['version', 'medications'], 'file', problems);
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) {
    problems.push('version: must be a positive integer');
  } else if ((raw.version as number) > CATALOG_FILE_VERSION) {
    // Fatal on its own: a newer shape may mean something this code would misread.
    throw new CatalogFileError([
      `version ${raw.version} is newer than this build understands (${CATALOG_FILE_VERSION})`,
    ]);
  }
  if (!Array.isArray(raw.medications)) {
    problems.push('medications: must be an array');
    throw new CatalogFileError(problems);
  }

  const medKeys = new Set<string>();
  const medNames = new Set<string>();
  const medications: CatalogFileMedication[] = raw.medications.flatMap((m, i) => {
    const at = `medications[${i}]`;
    if (!isPlainObject(m)) {
      problems.push(`${at}: must be an object`);
      return [];
    }
    checkKeys(m, MEDICATION_KEYS, at, problems);
    checkKey(m.key, at, medKeys, problems);
    validateDto(CreateMedicationDto, pick(m, ['key', 'embodiments', 'guidelines']), at, problems);
    const name = normalizeName(m.name as string);
    if (name && medNames.has(name)) problems.push(`${at}.name: another medication has the name "${m.name}"`);
    medNames.add(name);

    const identities = new Set<string>();
    const embKeys = new Set<string>();
    const labels = new Set<string>();
    let embodiments: CatalogFileEmbodiment[] = [];
    if (!Array.isArray(m.embodiments)) {
      problems.push(`${at}.embodiments: must be an array`);
    } else {
      embodiments = m.embodiments.flatMap((e, j) => {
        const eat = `${at}.embodiments[${j}]`;
        if (!isPlainObject(e)) {
          problems.push(`${eat}: must be an object`);
          return [];
        }
        checkKeys(e, EMBODIMENT_KEYS, eat, problems);
        checkKey(e.key, eat, embKeys, problems);
        validateDto(CreateEmbodimentDto, pick(e, ['key', 'guidelines']), eat, problems);
        checkConcentration(e, eat, problems);
        const label = normalizeName(e.label as string);
        if (label && labels.has(label)) problems.push(`${eat}.label: another form of this medication has the label "${e.label}"`);
        labels.add(label);
        const guidelines = parseGuidelines(e.guidelines, eat, problems, identities, label);
        return [{ ...(e as unknown as CatalogFileEmbodiment), guidelines }];
      });
    }

    // Medication-wide guideline keys share a namespace with nothing else: their selectionId is
    // `<med>//<key>`, distinct from any `<med>/<emb>/<key>`.
    const guidelines = parseGuidelines(m.guidelines, at, problems, identities, '');
    return [
      {
        key: m.key as string,
        name: m.name as string,
        brandNames: (m.brandNames as string[] | undefined) ?? [],
        description: m.description as string | undefined,
        tags: (m.tags as string[] | undefined) ?? [],
        embodiments,
        guidelines,
      },
    ];
  });

  if (problems.length) throw new CatalogFileError(problems);
  return { version: raw.version as number, medications };
}
