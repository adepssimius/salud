// SQLite is a fully supported deployment target (self-hosting), not a dev-only fallback — see
// CLAUDE.md → Migrations and app-spec/development.md. That guarantee only holds if the two
// hand-maintained schema modules (`schema.sqlite.ts`, `schema.pg.ts`) actually stay identical in
// shape. Nothing in the type system catches drift between them — `schema.ts`'s dialect resolver
// casts one to the other's type — so this test is the only thing that does. A failure here means
// a schema change updated one dialect's columns/constraints without the other; fix the drifted
// file, don't loosen this test.
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import * as sqliteSchema from './schema.sqlite';
import * as pgSchema from './schema.pg';

type TableShape = {
  name: string;
  columns: {
    name: string;
    notNull: boolean;
    isUnique: boolean;
    primary: boolean;
    hasDefault: boolean;
  }[];
  primaryKeyColumns: string[];
  uniqueColumnSets: string[][];
  foreignKeys: { columns: string[]; foreignTable: string; foreignColumns: string[] }[];
};

function summarizeSqlite(table: any): TableShape {
  const config = getSqliteTableConfig(table);
  return {
    name: config.name,
    columns: config.columns
      .map((c: any) => ({
        name: c.name,
        notNull: c.notNull,
        isUnique: c.isUnique,
        primary: c.primary,
        hasDefault: c.hasDefault,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    primaryKeyColumns: config.primaryKeys
      .flatMap((pk: any) => pk.columns.map((c: any) => c.name))
      .sort(),
    uniqueColumnSets: config.uniqueConstraints
      .map((u: any) => u.columns.map((c: any) => c.name).sort())
      .sort(),
    foreignKeys: config.foreignKeys
      .map((fk: any) => {
        const ref = fk.reference();
        return {
          columns: ref.columns.map((c: any) => c.name).sort(),
          foreignTable: getSqliteTableConfig(ref.foreignTable).name,
          foreignColumns: ref.foreignColumns.map((c: any) => c.name).sort(),
        };
      })
      .sort((a, b) => a.columns.join(',').localeCompare(b.columns.join(','))),
  };
}

function summarizePg(table: any): TableShape {
  const config = getPgTableConfig(table);
  return {
    name: config.name,
    columns: config.columns
      .map((c: any) => ({
        name: c.name,
        notNull: c.notNull,
        isUnique: c.isUnique,
        primary: c.primary,
        hasDefault: c.hasDefault,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    primaryKeyColumns: config.primaryKeys
      .flatMap((pk: any) => pk.columns.map((c: any) => c.name))
      .sort(),
    uniqueColumnSets: config.uniqueConstraints
      .map((u: any) => u.columns.map((c: any) => c.name).sort())
      .sort(),
    foreignKeys: config.foreignKeys
      .map((fk: any) => {
        const ref = fk.reference();
        return {
          columns: ref.columns.map((c: any) => c.name).sort(),
          foreignTable: getPgTableConfig(ref.foreignTable).name,
          foreignColumns: ref.foreignColumns.map((c: any) => c.name).sort(),
        };
      })
      .sort((a, b) => a.columns.join(',').localeCompare(b.columns.join(','))),
  };
}

describe('schema.sqlite.ts and schema.pg.ts stay in lockstep', () => {
  const sqliteTables = Object.entries(sqliteSchema) as [string, any][];
  const pgTables = Object.entries(pgSchema) as [string, any][];

  it('exports the exact same table names', () => {
    expect(pgTables.map(([name]) => name).sort()).toEqual(
      sqliteTables.map(([name]) => name).sort(),
    );
  });

  const pgByName = new Map(pgTables);

  it.each(sqliteTables.map(([name]) => name))('table %s has matching shape in both dialects', (exportName) => {
    const sqliteTable = (sqliteSchema as any)[exportName];
    const pgTable = pgByName.get(exportName);
    expect(pgTable).toBeDefined();

    const sqliteShape = summarizeSqlite(sqliteTable);
    const pgShape = summarizePg(pgTable);

    expect(pgShape.name).toBe(sqliteShape.name);
    expect(pgShape.columns.map((c) => c.name)).toEqual(sqliteShape.columns.map((c) => c.name));
    expect(pgShape.columns.map((c) => c.notNull)).toEqual(sqliteShape.columns.map((c) => c.notNull));
    expect(pgShape.columns.map((c) => c.isUnique)).toEqual(sqliteShape.columns.map((c) => c.isUnique));
    expect(pgShape.columns.map((c) => c.primary)).toEqual(sqliteShape.columns.map((c) => c.primary));
    expect(pgShape.columns.map((c) => c.hasDefault)).toEqual(
      sqliteShape.columns.map((c) => c.hasDefault),
    );
    expect(pgShape.primaryKeyColumns).toEqual(sqliteShape.primaryKeyColumns);
    expect(pgShape.uniqueColumnSets).toEqual(sqliteShape.uniqueColumnSets);
    expect(pgShape.foreignKeys.map((fk) => ({ columns: fk.columns, foreignColumns: fk.foreignColumns }))).toEqual(
      sqliteShape.foreignKeys.map((fk) => ({ columns: fk.columns, foreignColumns: fk.foreignColumns })),
    );
    expect(pgShape.foreignKeys.map((fk) => fk.foreignTable)).toEqual(
      sqliteShape.foreignKeys.map((fk) => fk.foreignTable),
    );
  });
});
