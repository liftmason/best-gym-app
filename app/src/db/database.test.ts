import { eq } from 'drizzle-orm';

import { makeDatabase, writtenTable, type Database } from './database';
import { openNodeDriver } from './node-driver';
import { COLUMNS, setLog } from './schema.generated';
import * as generated from './schema.generated';
import { getState, prepare, setState, STATE } from './setup';

async function fresh(): Promise<Database> {
  const database = makeDatabase(openNodeDriver());
  await prepare(database);
  return database;
}

const aSet = (id: string, setNumber = 1) => ({
  id,
  sessionExerciseId: 'se-1',
  athleteId: 'ath-1',
  setNumber,
  loadKg: '100.0',
  reps: 3,
  done: true,
  loggedAt: '2026-09-24T16:00:00+00:00',
  maxDismissed: false,
});

const count = async (database: Database, table: string) =>
  (await database.query(`SELECT count(*) FROM "${table}"`))[0][0];

test('prepare makes every synced table and the local ones, once', async () => {
  const database = makeDatabase(openNodeDriver());
  expect(await prepare(database)).toBe(true);
  const tables = (await database.query("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r[0]);
  expect(tables).toEqual(expect.arrayContaining([...Object.keys(COLUMNS), 'outbox', 'sync_state']));
  await database.db.insert(setLog).values(aSet('s1'));
  expect(await prepare(database)).toBe(false);
  expect(await count(database, 'workouts_setlog')).toBe(1);
});

test('a new schema empties the synced tables and the sync state, but keeps the outbox', async () => {
  const database = await fresh();
  await database.db.insert(setLog).values(aSet('s1'));
  await database.write(async (tx) => {
    await tx.run("INSERT INTO outbox (id, name, payload, at) VALUES ('a1', 'set.save', '{}', 'now')");
    await tx.run('CREATE TABLE "gone_table" (id TEXT)'); // a table the new schema no longer has
    await setState(tx, STATE.cursor, 'c1');
    await setState(tx, STATE.schema, '0:old');
  });
  expect(await prepare(database)).toBe(true);
  expect(await count(database, 'workouts_setlog')).toBe(0);
  expect(await count(database, 'outbox')).toBe(1);
  expect(await database.write((tx) => getState(tx, STATE.cursor))).toBeNull();
  const tables = (await database.query("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r[0]);
  expect(tables).not.toContain('gone_table');
});

test('a write that fails leaves nothing behind and tells no one', async () => {
  const database = await fresh();
  const heard = jest.fn();
  database.subscribe(heard);
  await expect(
    database.write(async (tx) => {
      await tx.db.insert(setLog).values(aSet('s1'));
      await tx.db.insert(setLog).values(aSet('s1')); // the same id again
    }),
  ).rejects.toThrow();
  expect(await count(database, 'workouts_setlog')).toBe(0);
  expect(heard).not.toHaveBeenCalled();
});

test('a read issued during a write waits for it, then sees its rows', async () => {
  const database = await fresh();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const writing = database.write(async (tx) => {
    await tx.db.insert(setLog).values(aSet('s1'));
    await held;
    await tx.db.insert(setLog).values(aSet('s2', 2));
  });
  let seen: unknown[] | null = null;
  const reading = database.db
    .select()
    .from(setLog)
    .then((rows) => (seen = rows));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(seen).toBeNull(); // still waiting behind the write
  release();
  await writing;
  await reading;
  expect(seen).toHaveLength(2);
});

test('each committed write is heard once, with the tables it changed', async () => {
  const database = await fresh();
  const heard: string[][] = [];
  database.subscribe((tables) => heard.push([...tables].sort()));
  await database.write(async (tx) => {
    for (let n = 1; n <= 50; n += 1) await tx.db.insert(setLog).values(aSet(`s${n}`, n));
    await tx.run("INSERT INTO outbox (id, name, payload, at) VALUES ('a1', 'set.save', '{}', 'now')");
  });
  await database.db.update(setLog).set({ reps: 5 }).where(eq(setLog.id, 's1'));
  expect(heard).toEqual([['outbox', 'workouts_setlog'], ['workouts_setlog']]);
});

test('drizzle reads booleans and numbers back as the schema says', async () => {
  const database = await fresh();
  await database.db.insert(setLog).values(aSet('s1'));
  const [row] = await database.db.select().from(setLog).where(eq(setLog.id, 's1'));
  expect(row).toMatchObject({ done: true, maxDismissed: false, reps: 3, loadKg: '100.0' });
});

test('writtenTable finds the table a statement writes', () => {
  expect(writtenTable('insert into "workouts_setlog" ("id") values (?)')).toBe('workouts_setlog');
  expect(writtenTable('INSERT OR REPLACE INTO outbox VALUES (1)')).toBe('outbox');
  expect(writtenTable('update "workouts_setlog" set "reps" = ?')).toBe('workouts_setlog');
  expect(writtenTable('delete from "sync_state" where key = ?')).toBe('sync_state');
  expect(writtenTable('select * from "workouts_setlog"')).toBeNull();
});

test('every generated table is exported for drizzle', () => {
  const exported = Object.values(generated).filter((v) => typeof v === 'object' && v && 'getSQL' in v);
  expect(exported).toHaveLength(Object.keys(COLUMNS).length);
});
