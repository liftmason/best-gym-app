/**
 * The database driver for tests: Node's own SQLite, so the database layer and the sync
 * engine are tested without a simulator (docs/EXPO_MIGRATION.md, "Testing"). Not bundled
 * into the app: only tests import it.
 */
import type { Driver, Params, Value } from './database';

type Statement = {
  all(...params: Value[]): Value[][];
  run(...params: Value[]): unknown;
  setReturnArrays(on: boolean): void;
};
type NodeDatabase = { prepare(sql: string): Statement; exec(sql: string): void; close(): void };

export function openNodeDriver(path = ':memory:'): Driver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDatabase };
  const db = new DatabaseSync(path);
  const bind = (params: Params) => params.map((v) => (typeof v === 'boolean' ? Number(v) : v)) as Value[];

  return {
    async query(sql, params) {
      const statement = db.prepare(sql);
      statement.setReturnArrays(true); // by position: a join may select two columns called id
      return statement.all(...bind(params));
    },
    async run(sql, params) {
      db.prepare(sql).run(...bind(params));
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}
