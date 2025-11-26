/**
 * Placeholder integration test plan aligned to app-spec.
 * Replace `test.todo` entries with real supertest flows as endpoints are implemented.
 */
describe('Auth', () => {
  test.todo('register/login with email/password and return unit prefs');
  test.todo('reject invalid credentials');
  test.todo('GET /auth/me returns profile and prefs');
});

describe('Patients & Care Team', () => {
  test.todo('create patient auto-adds creator and self-care link');
  test.todo('list patients for logged-in caregiver');
  test.todo('update patient demographics/notes');
  test.todo('add caregiver to care team and list caregivers');
});

describe('Episodes', () => {
  test.todo('create episode with start event (obs or intervention)');
  test.todo('resolve episode via observation');
  test.todo('resolve episode via intervention');
  test.todo('list active vs resolved episodes');
});

describe('Observations', () => {
  test.todo('create temperature observation with metadata and episode tags');
  test.todo('create weight observation updates latest weight and prompt logic');
  test.todo('create symptom with fixed tags; reject missing metadata');
  test.todo('create photo observation requires fileId');
  test.todo('filter observations by type, episode, date range');
});

describe('Interventions', () => {
  test.todo('create medication dose computes nextAllowedAt and atypical flag');
  test.todo('create dressing change with required fields');
  test.todo('filter interventions by medication/tag, episode, date range');
});

describe('Schedules', () => {
  test.todo('create schedule (med/dressing) with optional episode link');
  test.todo('update schedule status and nextDueAt');
  test.todo('log intervention from schedule with schedule linkage');
});

describe('Medications & Guidelines', () => {
  test.todo('list medications with tags/embodiments');
  test.todo('create weight-based guideline validates required fields');
  test.todo('create age-band guideline validates required fields');
});

describe('Files', () => {
  test.todo('upload file returns fileId; usable in photo observation');
  test.todo('photo observation without fileId is rejected');
});

describe('Timeline & Dashboard', () => {
  test.todo('timeline returns obs+interventions sorted; filters apply');
  test.todo('timeline weight prompt fires when last weight > 60 days');
  test.todo('dashboard shows active episodes, last/next doses, atypical flag, upcoming schedules');
});
