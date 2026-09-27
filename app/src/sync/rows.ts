/**
 * Rows of the synced tables as the server sends them (ids and decimals as text, booleans,
 * JSON values), stored in SQLite by the generated column types.
 */
import type { Tx, Value } from '@/db/database';
import { COLUMNS, type SyncedTable } from '@/db/schema.generated';

export type ServerRow = Record<string, unknown>;

export function isSynced(table: string): table is SyncedTable {
  return Object.hasOwn(COLUMNS, table);
}

function columns(table: SyncedTable): [string, string][] {
  return Object.entries(COLUMNS[table]);
}

function toSql(type: string, value: unknown): Value {
  if (value === undefined || value === null) return null;
  if (type === 'boolean') return value ? 1 : 0;
  if (type === 'json') return JSON.stringify(value);
  return value as Value;
}

function fromSql(type: string, value: Value): unknown {
  if (value === null) return null;
  if (type === 'boolean') return value === 1;
  if (type === 'json') return JSON.parse(value as string);
  return value;
}

/** Writes a row, replacing the one with its id. Columns the phone doesn't have are ignored. */
export async function upsert(tx: Pick<Tx, 'run'>, table: SyncedTable, row: ServerRow): Promise<void> {
  const cols = columns(table);
  const names = cols.map(([name]) => `"${name}"`).join(', ');
  const marks = cols.map(() => '?').join(', ');
  const updates = cols
    .filter(([name]) => name !== 'id')
    .map(([name]) => `"${name}" = excluded."${name}"`)
    .join(', ');
  await tx.run(
    `INSERT INTO "${table}" (${names}) VALUES (${marks}) ON CONFLICT ("id") DO UPDATE SET ${updates}`,
    cols.map(([name, type]) => toSql(type, row[name])),
  );
}

export async function remove(tx: Pick<Tx, 'run'>, table: SyncedTable, id: string): Promise<void> {
  await tx.run(`DELETE FROM "${table}" WHERE "id" = ?`, [id]);
}

/** Rows matching every `where` column (all rows for an empty one), in the server's shape. */
export async function select(
  tx: Pick<Tx, 'query'>,
  table: SyncedTable,
  where: Record<string, Value> = {},
): Promise<ServerRow[]> {
  const cols = columns(table);
  const known = new Set(cols.map(([name]) => name));
  const keys = Object.keys(where);
  for (const key of keys) if (!known.has(key)) throw new Error(`${table} has no column ${key}`);
  const clause = keys.length ? ` WHERE ${keys.map((k) => `"${k}" IS ?`).join(' AND ')}` : '';
  const rows = await tx.query(
    `SELECT ${cols.map(([name]) => `"${name}"`).join(', ')} FROM "${table}"${clause}`,
    keys.map((k) => where[k]),
  );
  return rows.map((values) => Object.fromEntries(cols.map(([name, type], i) => [name, fromSql(type, values[i])])));
}
