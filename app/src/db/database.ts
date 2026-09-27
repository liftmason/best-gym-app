/**
 * The local database: every statement goes through one queue, and a write transaction holds
 * the queue until it commits, so nothing interleaves with it on the shared connection. Reads
 * issued during a write wait for it and then see its rows. (docs/EXPO_MIGRATION.md, "Offline
 * storage spike": Drizzle's own expo-sqlite driver commits async transactions early, so we
 * use its proxy driver over this queue.)
 *
 * After each committed write, subscribers hear which tables it changed, once per write rather
 * than once per row. A rolled-back write says nothing.
 *
 * The driver is expo-sqlite on devices and web (expo.ts) and Node's SQLite in tests.
 */
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

export type Value = string | number | null | Uint8Array;
export type Params = readonly Value[];

export interface Driver {
  /** Rows as arrays of column values, in select order. */
  query(sql: string, params: Params): Promise<Value[][]>;
  run(sql: string, params: Params): Promise<void>;
  /** Several statements with no parameters. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** What a write transaction gets: Drizzle, and plain SQL, both inside the transaction. */
export type Tx = {
  db: SqliteRemoteDatabase;
  query(sql: string, params?: Params): Promise<Value[][]>;
  run(sql: string, params?: Params): Promise<void>;
  exec(sql: string): Promise<void>;
};

const WRITES = /^\s*(?:insert(?:\s+or\s+\w+)?\s+into|update(?:\s+or\s+\w+)?|delete\s+from|drop\s+table(?:\s+if\s+exists)?|create\s+table(?:\s+if\s+not\s+exists)?)\s+[`"[]?(\w+)/i;

/** The table a statement writes to, if it writes. */
export function writtenTable(sql: string): string | null {
  return WRITES.exec(sql)?.[1] ?? null;
}

export function makeDatabase(driver: Driver) {
  let chain: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(tables: ReadonlySet<string>) => void>();

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  }

  function notify(tables: Set<string>) {
    if (tables.size) listeners.forEach((listener) => listener(tables));
  }

  /** Drizzle's proxy callback over a driver, noting written tables in `touched`. */
  function proxy(touched: Set<string> | null) {
    return async (sql: string, params: unknown[], method: 'run' | 'all' | 'values' | 'get') => {
      const table = writtenTable(sql);
      if (method === 'run') {
        await driver.run(sql, params as Params);
        if (table) touched?.add(table);
        return { rows: [] };
      }
      const rows = await driver.query(sql, params as Params);
      if (table) touched?.add(table); // insert … returning
      return { rows: method === 'get' ? (rows[0] ?? []) : rows };
    };
  }

  // Outside a transaction each statement is queued, and a lone write notifies on its own.
  const single = proxy(null);
  const db = drizzle((sql, params, method) =>
    exclusive(async () => {
      const result = await single(sql, params, method);
      const table = writtenTable(sql);
      if (table) notify(new Set([table]));
      return result;
    }),
  );

  return {
    /** Drizzle for reads and single writes. Use write() for anything that must go together. */
    db,

    /** A plain query, queued. */
    query(sql: string, params: Params = []): Promise<Value[][]> {
      return exclusive(() => driver.query(sql, params));
    },

    /**
     * Runs `fn` in one transaction holding the queue: all of it commits, or none. Inside, use
     * only `tx`: `db`, query() and write() wait for the queue, which `fn` is holding.
     */
    write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return exclusive(async () => {
        const touched = new Set<string>();
        const tx: Tx = {
          db: drizzle(proxy(touched)),
          query: async (sql, params = []) => {
            const rows = await driver.query(sql, params);
            const table = writtenTable(sql);
            if (table) touched.add(table);
            return rows;
          },
          run: async (sql, params = []) => {
            await driver.run(sql, params);
            const table = writtenTable(sql);
            if (table) touched.add(table);
          },
          exec: async (sql) => {
            await driver.exec(sql);
            for (const statement of sql.split(';')) {
              const table = writtenTable(statement);
              if (table) touched.add(table);
            }
          },
        };
        await driver.exec('BEGIN');
        let result: T;
        try {
          result = await fn(tx);
          await driver.exec('COMMIT');
        } catch (error) {
          await driver.exec('ROLLBACK').catch(() => {});
          throw error;
        }
        notify(touched);
        return result;
      });
    },

    /** Hears the tables each committed write changed. */
    subscribe(listener: (tables: ReadonlySet<string>) => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    close(): Promise<void> {
      return exclusive(() => driver.close());
    },
  };
}

export type Database = ReturnType<typeof makeDatabase>;
