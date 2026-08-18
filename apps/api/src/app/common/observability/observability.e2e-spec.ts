import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../../testing/create-test-app';
import { applyAppObservability } from '../../app.observability';
import { ValidationPipe } from '@nestjs/common';

/**
 * The regression guard for the gap this module was written to close: a deliberately thrown
 * HttpException produced NO server-side log at all, because `BaseExceptionFilter` returns early
 * for HttpExceptions and only logs inside its unknown-error branch. Every assertion below is a
 * status the frontend renders a sentence for.
 */
describe('Observability (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let patientId: string;
  let lines: Array<{ level: string; message: string }>;

  const captureLogs = () => {
    lines = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(function (this: any, message: any) {
        // Only the HTTP access logger; Nest's own boot chatter would drown the assertions.
        if (this?.context === 'HTTP') lines.push({ level, message: String(message) });
      });
    }
  };

  const httpLines = () => lines.map((l) => l.message);
  const lineFor = (fragment: string) => lines.find((l) => l.message.includes(fragment));

  beforeAll(async () => {
    ({ app, close } = await createTestApp('observability', {
      configureApp: (app) => {
        applyAppObservability(app as any);
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      },
    }));

    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'observability@example.com',
        password: 'password123',
        displayName: 'Obs Tester',
      })
      .expect(201);
    token = register.body.token;

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Log Kid', dateOfBirth: '2019-04-01', sexAtBirth: 'female' })
      .expect(201);
    patientId = patient.body.id;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(() => captureLogs());
  afterEach(() => jest.restoreAllMocks());

  it('logs a 404 with its error code — previously logged nothing at all', async () => {
    await request(app.getHttpServer())
      .get('/api/patients/00000000-0000-4000-8000-000000000000/timeline')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    const line = lineFor('404');
    expect(line).toBeDefined();
    expect(line!.message).toContain('code=PATIENT_NOT_FOUND');
    expect(line!.message).toContain('GET /api/patients/00000000-0000-4000-8000-000000000000/timeline');
    expect(line!.level).toBe('warn');
  });

  it('logs a 400 validation failure with the offending code', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observedAt: new Date().toISOString(), entries: [] })
      .expect(400);

    const line = lineFor('400');
    expect(line).toBeDefined();
    expect(line!.message).toContain('code=AT_LEAST_ONE_ENTRY_REQUIRED');
    expect(line!.level).toBe('warn');
  });

  it('logs a 401 from the auth guard', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', 'Bearer garbage')
      .expect(401);

    const line = lineFor('401');
    expect(line).toBeDefined();
    expect(line!.level).toBe('warn');
  });

  it('logs an unmatched route, which no Nest interceptor would ever see', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboards')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(lineFor('GET /api/dashboards 404')).toBeDefined();
  });

  it('logs a successful request with the caller identified', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const line = lineFor('GET /api/dashboard 200');
    expect(line).toBeDefined();
    expect(line!.message).toMatch(/user=[0-9a-f-]{36}/);
    expect(line!.level).toBe('log');
  });

  it('records query parameter names but never their values', async () => {
    await request(app.getHttpServer())
      .get('/api/users/search')
      .query({ email: 'observability@example.com' })
      .set('Authorization', `Bearer ${token}`);

    const joined = httpLines().join('\n');
    expect(joined).toContain('/api/users/search?email');
    expect(joined).not.toContain('observability@example.com');
  });

  it('never logs a password, even on the request that carries one', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'observability@example.com', password: 'password123' })
      .expect(201);

    const joined = httpLines().join('\n');
    expect(joined).toContain('POST /api/auth/login 201');
    expect(joined).not.toContain('password123');
  });

  it('does not log successful health probes', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(httpLines()).toHaveLength(0);
  });

  it('leaves the response body exactly as the frontend expects it', async () => {
    // error-display.ts parses this shape; the filter must be observation-only.
    const res = await request(app.getHttpServer())
      .get('/api/patients/00000000-0000-4000-8000-000000000000/timeline')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, message: 'PATIENT_NOT_FOUND' });
  });
});
