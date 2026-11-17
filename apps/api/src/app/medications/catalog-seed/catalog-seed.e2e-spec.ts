import { INestApplication } from '@nestjs/common';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import request from 'supertest';
import { createTestApp } from '../../../testing/create-test-app';

// "Check repo catalog" (api.md → "Repo catalog"), end to end on whichever dialect TEST_DB selects.
// CATALOG_SEED_URL points at a fixture written per test via a file: URL — the same code path a
// self-hoster without outbound internet uses, and no network in CI. The service reads the variable
// per request, so a test can repoint or rewrite it between preview and apply.

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-catalog-seed-'));
const fixturePath = path.join(fixtureDir, 'medication-catalog.json');
const fixtureUrl = pathToFileURL(fixturePath).href;

function writeCatalog(medications: unknown[], version = 1) {
  fs.writeFileSync(fixturePath, JSON.stringify({ version, medications }, null, 2));
}

const CREAMS = [
  {
    key: 'miconazole',
    name: 'Miconazole',
    tags: ['antifungal'],
    embodiments: [
      { key: 'vaginal-cream-4pct-25g', label: '4% vaginal cream (25 g tube)', unitType: 'other', notes: 'Three nights.' },
    ],
  },
  {
    key: 'clotrimazole',
    name: 'Clotrimazole',
    tags: ['antifungal'],
    embodiments: [
      {
        key: 'cream-1pct-28g',
        label: '1% cream (28.4 g tube)',
        unitType: 'other',
        dosageForm: 'cream',
        notes: 'Thin layer twice daily.',
        guidelines: [
          { key: 'label', source: 'Package label', type: 'weight_based', mgPerKg: 1, maxMgPerDose: 10, maxMgPerDay: 20, minIntervalHours: 12 },
        ],
      },
    ],
  },
];

describe('Repo catalog / catalog seed (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const preview = () => auth(http().post('/api/medications/catalog-seed/preview'));
  const apply = (body: unknown) => auth(http().post('/api/medications/catalog-seed/apply')).send(body);
  const medications = async () => (await auth(http().get('/api/medications')).expect(200)).body as any[];
  const byName = async (name: string) => (await medications()).filter((m) => m.name.trim().toLowerCase() === name.toLowerCase());

  beforeAll(async () => {
    writeCatalog(CREAMS);
    ({ app, close } = await createTestApp('catalog-seed', { env: { CATALOG_SEED_URL: fixtureUrl } }));
    const reg = await http()
      .post('/api/auth/register')
      .send({ email: `seed-${Date.now()}@example.com`, password: 'password123', displayName: 'Seed User' });
    token = reg.body.token;
  });

  beforeEach(() => {
    process.env.CATALOG_SEED_URL = fixtureUrl;
    writeCatalog(CREAMS);
  });

  afterAll(async () => {
    await close();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('requires authentication', async () => {
    await http().post('/api/medications/catalog-seed/preview').expect(401);
    await http().post('/api/medications/catalog-seed/apply').send({ sourceHash: 'a'.repeat(64), select: [] }).expect(401);
  });

  it('previews without writing anything', async () => {
    const res = await preview().expect(200);
    expect(res.body.sourceUrl).toBe(fixtureUrl);
    expect(res.body.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.newMedications.map((m: any) => m.selectionId).sort()).toEqual(['clotrimazole', 'miconazole']);
    expect(res.body.present).toEqual([]);
    // Twice, to be sure: a preview is a read.
    await preview().expect(200);
    expect(await medications()).toEqual([]);
  });

  it('applies the selection once: a medication whole, with its forms and guidelines, never twice', async () => {
    const pre = (await preview().expect(200)).body;
    const res = await apply({ sourceHash: pre.sourceHash, select: ['clotrimazole'] }).expect(200);
    expect(res.body).toEqual({ added: ['clotrimazole'], skipped: [] });

    const [clotrimazole] = await byName('clotrimazole');
    expect(clotrimazole.tags).toEqual(['antifungal']);
    const forms = (await auth(http().get(`/api/medications/${clotrimazole.id}/embodiments`)).expect(200)).body;
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({
      label: '1% cream (28.4 g tube)',
      unitType: 'other',
      dosageForm: 'cream', // the file's form arrives with the row (data-model.md → MedicationEmbodiment)
      concentrationMgPerMl: null,
      strengthMgPerUnit: null,
      notes: 'Thin layer twice daily.',
      // Cabinet fields are never seeded.
      atHome: false,
      expiresAt: null,
      runningLow: false,
    });
    const guidelines = (await auth(http().get(`/api/medications/${clotrimazole.id}/guidelines`)).expect(200)).body;
    expect(guidelines).toHaveLength(1);
    expect(guidelines[0].medicationEmbodimentId).toBe(forms[0].id);

    // Applying the same preview again adds nothing: everything it names is now present.
    const again = await apply({ sourceHash: pre.sourceHash, select: ['clotrimazole', 'clotrimazole/cream-1pct-28g'] }).expect(200);
    expect(again.body.added).toEqual([]);
    expect(again.body.skipped).toEqual([
      { selectionId: 'clotrimazole', reason: 'already_present' },
      { selectionId: 'clotrimazole/cream-1pct-28g', reason: 'already_present' },
    ]);
    expect(await byName('clotrimazole')).toHaveLength(1);

    const after = (await preview().expect(200)).body;
    expect(after.newMedications.map((m: any) => m.selectionId)).toEqual(['miconazole']);
    expect(after.present.map((p: any) => p.selectionId)).toEqual([
      'clotrimazole',
      'clotrimazole/cream-1pct-28g',
      'clotrimazole/cream-1pct-28g/label',
    ]);
    expect(after.present.every((p: any) => p.differences.length === 0)).toBe(true);
  });

  it('never overwrites a caregiver edit; reports it as a difference instead', async () => {
    const [clotrimazole] = await byName('clotrimazole');
    const [form] = (await auth(http().get(`/api/medications/${clotrimazole.id}/embodiments`)).expect(200)).body;
    await auth(http().patch(`/api/medications/${clotrimazole.id}`)).send({ tags: ['antifungal', 'topical'] }).expect(200);
    await auth(http().patch(`/api/embodiments/${form.id}`)).send({ notes: 'Our tube — see pharmacist note.' }).expect(200);

    const pre = (await preview().expect(200)).body;
    const medItem = pre.present.find((p: any) => p.selectionId === 'clotrimazole');
    expect(medItem.differences).toEqual([{ field: 'tags', database: ['antifungal', 'topical'], file: ['antifungal'] }]);
    const formItem = pre.present.find((p: any) => p.selectionId === 'clotrimazole/cream-1pct-28g');
    expect(formItem.differences).toEqual([
      { field: 'notes', database: 'Our tube — see pharmacist note.', file: 'Thin layer twice daily.' },
    ]);

    await apply({ sourceHash: pre.sourceHash, select: ['clotrimazole', 'clotrimazole/cream-1pct-28g'] }).expect(200);
    const [still] = await byName('clotrimazole');
    expect(still.tags).toEqual(['antifungal', 'topical']);
    const [stillForm] = (await auth(http().get(`/api/medications/${clotrimazole.id}/embodiments`)).expect(200)).body;
    expect(stillForm.notes).toBe('Our tube — see pharmacist note.');
  });

  it('does not re-create a deleted medication by itself; it is offered again and added only when confirmed', async () => {
    // Apply miconazole, then delete it the way a caregiver would: form first, then the medication.
    let pre = (await preview().expect(200)).body;
    await apply({ sourceHash: pre.sourceHash, select: ['miconazole'] }).expect(200);
    const [miconazole] = await byName('miconazole');
    const [form] = (await auth(http().get(`/api/medications/${miconazole.id}/embodiments`)).expect(200)).body;
    await auth(http().delete(`/api/embodiments/${form.id}`)).expect(200);
    await auth(http().delete(`/api/medications/${miconazole.id}`)).expect(200);

    // Previewing (and applying an unrelated selection) leaves it deleted.
    pre = (await preview().expect(200)).body;
    expect(pre.newMedications.map((m: any) => m.selectionId)).toEqual(['miconazole']);
    await apply({ sourceHash: pre.sourceHash, select: [] }).expect(200);
    expect(await byName('miconazole')).toEqual([]);

    // Only an explicit selection brings it back.
    await apply({ sourceHash: pre.sourceHash, select: ['miconazole'] }).expect(200);
    expect(await byName('miconazole')).toHaveLength(1);
  });

  it('matches a medication the household already has under another casing, offering only its missing forms', async () => {
    writeCatalog([
      {
        key: 'ketoconazole',
        name: 'Ketoconazole',
        embodiments: [
          { key: 'cream', label: '2% cream', unitType: 'other' },
          { key: 'shampoo', label: '2% shampoo', unitType: 'other' },
        ],
      },
    ]);
    const created = await auth(http().post('/api/medications')).send({ name: '  KETOCONAZOLE' }).expect(201);
    await auth(http().post(`/api/medications/${created.body.id}/embodiments`)).send({ label: '2% CREAM', unitType: 'other' }).expect(201);

    const pre = (await preview().expect(200)).body;
    expect(pre.newMedications).toEqual([]);
    expect(pre.newEmbodiments.map((e: any) => e.selectionId)).toEqual(['ketoconazole/shampoo']);
    expect(pre.present.find((p: any) => p.selectionId === 'ketoconazole').id).toBe(created.body.id);

    const res = await apply({ sourceHash: pre.sourceHash, select: ['ketoconazole', 'ketoconazole/shampoo'] }).expect(200);
    expect(res.body.added).toEqual(['ketoconazole/shampoo']);
    expect(res.body.skipped).toEqual([{ selectionId: 'ketoconazole', reason: 'already_present' }]);
    expect(await byName('ketoconazole')).toHaveLength(1);
    const forms = (await auth(http().get(`/api/medications/${created.body.id}/embodiments`)).expect(200)).body;
    expect(forms.map((f: any) => f.label).sort()).toEqual(['2% CREAM', '2% shampoo']);
  });

  it('skips a child selected without its new parent, and selection ids it does not know', async () => {
    writeCatalog([
      {
        key: 'terbinafine',
        name: 'Terbinafine',
        embodiments: [{ key: 'cream', label: '1% cream', unitType: 'other' }],
      },
    ]);
    const pre = (await preview().expect(200)).body;
    const res = await apply({ sourceHash: pre.sourceHash, select: ['terbinafine/cream', 'nope'] }).expect(200);
    expect(res.body).toEqual({
      added: [],
      skipped: [
        { selectionId: 'terbinafine/cream', reason: 'parent_missing' },
        { selectionId: 'nope', reason: 'unknown' },
      ],
    });
    expect(await byName('terbinafine')).toEqual([]);
  });

  it('refuses to apply when the file changed since the preview', async () => {
    const pre = (await preview().expect(200)).body;
    writeCatalog([...CREAMS, { key: 'nystatin', name: 'Nystatin', embodiments: [{ key: 'cream', label: 'cream', unitType: 'other' }] }]);
    const res = await apply({ sourceHash: pre.sourceHash, select: ['nystatin'] }).expect(409);
    expect(res.body.message).toBe('CATALOG_SEED_CHANGED');
    expect(await byName('nystatin')).toEqual([]);
  });

  it('two concurrent applies of the same preview add each medication once (one process)', async () => {
    writeCatalog([{ key: 'tolnaftate', name: 'Tolnaftate', embodiments: [{ key: 'cream', label: '1% cream', unitType: 'other' }] }]);
    const pre = (await preview().expect(200)).body;
    const body = { sourceHash: pre.sourceHash, select: ['tolnaftate'] };
    const results = await Promise.all([apply(body), apply(body)]);
    for (const r of results) expect(r.status).toBe(200);
    // Applies are serialised per process, so the second reconciles after the first has written.
    // Across two pods there is no such guarantee (api.md → "Repo catalog", accepted gap).
    expect(results.map((r) => r.body.added).flat()).toEqual(['tolnaftate']);
    expect(results.map((r) => r.body.skipped).flat()).toEqual([{ selectionId: 'tolnaftate', reason: 'already_present' }]);
    expect(await byName('tolnaftate')).toHaveLength(1);
  });

  it('answers the documented errors for a missing, invalid, too-new or unconfigured source', async () => {
    process.env.CATALOG_SEED_URL = pathToFileURL(path.join(fixtureDir, 'missing.json')).href;
    expect((await preview().expect(502)).body.message).toBe('CATALOG_SEED_UNAVAILABLE');

    process.env.CATALOG_SEED_URL = fixtureUrl;
    fs.writeFileSync(fixturePath, '{ not json');
    expect((await preview().expect(502)).body.message).toBe('CATALOG_SEED_INVALID');

    writeCatalog(CREAMS, 99);
    expect((await preview().expect(502)).body.message).toBe('CATALOG_SEED_INVALID');

    process.env.CATALOG_SEED_URL = '';
    expect((await preview().expect(503)).body.message).toBe('CATALOG_SEED_NOT_CONFIGURED');
    expect((await apply({ sourceHash: 'a'.repeat(64), select: [] }).expect(503)).body.message).toBe('CATALOG_SEED_NOT_CONFIGURED');
  });

  // The checked-in file itself, through the API and the dosing engine: what a caregiver's
  // "Check repo catalog" adds is what the engine then resolves for a child.
  it("adds the checked-in Children's Tylenol chart and gives a 7-year-old the 10 mL row", async () => {
    const checkedIn = path.join(__dirname, '../../../../../../catalog/medication-catalog.json');
    fs.writeFileSync(fixturePath, fs.readFileSync(checkedIn));
    const pre = (await preview().expect(200)).body;
    await apply({ sourceHash: pre.sourceHash, select: ['acetaminophen'] }).expect(200);
    const [acetaminophen] = await byName('acetaminophen');
    const forms = (await auth(http().get(`/api/medications/${acetaminophen.id}/embodiments`)).expect(200)).body;
    const suspension = forms.find((f: any) => f.label === "160 mg/5 mL suspension (Children's Tylenol)");
    const bands = (await auth(http().get(`/api/medications/${acetaminophen.id}/guidelines`)).expect(200)).body.filter(
      (g: any) => g.type === 'age_band' && g.medicationEmbodimentId === suspension.id,
    );
    expect(bands).toHaveLength(5);

    // Removing one band offers back exactly that band; the other four stay present.
    const band = bands.find((g: any) => g.ageMinMonths === 48);
    await auth(http().delete(`/api/guidelines/${band.id}`)).expect(200);
    const again = (await preview().expect(200)).body;
    expect(again.newGuidelines.map((g: any) => g.selectionId)).toEqual(['acetaminophen/suspension-160mg-5ml/label-age-band-48-71mo']);
    await apply({ sourceHash: again.sourceHash, select: ['acetaminophen/suspension-160mg-5ml/label-age-band-48-71mo'] }).expect(200);
    expect((await preview().expect(200)).body.newGuidelines).toEqual([]);

    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 7);
    dob.setMonth(dob.getMonth() - 3); // 87 months: clear of any month-boundary edge
    const patient = await auth(http().post('/api/patients'))
      .send({ fullName: 'Seven', dateOfBirth: dob.toISOString().slice(0, 10), sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    const check = await auth(http().post(`/api/patients/${patient.body.id}/dose-checks`))
      .send({ medicationId: acetaminophen.id, medicationEmbodimentId: suspension.id })
      .expect(201);
    expect(check.body.guidance.ageBand).toMatchObject({
      source: "Manufacturer label — Children's Tylenol dosing chart, 6–8 years (48–59 lb)",
      doseMg: 320,
      doseMl: 10,
      doseMlSource: 'guideline',
      frequencyPerDay: 5,
      maxMgPerDay: 1600,
    });
  });

  // The other two label charts, through the engine: 7, 13 and 4 years old.
  it('resolves the checked-in diphenhydramine and dextromethorphan charts by age', async () => {
    const checkedIn = path.join(__dirname, '../../../../../../catalog/medication-catalog.json');
    fs.writeFileSync(fixturePath, fs.readFileSync(checkedIn));
    const pre = (await preview().expect(200)).body;
    await apply({ sourceHash: pre.sourceHash, select: ['diphenhydramine', 'dextromethorphan'] }).expect(200);

    const patientAged = async (years: number) => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - years);
      dob.setMonth(dob.getMonth() - 3); // clear of any month-boundary edge
      const res = await auth(http().post('/api/patients'))
        .send({ fullName: `Age ${years}`, dateOfBirth: dob.toISOString().slice(0, 10), sexAtBirth: 'male', myRole: 'parent' })
        .expect(201);
      return res.body.id as string;
    };
    const ageBand = async (patientId: string, medName: string) => {
      const [med] = await byName(medName);
      const [form] = (await auth(http().get(`/api/medications/${med.id}/embodiments`)).expect(200)).body;
      const res = await auth(http().post(`/api/patients/${patientId}/dose-checks`))
        .send({ medicationId: med.id, medicationEmbodimentId: form.id })
        .expect(201);
      return res.body.guidance.ageBand;
    };
    const [seven, thirteen, four] = [await patientAged(7), await patientAged(13), await patientAged(4)];

    expect(await ageBand(seven, 'diphenhydramine')).toMatchObject({ doseMg: 25, doseMl: 10, frequencyPerDay: 6 });
    expect(await ageBand(four, 'diphenhydramine')).toBeNull();
    expect(await ageBand(seven, 'dextromethorphan')).toMatchObject({ doseMg: 10, pillCount: 1, maxMgPerDay: 60 });
    expect(await ageBand(thirteen, 'dextromethorphan')).toMatchObject({ doseMg: 20, pillCount: 2, maxMgPerDay: 120 });
    expect(await ageBand(four, 'dextromethorphan')).toBeNull();
  });

  it('validates the apply body', async () => {
    await apply({ sourceHash: 'short', select: [] }).expect(400);
    await apply({ sourceHash: 'a'.repeat(64), select: 'miconazole' }).expect(400);
  });
});
