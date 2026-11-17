import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from './migrator';

/**
 * Runs the real migration path against a database that HAS ROWS IN IT.
 *
 * This exists because of a specific outage. Migration 0006 (the OIDC `users` rebuild) rebuilds a
 * table: create `__new_users`, copy, `DROP TABLE users`, rename. drizzle-kit generates a
 * `PRAGMA foreign_keys=OFF` for that, which is a silent no-op inside drizzle's per-migration
 * transaction — so the drop failed with SQLITE_CONSTRAINT_FOREIGNKEY the moment anything actually
 * referenced a user, and the production pod crash-looped at boot.
 *
 * **Every other suite in this repo migrates a brand-new empty database**, where there are no rows
 * and therefore no foreign key to violate, so all of them stayed green through that. The seeding
 * below is not incidental to this test — it is the entire point of it. Keep it, and keep it
 * covering at least one row in a table that references `users`.
 */
describe('Migrations against a populated database (e2e)', () => {
  let tmpDir: string;
  let dbFile: string;
  let raw: Database.Database;

  const MIGRATIONS = path.join(process.cwd(), 'apps/api/src/db/migrations/sqlite');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-migrations-'));
    dbFile = path.join(tmpDir, 'test.db');
    raw = new Database(dbFile);
  });

  afterEach(() => {
    raw.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Applies every migration except the newest `count`, so the newest can then run against data. */
  function applyMigrationsExceptNewest(count: number) {
    const files = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const older = files.slice(0, files.length - count);
    for (const f of older) {
      raw.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').split('--> statement-breakpoint').join('\n'));
    }

    // Mark them applied, so the migrator only has the newest one left to run. Drizzle's sqlite
    // migrator decides by the journal's `when` timestamp, so that is what has to be recorded.
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'));
    raw.exec(
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    const insert = raw.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?,?)');
    for (const entry of journal.entries.slice(0, older.length)) {
      insert.run(`already-applied-${entry.tag}`, entry.when);
    }
  }

  /** A user plus one row in each of three tables that reference `users.id` by foreign key. */
  function seedReferencingRows() {
    const userId = randomUUID();
    raw
      .prepare(
        `insert into users (id,email,password_hash,display_name,preferred_temp_unit,preferred_length_unit,preferred_weight_unit)
         values (?,?,?,?,?,?,?)`,
      )
      .run(userId, 'parent@example.com', '$argon2id$fake-hash', 'Parent', 'F', 'in', 'lb');

    const patientId = randomUUID();
    raw
      .prepare(`insert into patients (id,full_name,date_of_birth,sex_at_birth,owned_by_user_id) values (?,?,?,?,?)`)
      .run(patientId, 'Kid', '2019-04-01', 'female', userId);
    raw
      .prepare(`insert into care_team_memberships (id,patient_id,user_id,role,permissions) values (?,?,?,?,?)`)
      .run(randomUUID(), patientId, userId, 'parent', 'full');
    raw
      .prepare(`insert into observations (id,patient_id,recorded_by_user_id,observed_at) values (?,?,?,?)`)
      .run(randomUUID(), patientId, userId, Math.floor(Date.now() / 1000));

    return { userId, patientId };
  }

  async function migrate() {
    const previous = process.env.MIGRATIONS_DIR;
    process.env.MIGRATIONS_DIR = MIGRATIONS;
    try {
      await runMigrations({ client: 'sqlite', db: drizzle(raw), raw } as any);
    } finally {
      if (previous === undefined) delete process.env.MIGRATIONS_DIR;
      else process.env.MIGRATIONS_DIR = previous;
    }
  }

  it('applies the newest migration to a database that already holds referenced rows', async () => {
    applyMigrationsExceptNewest(1);
    expect(raw.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    const { userId, patientId } = seedReferencingRows();

    await migrate();

    // The rows survived the table rebuild, with their ids intact — a rebuild that dropped or
    // renumbered them would orphan every patient in the household.
    expect(raw.prepare('select count(*) c from users').get()).toEqual({ c: 1 });
    expect(raw.prepare('select id from users').get()).toEqual({ id: userId });
    expect(raw.prepare('select owned_by_user_id from patients where id = ?').get(patientId)).toEqual({
      owned_by_user_id: userId,
    });
    expect(raw.prepare('select count(*) c from observations').get()).toEqual({ c: 1 });
  });

  it('leaves no dangling foreign keys behind', async () => {
    applyMigrationsExceptNewest(1);
    seedReferencingRows();

    await migrate();

    expect(raw.pragma('foreign_key_check')).toEqual([]);
  });

  it('restores foreign key enforcement afterwards', async () => {
    // Enforcement is suspended during the run; leaving it off would silently accept orphaned
    // writes for the entire life of the process.
    applyMigrationsExceptNewest(1);
    seedReferencingRows();

    await migrate();

    expect(raw.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    expect(() =>
      raw
        .prepare(`insert into patients (id,full_name,date_of_birth,sex_at_birth,owned_by_user_id) values (?,?,?,?,?)`)
        .run(randomUUID(), 'Orphan', '2020-01-01', 'male', 'no-such-user'),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  // 0017 moved a schedule's single episode_id into schedule_episodes (data-model.md →
  // ScheduleEpisode), rebuilding intervention_schedules — a table doses and skips reference.
  it('carries every schedule → episode link into schedule_episodes, and keeps doses and skips on their schedule', async () => {
    applyMigrationsExceptNewest(1);
    const { userId, patientId } = seedReferencingRows();
    const now = Math.floor(Date.now() / 1000);
    const otherPatient = randomUUID();
    raw
      .prepare(`insert into patients (id,full_name,date_of_birth,sex_at_birth,owned_by_user_id) values (?,?,?,?,?)`)
      .run(otherPatient, 'Sibling', '2017-01-01', 'male', userId);
    const episode = (pid: string) => {
      const id = randomUUID();
      raw
        .prepare(`insert into episodes (id,patient_id,name,started_at_type,started_at_id,status) values (?,?,?,?,?,?)`)
        .run(id, pid, 'Ringworm', 'observation', randomUUID(), 'active');
      return id;
    };
    const ownEpisode = episode(patientId);
    const siblingsEpisode = episode(otherPatient);
    const schedule = (episodeId: string | null) => {
      const id = randomUUID();
      raw
        .prepare(
          `insert into intervention_schedules (id,patient_id,type,episode_id,label,frequency_hours,start_at,status,created_by_user_id)
           values (?,?,?,?,?,?,?,?,?)`,
        )
        .run(id, patientId, 'dressing_change', episodeId, 'q12h', 12, now - 86400, 'active', userId);
      return id;
    };
    const linked = schedule(ownEpisode);
    const unlinked = schedule(null);
    const crossPatient = schedule(siblingsEpisode); // the rule the service now enforces drops it
    const doseId = randomUUID();
    raw
      .prepare(`insert into interventions (id,patient_id,recorded_by_user_id,performed_at,type,schedule_id) values (?,?,?,?,?,?)`)
      .run(doseId, patientId, userId, now - 3600, 'dressing_change', linked);
    raw
      .prepare(`insert into schedule_skips (id,schedule_id,slot_at,reason,recorded_by_user_id) values (?,?,?,?,?)`)
      .run(randomUUID(), linked, now - 86400, 'skipped', userId);

    await migrate();

    expect(raw.prepare('select schedule_id, episode_id from schedule_episodes').all()).toEqual([{ schedule_id: linked, episode_id: ownEpisode }]);
    expect((raw.prepare('select id from schedule_episodes').get() as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const columns = (raw.pragma('table_info(intervention_schedules)') as Array<{ name: string }>).map((c) => c.name);
    expect(columns).not.toContain('episode_id');
    expect(raw.prepare('select count(*) c from intervention_schedules where id in (?,?,?)').get(linked, unlinked, crossPatient)).toEqual({ c: 3 });
    expect(raw.prepare('select schedule_id from interventions where id = ?').get(doseId)).toEqual({ schedule_id: linked });
    expect(raw.prepare('select count(*) c from schedule_skips where schedule_id = ?').get(linked)).toEqual({ c: 1 });
    expect(raw.pragma('foreign_key_check')).toEqual([]);
  });

  it('still works from empty, the case every other suite covers', async () => {
    await migrate();
    expect(raw.pragma('foreign_key_check')).toEqual([]);
    const columns = (raw.pragma('table_info(users)') as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['oidc_subject', 'password_hash']));
  });
});
