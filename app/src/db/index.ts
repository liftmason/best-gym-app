/**
 * The app's local database, opened once. Training screens read it with useLive and change it
 * only through sync actions (src/sync), so every change also goes to the server.
 */
import { makeDatabase, type Database } from './database';
import { openExpoDriver } from './expo';
import { prepare } from './setup';

export { useLive } from './live';
export type { Database, Tx } from './database';
export * as tables from './schema.generated';

const NAME = 'gymtrainer.db';

let opening: Promise<{ database: Database; fresh: boolean }> | null = null;

/** The database, with its tables ready; `fresh` when they were just (re)made empty. */
export function openDatabase() {
  opening ??= (async () => {
    const database = makeDatabase(await openExpoDriver(NAME));
    return { database, fresh: await prepare(database) };
  })().catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}
