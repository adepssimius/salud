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
      expect(e.dosageForm).toBe('cream');
      expect(e.concentrationMg ?? e.concentrationVolumeMl ?? e.concentrationMgPerMl ?? e.strengthMgPerUnit).toBeUndefined();
    }
  });

  it('accepts a minimal valid file', () => {
    expect(problemsOf({ version: 1, medications: [med()] })).toEqual([]);
  });

  it('takes a dosageForm that agrees with the unitType, and refuses one that does not', () => {
    expect(problemsOf({ version: 2, medications: [med({ embodiments: [cream({ dosageForm: 'cream' })] })] })).toEqual([]);
    const problems = problemsOf({ version: 2, medications: [med({ embodiments: [cream({ dosageForm: 'liquid' })] })] });
    expect(problems.join()).toMatch(/dosageForm "liquid" is counted in "ml", not "other"/);
    expect(problemsOf({ version: 2, medications: [med({ embodiments: [cream({ dosageForm: 'lotion' })] })] }).join()).toMatch(
      /dosageForm/,
    );
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

// The Children's Tylenol label chart (160 mg/5 mL): "under 2 years, ask a doctor", then five age
// rows up to 11 years. The dosing engine compares ages inclusively at both ends
// (`DosingService.resolveGuideline`), so the bands must tile 24–143 months with no month in two
// bands and none in no band.
describe("checked-in Children's Tylenol label chart", () => {
  const file = parseCatalogFile(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const acetaminophen = file.medications.find((m) => m.key === 'acetaminophen')!;
  const suspension = acetaminophen.embodiments.find((e) => e.key === 'suspension-160mg-5ml')!;
  const bands = suspension.guidelines.filter((g) => g.type === 'age_band');
  const bandFor = (months: number) =>
    bands.filter((g) => months >= (g.ageMinMonths as number) && months <= (g.ageMaxMonths as number));

  it('covers 2 through 11 years exactly once per month, and nothing under 2 or from 12', () => {
    expect(bands).toHaveLength(5);
    for (let months = 0; months < 200; months++) {
      expect([months, bandFor(months).length]).toEqual([months, months >= 24 && months <= 143 ? 1 : 0]);
    }
  });

  it('a 7-year-old resolves to the 10 mL (320 mg) row', () => {
    expect(bandFor(7 * 12)).toEqual([expect.objectContaining({ doseMl: 10, doseMg: 320 })]);
  });

  it('every row is the label concentration, at most 5 doses a day', () => {
    for (const g of bands) {
      expect(g.doseMg).toBeCloseTo((g.doseMl as number) * (160 / 5));
      expect(g.frequencyPerDay).toBe(5);
      expect(g.maxMgPerDay).toBe((g.doseMg as number) * 5);
    }
  });

  // Guideline identity is (embodiment, type, source): one shared source would make the five rows a
  // single guideline to the reconcile. Naming the row in each source keeps them five.
  it('a chart with one shared source fails validation rather than merging its rows', () => {
    const shared = bands.map((g) => ({ ...g, source: 'Manufacturer label' }));
    const problems = problemsOf({
      version: 1,
      medications: [{ ...acetaminophen, embodiments: [{ ...suspension, guidelines: shared }] }],
    });
    expect(problems.filter((p) => /same embodiment, type and source/.test(p))).toHaveLength(4);
  });

  it('reconciles as five separate guidelines against none, some and all of them', () => {
    const med = { id: 'm1', name: 'Acetaminophen', brandNames: null, tags: null };
    const emb = { id: 'e1', medicationId: 'm1', label: suspension.label, unitType: 'ml' };
    const row = (g: (typeof bands)[number]) => ({ ...g, medicationId: 'm1', medicationEmbodimentId: 'e1' });
    const offered = (guidelines: any[]) =>
      reconcileCatalog(file, { medications: [med], embodiments: [emb], guidelines })
        .newGuidelines.filter((g) => g.selectionId.startsWith('acetaminophen/suspension-160mg-5ml/label-'))
        .map((g) => g.selectionId);

    expect(offered([])).toHaveLength(5);
    expect(offered([row(bands[0]), row(bands[2])])).toEqual([
      'acetaminophen/suspension-160mg-5ml/label-age-band-48-71mo',
      'acetaminophen/suspension-160mg-5ml/label-age-band-108-131mo',
      'acetaminophen/suspension-160mg-5ml/label-age-band-132-143mo',
    ]);
    expect(offered(bands.map(row))).toEqual([]);
  });
});

// Same inclusive-at-both-ends rule as above, for the other two label charts in the file.
describe('checked-in diphenhydramine and dextromethorphan label charts', () => {
  const file = parseCatalogFile(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const bandsOf = (medKey: string) => {
    const [form] = file.medications.find((m) => m.key === medKey)!.embodiments;
    return form.guidelines.filter((g) => g.type === 'age_band');
  };
  const bandFor = (medKey: string, months: number) =>
    bandsOf(medKey).filter((g) => months >= (g.ageMinMonths as number) && months <= (g.ageMaxMonths as number));

  it('diphenhydramine: 6–11 years only, the top of the 5–10 mL range, smaller doses allowed', () => {
    expect(bandFor('diphenhydramine', 7 * 12)).toEqual([
      expect.objectContaining({ doseMg: 25, doseMl: 10, frequencyPerDay: 6, maxMgPerDay: 150, underDose: 'allowed' }),
    ]);
    expect(bandFor('diphenhydramine', 4 * 12)).toEqual([]);
    expect(bandFor('diphenhydramine', 12 * 12)).toEqual([]);
  });

  it('dextromethorphan: 1 tablet at 6–11, 2 tablets from 12, nothing under 6', () => {
    expect(bandFor('dextromethorphan', 7 * 12)).toEqual([
      expect.objectContaining({ doseMg: 10, pillCount: 1, frequencyPerDay: 6, maxMgPerDay: 60 }),
    ]);
    expect(bandFor('dextromethorphan', 13 * 12)).toEqual([
      expect.objectContaining({ doseMg: 20, pillCount: 2, frequencyPerDay: 6, maxMgPerDay: 120 }),
    ]);
    expect(bandFor('dextromethorphan', 4 * 12)).toEqual([]);
    for (let months = 0; months <= 1500; months++) {
      expect([months, bandFor('dextromethorphan', months).length]).toEqual([months, months >= 72 ? 1 : 0]);
    }
  });
});
