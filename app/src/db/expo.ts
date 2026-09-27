/** The database driver on devices and web: expo-sqlite's async API (never its sync one). */
import { openDatabaseAsync, type SQLiteBindValue } from 'expo-sqlite';

import type { Driver, Params, Value } from './database';

export async function openExpoDriver(name: string): Promise<Driver> {
  const handle = await openDatabaseAsync(name);
  await handle.execAsync('PRAGMA journal_mode = WAL');
  const bind = (params: Params) => params as SQLiteBindValue[];

  return {
    async query(sql, params) {
      const statement = await handle.prepareAsync(sql);
      try {
        const result = await statement.executeForRawResultAsync<Value[]>(bind(params));
        return (await result.getAllAsync()) as Value[][];
      } finally {
        await statement.finalizeAsync();
      }
    },
    async run(sql, params) {
      const statement = await handle.prepareAsync(sql);
      try {
        await statement.executeAsync(bind(params));
      } finally {
        await statement.finalizeAsync();
      }
    },
    exec: (sql) => handle.execAsync(sql),
    close: () => handle.closeAsync(),
  };
}
