import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { DatabaseService } from '../persistence/database.service';
import { users } from '../../db/schema';
import { RegisterDto } from './dto/register.dto';

// Unit-level, not e2e: a fabricated claims object and a real temp SQLite -- no HTTP, no
// openid-client, no Authelia. What matters here (security.md → "OIDC login") is entirely covered
// by this: match-by-sub-then-email, linking vs. provisioning, and that identity never duplicates
// or misroutes across repeat logins.
describe('AuthService.loginOrProvisionOidc', () => {
  let tmpDir: string;
  let raw: Database.Database;
  let dbService: DatabaseService;
  let auth: AuthService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-auth-unit-'));
    raw = new Database(path.join(tmpDir, 'test.db'));
    const db = drizzle(raw);
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), 'apps/api/src/db/migrations/sqlite'),
    });
    dbService = new DatabaseService({ client: 'sqlite', db, raw } as any);
    auth = new AuthService(dbService, new JwtService({ secret: 'unit-test-secret' }));
  });

  afterEach(() => {
    raw.close();
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
