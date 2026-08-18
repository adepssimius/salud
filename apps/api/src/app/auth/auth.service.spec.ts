import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { DatabaseService } from '../persistence/database.service';
// The dialect-resolved 'db/schema' — correct here because this test now builds its own raw
// connection to match whatever DB_CLIENT jest-env-setup.ts already set (from TEST_DB) before this
// file's imports ran, the same dialect schema.ts itself resolved against.
import { users } from '../../db/schema';
import { RegisterDto } from './dto/register.dto';

// Unit-level, not e2e: a fabricated claims object and a real temp database -- no HTTP, no
// openid-client, no Authelia. What matters here (security.md → "OIDC login") is entirely covered
// by this: match-by-sub-then-email, linking vs. provisioning, and that identity never duplicates
// or misroutes across repeat logins. Runs against whichever dialect TEST_DB selects (default
// pglite), same as every e2e suite via create-test-app.ts — this file predates that helper and
// has different enough needs (no HTTP layer, no Nest module) that it builds its own connection
// rather than sharing it.
describe('AuthService.loginOrProvisionOidc', () => {
  let tmpDir: string;
  let dbService: DatabaseService;
  let auth: AuthService;
  let closeConnection: () => Promise<void>;

  beforeEach(async () => {
    const dialect = process.env.DB_CLIENT ?? 'pglite';
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-auth-unit-'));

    if (dialect === 'sqlite') {
      const Database = (await import('better-sqlite3')).default;
      const { drizzle } = await import('drizzle-orm/better-sqlite3');
      const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
      const raw = new Database(path.join(tmpDir, 'test.db'));
      const db = drizzle(raw);
      await migrate(db, {
        migrationsFolder: path.join(process.cwd(), 'apps/api/src/db/migrations/sqlite'),
      });
      dbService = new DatabaseService({ client: 'sqlite', db, raw } as any);
      closeConnection = async () => raw.close();
    } else {
      const { PGlite } = await import('@electric-sql/pglite');
      const { drizzle } = await import('drizzle-orm/pglite');
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      const raw = new PGlite(path.join(tmpDir, 'pgdata'));
      const db = drizzle(raw);
      await migrate(db, {
        migrationsFolder: path.join(process.cwd(), 'apps/api/src/db/migrations/postgres'),
      });
      dbService = new DatabaseService({ client: 'pglite', db, raw } as any);
      closeConnection = async () => raw.close();
    }

    auth = new AuthService(dbService, new JwtService({ secret: 'unit-test-secret' }));
  });

  afterEach(async () => {
    await closeConnection();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function userRow(where: ReturnType<typeof eq>) {
    return (dbService.db as any).select().from(users).where(where);
  }

  it('provisions a brand-new, passwordless user for a never-seen email/sub', async () => {
    const res = await auth.loginOrProvisionOidc({
      sub: 'authelia|1',
      email: 'new@example.com',
      name: 'New Person',
    });

    expect(res.token).toEqual(expect.any(String));
    expect(res.user.email).toBe('new@example.com');
    expect(res.user.displayName).toBe('New Person');
    expect(res.user.preferredTempUnit).toBe('F');

    const rows = await userRow(eq(users.email, 'new@example.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0].passwordHash).toBeNull();
    expect(rows[0].oidcSubject).toBe('authelia|1');
  });

  it('defaults displayName to the email when the ID token carries no name claim', async () => {
    const res = await auth.loginOrProvisionOidc({ sub: 'authelia|2', email: 'noname@example.com' });
    expect(res.user.displayName).toBe('noname@example.com');
  });

  it('links a pre-existing password-registered account by email on first OIDC login', async () => {
    const registered = await auth.register({
      email: 'existing@example.com',
      password: 'password123',
      displayName: 'Existing User',
    } as RegisterDto);

    const res = await auth.loginOrProvisionOidc({
      sub: 'authelia|3',
      email: 'existing@example.com',
      name: 'Existing User',
    });

    expect(res.user.id).toBe(registered.user.id);

    const rows = await userRow(eq(users.id, registered.user.id));
    expect(rows[0].oidcSubject).toBe('authelia|3');
    // The link must not touch the existing password -- it's still a valid dev/local login path.
    expect(rows[0].passwordHash).not.toBeNull();
  });

  it('matches by subject on a repeat login even if the email claim changed, and syncs the stored email', async () => {
    const first = await auth.loginOrProvisionOidc({
      sub: 'authelia|4',
      email: 'old@example.com',
      name: 'Renamed Later',
    });

    const second = await auth.loginOrProvisionOidc({
      sub: 'authelia|4',
      email: 'new-email@example.com',
      name: 'Renamed Later',
    });

    expect(second.user.id).toBe(first.user.id);
    expect(second.user.email).toBe('new-email@example.com');

    const rows = await userRow(eq(users.oidcSubject, 'authelia|4'));
    expect(rows).toHaveLength(1); // no duplicate account from the email change
    expect(rows[0].email).toBe('new-email@example.com');
  });

  it('does not create a duplicate account on a second login with the same sub and same email', async () => {
    await auth.loginOrProvisionOidc({ sub: 'authelia|5', email: 'stable@example.com' });
    await auth.loginOrProvisionOidc({ sub: 'authelia|5', email: 'stable@example.com' });

    const rows = await userRow(eq(users.oidcSubject, 'authelia|5'));
    expect(rows).toHaveLength(1);
  });
});
