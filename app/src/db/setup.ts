/**
 * The phone's tables. The synced ones are generated from the server (schema.generated.ts).
 * When their description changes, they're dropped and made again, and the next sync
 * downloads everything afresh (S4 decision E). The local ones (the outbox of actions not yet
 * sent, and the sync state) are never wiped: what the athlete did offline survives an update.
 * A later change to a local table must add an ALTER here, not a drop.
 */
import type { Database, Tx } from './database';
import { CREATE, SCHEMA_HASH, SCHEMA_VERSION } from './schema.generated';

export const LOCAL_TABLES = ['outbox', 'sync_state'] as const;

const CREATE_LOCAL = `
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** sync_state keys. `schema` is the synced tables' description; the rest belong to the sync engine. */
export const STATE = { schema: 'schema', cursor: 'cursor', historyFrom: 'history_from' } as const;

export async function getState(tx: Pick<Tx, 'query'>, key: string): Promise<string | null> {
  const rows = await tx.query('SELECT value FROM sync_state WHERE key = ?', [key]);
  return (rows[0]?.[0] as string | undefined) ?? null;
}

export async function setState(tx: Pick<Tx, 'run'>, key: string, value: string | null): Promise<void> {
  if (value === null) await tx.run('DELETE FROM sync_state WHERE key = ?', [key]);
  else await tx.run('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);
}

/**
 * Makes the tables ready. Returns true when the synced tables were (re)made empty, so the
 * sync engine must bootstrap.
 */
export function prepare(database: Database): Promise<boolean> {
  return database.write(async (tx) => {
    await tx.exec(CREATE_LOCAL);
    const current = `${SCHEMA_VERSION}:${SCHEMA_HASH}`;
    if ((await getState(tx, STATE.schema)) === current) return false;
    const existing = await tx.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
    );
    for (const [name] of existing) {
      if (!(LOCAL_TABLES as readonly string[]).includes(name as string)) await tx.run(`DROP TABLE "${name}"`);
    }
    for (const sql of CREATE) await tx.run(sql);
    for (const key of Object.values(STATE)) await setState(tx, key, null);
    await setState(tx, STATE.schema, current);
    return true;
  });
}
