import { randomUUID } from 'crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { resolveDatabaseConfig } from '../apps/api/src/app/persistence/database.config';
import * as schema from '../apps/api/src/db/schema';

async function main() {
  const email = process.env.AUTH_SEED_TEST_EMAIL ?? 'test@example.com';
  const password = process.env.AUTH_SEED_TEST_PASSWORD ?? 'test';
  const displayName = process.env.AUTH_SEED_TEST_NAME ?? 'Test User';
  const tempUnit = (process.env.AUTH_SEED_TEST_TEMP_UNIT ?? 'F') as 'C' | 'F';
  const lengthUnit = (process.env.AUTH_SEED_TEST_LENGTH_UNIT ?? 'cm') as 'cm' | 'in';
  const weightUnit = (process.env.AUTH_SEED_TEST_WEIGHT_UNIT ?? 'kg') as 'kg' | 'lb' | 'st';

  const config = resolveDatabaseConfig();

  if (config.client === 'postgres') {
    const client = new PgClient({ connectionString: config.url });
    await client.connect();
    const db = drizzlePostgres(client, { schema });
    await seed(db, email, password, displayName, tempUnit, lengthUnit, weightUnit);
    await client.end();
    return;
  }

  if (config.client === 'mysql') {
    const pool = mysql.createPool({ uri: config.url });
    const db = drizzleMysql(pool, { schema });
    await seed(db, email, password, displayName, tempUnit, lengthUnit, weightUnit);
    await pool.end();
    return;
  }

  const sqlite = new Database(config.sqliteFile);
  const db = drizzleSqlite(sqlite, { schema });
  await seed(db, email, password, displayName, tempUnit, lengthUnit, weightUnit);
  sqlite.close();
}

async function seed(
  db: any,
  email: string,
  password: string,
  displayName: string,
  tempUnit: 'C' | 'F',
  lengthUnit: 'cm' | 'in',
  weightUnit: 'kg' | 'lb' | 'st',
) {
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing.length) {
    console.log(`Seed user already exists (${email}); skipping.`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await db.insert(schema.users).values({
    id: randomUUID(),
    email,
    passwordHash,
    displayName,
    preferredTempUnit: tempUnit,
    preferredLengthUnit: lengthUnit,
    preferredWeightUnit: weightUnit,
  });

  console.log(`Seed user created: ${email} / ${password}`);
}

main().catch((err) => {
  console.error('Failed to seed test user', err);
  process.exit(1);
});
