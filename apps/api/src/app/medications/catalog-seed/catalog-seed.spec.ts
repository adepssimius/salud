import fs from 'fs';
import path from 'path';
import { CATALOG_FILE_VERSION, CatalogFileError, parseCatalogFile } from './catalog-file';
import { reconcileCatalog } from './catalog-reconcile';

// The checked-in file is what every instance's "Check repo catalog" fetches from main. Parsing it
// here is the CI gate development.md promises: a malformed entry fails the build before it can
// reach main, instead of 502ing for every caregiver who clicks the button.
const CATALOG_PATH = path.join(__dirname, '../../../../../../catalog/medication-catalog.json');

function problemsOf(file: unknown): string[] {
  try {
    parseCatalogFile(JSON.stringify(file));
  } catch (err) {
    if (err instanceof CatalogFileError) return err.problems;
    throw err;
  }
  return [];
}

const cream = (overrides: Record<string, unknown> = {}) => ({
  key: 'cream',
  label: '1% cream',
  unitType: 'other',
  ...overrides,
});

const med = (overrides: Record<string, unknown> = {}) => ({
  key: 'clotrimazole',
  name: 'Clotrimazole',
  embodiments: [cream()],
  ...overrides,
});

describe('repo catalog file', () => {
  it('the checked-in catalog/medication-catalog.json is valid', () => {
    const file = parseCatalogFile(fs.readFileSync(CATALOG_PATH, 'utf8'));
    expect(file.version).toBeLessThanOrEqual(CATALOG_FILE_VERSION);
    const names = file.medications.map((m) => m.name.toLowerCase());
    expect(names).toEqual(expect.arrayContaining(['acetaminophen', 'ibuprofen', 'miconazole', 'clotrimazole']));
  });

  it('ships the two creams as unit type other with no concentration or strength', () => {
    const file = parseCatalogFile(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const forms = file.medications
      .filter((m) => ['miconazole', 'clotrimazole'].includes(m.name.toLowerCase()))
      .flatMap((m) => m.embodiments);
    expect(forms.map((e) => e.label).sort()).toEqual(['1% cream (28.4 g tube)', '4% vaginal cream (25 g tube)']);
    for (const e of forms) {
      expect(e.unitType).toBe('other');
      expect(e.concentrationMg ?? e.concentrationVolumeMl ?? e.concentrationMgPerMl ?? e.strengthMgPerUnit).toBeUndefined();
    }
  });

  it('accepts a minimal valid file', () => {
    expect(problemsOf({ version: 1, medications: [med()] })).toEqual([]);
  });

  it('refuses a version newer than this build', () => {
    expect(problemsOf({ version: CATALOG_FILE_VERSION + 1, medications: [] })[0]).toMatch(/newer than this build/);
  });

  it('refuses invalid JSON', () => {
    expect(() => parseCatalogFile('{ nope')).toThrow(CatalogFileError);
  });

  it('refuses cabinet fields — they describe one household’s bottle', () => {
    const problems = problemsOf({ version: 1, medications: [med({ embodiments: [cream({ atHome: true })] })] });
    expect(problems.join()).toMatch(/unknown field "atHome"/);
  });

  it('refuses duplicate keys and case-insensitively duplicate names', () => {
    const problems = problemsOf({
      version: 1,
      medications: [med(), med({ name: 'CLOTRIMAZOLE ' })],
    });
    expect(problems.join()).toMatch(/duplicate key "clotrimazole"/);
    expect(problems.join()).toMatch(/another medication has the name/);
  });

  it('refuses keys that are not lower-kebab-case', () => {
    expect(problemsOf({ version: 1, medications: [med({ key: 'Clotrimazole' })] }).join()).toMatch(/lower-kebab-case/);
  });

  it('applies the API create rules: unit type, concentration both ways, inverted age band', () => {
    const problems = problemsOf({
      version: 1,
      medications: [
        med({
          embodiments: [
            cream({ unitType: 'tube' }),
            cream({ key: 'syrup', label: 'syrup', unitType: 'ml', concentrationMgPerMl: 32, concentrationMg: 160, concentrationVolumeMl: 5 }),
            cream({ key: 'half', label: 'half', unitType: 'ml', concentrationMg: 160 }),
            cream({
              key: 'drops',
              label: 'drops',
              unitType: 'drop',
              guidelines: [
                { key: 'band', source: 'Label', type: 'age_band', ageMinMonths: 24, ageMaxMonths: 12, doseMg: 1, frequencyPerDay: 1, maxMgPerDay: 4 },
              ],
            }),
          ],
        }),
      ],
    }).join('\n');
    expect(problems).toMatch(/embodiments\[0\]\.unitType/);
    expect(problems).toMatch(/embodiments\[1\]: give the concentration pair or concentrationMgPerMl, not both/);
    expect(problems).toMatch(/embodiments\[2\]: concentrationMg and concentrationVolumeMl go together/);
    expect(problems).toMatch(/GUIDELINE_AGE_RANGE_INVALID/);
  });
});

describe('reconcileCatalog', () => {
  const file = parseCatalogFile(
    JSON.stringify({
      version: 1,
      medications: [
        med({
          embodiments: [
            cream({
              guidelines: [{ key: 'w', source: 'Ref', type: 'weight_based', mgPerKg: 1, maxMgPerDose: 2, maxMgPerDay: 3, minIntervalHours: 4 }],
            }),
            cream({ key: 'big', label: '1% cream (big tube)' }),
          ],
        }),
      ],
    }),
  );

  it('offers a missing medication whole, its children covered by it', () => {
    const rec = reconcileCatalog(file, { medications: [], embodiments: [], guidelines: [] });
    expect(rec.newMedications.map((m) => m.selectionId)).toEqual(['clotrimazole']);
    expect(rec.newMedications[0].guidelineCount).toBe(1);
    expect(rec.newEmbodiments).toEqual([]);
    expect(rec.coveredBy.get('clotrimazole/cream')).toBe('clotrimazole');
    expect(rec.coveredBy.get('clotrimazole/cream/w')).toBe('clotrimazole');
  });

  it('matches name and label case-insensitively, offers only what is missing, and reports differences', () => {
    const rec = reconcileCatalog(file, {
      medications: [{ id: 'm1', name: '  CLOTRIMAZOLE', description: 'mine', brandNames: null, tags: null }],
      embodiments: [{ id: 'e1', medicationId: 'm1', label: '1% CREAM', unitType: 'other', notes: 'edited' }],
      guidelines: [],
    });
    expect(rec.newMedications).toEqual([]);
    expect(rec.newEmbodiments.map((e) => e.selectionId)).toEqual(['clotrimazole/big']);
    expect(rec.newGuidelines.map((g) => g.selectionId)).toEqual(['clotrimazole/cream/w']);
    const medItem = rec.present.find((p) => p.kind === 'medication')!;
    expect(medItem.differences).toEqual([{ field: 'description', database: 'mine', file: null }]);
    const embItem = rec.present.find((p) => p.kind === 'embodiment')!;
    expect(embItem.id).toBe('e1');
    expect(embItem.differences).toEqual([{ field: 'notes', database: 'edited', file: null }]);
  });
});
