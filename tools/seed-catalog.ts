import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { resolveDatabaseConfig } from '../apps/api/src/app/persistence/database.config';
import * as schema from '../apps/api/src/db/schema';

interface EmbodimentSeed {
  key: string;
  label: string;
  // Seeded the way the bottle prints it -- "160 mg per 5 mL", not the 32 mg/mL a human had to work
  // out. The per-mL figure is derived here exactly as the API derives it
  // (data-model.md -> MedicationEmbodiment).
  concentrationMg?: number;
  concentrationVolumeMl?: number;
  strengthMgPerUnit?: number;
  unitType: 'tablet' | 'capsule' | 'ml' | 'drop' | 'other';
  notes?: string;
}

interface GuidelineSeed {
  embodimentKey: string;
  source: string;
  type: 'weight_based' | 'age_band';
  mgPerKg?: number;
  maxMgPerDose?: number;
  maxMgPerDay: number;
  minIntervalHours?: number;
  ageMinMonths?: number;
  ageMaxMonths?: number;
  doseMg?: number;
  doseMl?: number;
  frequencyPerDay?: number;
  notes?: string;
}

interface MedicationSeed {
  name: string;
  brandNames: string[];
  description: string;
  tags: string[];
  embodiments: EmbodimentSeed[];
  guidelines: GuidelineSeed[];
}

const CATALOG: MedicationSeed[] = [
  {
    name: 'acetaminophen',
    brandNames: ['Tylenol', 'Panadol', 'Feverall'],
    description: 'Antipyretic and analgesic.',
    tags: ['antipyretic', 'analgesic'],
    embodiments: [
      {
        key: 'suspension',
        label: "160 mg/5 mL suspension (Children's Tylenol)",
        concentrationMg: 160,
        concentrationVolumeMl: 5,
        unitType: 'ml',
      },
      {
        key: 'tablet',
        label: '500 mg tablet',
        strengthMgPerUnit: 500,
        unitType: 'tablet',
      },
    ],
    guidelines: [
      {
        embodimentKey: 'suspension',
        source: 'AAP Clinical Report — Fever and Antipyretic Use in Children (2011)',
        type: 'weight_based',
        mgPerKg: 15,
        maxMgPerDose: 1000,
        maxMgPerDay: 4000,
        minIntervalHours: 4,
        notes: 'Standard weight-based dosing; caps at adult maximums.',
      },
      {
        embodimentKey: 'suspension',
        source: "Manufacturer label — Children's Tylenol dosing chart",
        type: 'age_band',
        ageMinMonths: 12,
        ageMaxMonths: 23,
        doseMg: 160,
        doseMl: 5,
        maxMgPerDay: 800,
        frequencyPerDay: 4,
      },
    ],
  },
  {
    name: 'ibuprofen',
    brandNames: ['Motrin', 'Advil'],
    description: 'NSAID with antipyretic and analgesic effects.',
    tags: ['antipyretic', 'analgesic', 'NSAID'],
    embodiments: [
      {
        key: 'suspension',
        label: "100 mg/5 mL suspension (Children's Motrin)",
        concentrationMg: 100,
        concentrationVolumeMl: 5,
        unitType: 'ml',
      },
      {
        key: 'tablet',
        label: '200 mg tablet',
        strengthMgPerUnit: 200,
        unitType: 'tablet',
      },
    ],
    guidelines: [
      {
        embodimentKey: 'suspension',
        source: 'AAP Clinical Report — Fever and Antipyretic Use in Children (2011)',
        type: 'weight_based',
        mgPerKg: 10,
        maxMgPerDose: 400,
        maxMgPerDay: 1200,
        minIntervalHours: 6,
        notes: 'Not recommended under 6 months of age.',
      },
      {
        embodimentKey: 'suspension',
        source: "Manufacturer label — Children's Motrin dosing chart",
        type: 'age_band',
        ageMinMonths: 24,
        ageMaxMonths: 35,
        doseMg: 100,
        doseMl: 5,
        maxMgPerDay: 400,
        frequencyPerDay: 4,
      },
    ],
  },
];

async function main() {
  const config = resolveDatabaseConfig();

  if (config.client === 'postgres') {
    const client = new PgClient({ connectionString: config.url });
    await client.connect();
    const db = drizzlePostgres(client, { schema });
    await seedCatalog(db);
    await client.end();
    return;
  }

  if (config.client === 'mysql') {
    const pool = mysql.createPool({ uri: config.url });
    const db = drizzleMysql(pool, { schema });
    await seedCatalog(db);
    await pool.end();
    return;
  }

  const sqlite = new Database(config.sqliteFile);
  const db = drizzleSqlite(sqlite, { schema });
  await seedCatalog(db);
  sqlite.close();
}

async function seedCatalog(db: any) {
  for (const med of CATALOG) {
    const existing = await db
      .select()
      .from(schema.medications)
      .where(eq(schema.medications.name, med.name))
      .limit(1);

    if (existing.length) {
      console.log(`Medication already seeded (${med.name}); skipping.`);
      continue;
    }

    const medicationId = randomUUID();
    await db.insert(schema.medications).values({
      id: medicationId,
      name: med.name,
      brandNames: JSON.stringify(med.brandNames),
      description: med.description,
      tags: JSON.stringify(med.tags),
      defaultActive: true,
    });

    const embodimentIds: Record<string, string> = {};
    for (const emb of med.embodiments) {
      const embodimentId = randomUUID();
      embodimentIds[emb.key] = embodimentId;
      await db.insert(schema.medicationEmbodiments).values({
        id: embodimentId,
        medicationId,
        label: emb.label,
        concentrationMgPerMl:
          emb.concentrationMg != null && emb.concentrationVolumeMl != null
            ? Math.round((emb.concentrationMg / emb.concentrationVolumeMl) * 1e6) / 1e6
            : null,
        concentrationMg: emb.concentrationMg ?? null,
        concentrationVolumeMl: emb.concentrationVolumeMl ?? null,
        strengthMgPerUnit: emb.strengthMgPerUnit ?? null,
        unitType: emb.unitType,
        notes: emb.notes ?? null,
      });
    }

    for (const g of med.guidelines) {
      await db.insert(schema.medicationGuidelines).values({
        id: randomUUID(),
        medicationId,
        medicationEmbodimentId: embodimentIds[g.embodimentKey],
        source: g.source,
        type: g.type,
        mgPerKg: g.mgPerKg ?? null,
        maxMgPerDose: g.maxMgPerDose ?? null,
        maxMgPerDay: g.maxMgPerDay,
        minIntervalHours: g.minIntervalHours ?? null,
        ageMinMonths: g.ageMinMonths ?? null,
        ageMaxMonths: g.ageMaxMonths ?? null,
        doseMg: g.doseMg ?? null,
        doseMl: g.doseMl ?? null,
        pillCount: null,
        frequencyPerDay: g.frequencyPerDay ?? null,
        notes: g.notes ?? null,
      });
    }

    console.log(`Seeded ${med.name} with ${med.embodiments.length} embodiment(s) and ${med.guidelines.length} guideline(s).`);
  }
}

main().catch((err) => {
  console.error('Failed to seed medication catalog', err);
  process.exit(1);
});
