import { makeDatabase, type Database } from '@/db/database';
import { openNodeDriver } from '@/db/node-driver';
import { prepare } from '@/db/setup';

import { habitSet, messageSend, Refused } from './actions';
import { makeSyncEngine, type Notice } from './engine';
import { fakeServer } from './fake-server';
import { select } from './rows';

const ATHLETE = 'ath-1';
const USER = 'user-1';
const DAY = '2026-09-24';

async function setUp({ pageSize = 3, athleteId = ATHLETE } = {}) {
  const database = makeDatabase(openNodeDriver());
  await prepare(database);
  const server = fakeServer({ athleteId, userId: USER, pageSize });
  server.put('programs_habit', {
    id: 'habit-1',
    athlete_id: athleteId,
    order: 1,
    name: 'Sleep',
    emoji: '😴',
    cadence: 'daily',
    note: '',
    source_template_id: null,
    created_at: '2026-09-01T00:00:00+00:00',
    archived_at: null,
  });
  server.put('accounts_coaching', {
    id: 'link-1',
    coach_id: 'coach-1',
    athlete_id: athleteId,
    gym_id: 'gym-1',
    status: 'active',
    started_at: '2026-09-01T00:00:00+00:00',
    ended_at: null,
  });
  server.put('exercises_category', { id: 'cat-1', gym_id: 'gym-1', name: 'Olympic', order: 1 });
  const who = { athleteId, userId: USER };
  let n = 0;
  const engine = makeSyncEngine({
    database,
    transport: server.transport,
    who: () => who,
    newId: () => `phone-${++n}`,
    now: () => new Date('2026-09-24T16:00:00Z'),
  });
  const notices: Notice[] = [];
  engine.onNotice((notice) => notices.push(notice));
  return { database, server, engine, notices, who };
}

const habitLogs = (database: Database) => database.write((tx) => select(tx, 'programs_habitlog'));

test('the first sync downloads everything, then pulls what changes', async () => {
  const { database, server, engine } = await setUp();
  await engine.sync();
  expect(server.state.bootstraps).toBe(1);
  expect(await database.write((tx) => select(tx, 'programs_habit'))).toHaveLength(1);
  server.put('programs_habitlog', { id: 'log-9', habit_id: 'habit-1', athlete_id: ATHLETE, date: DAY, created_at: 'x' });
  await engine.sync();
  expect(server.state.bootstraps).toBe(1);
  expect((await habitLogs(database)).map((r) => r.id)).toEqual(['log-9']);
  expect(engine.status).toMatchObject({ pending: 0, offline: false, lastSynced: '2026-09-24T16:00:00.000Z' });
});

test('a habit ticked offline shows at once, and becomes the server’s row once sent', async () => {
  const { database, server, engine } = await setUp();
  await engine.sync();
  server.state.offline = true;
  await engine.enqueue(habitSet, { habit_id: 'habit-1', date: DAY, done: true });
  await engine.sync();
  expect(await habitLogs(database)).toEqual([expect.objectContaining({ id: 'phone-1', date: DAY })]);
  expect(engine.status).toMatchObject({ pending: 1, offline: true });

  server.state.offline = false;
  await engine.sync();
  const logs = await habitLogs(database);
  expect(logs).toHaveLength(1); // not the phone's and the server's
  expect(logs[0].id).toMatch(/^server-/);
  expect(engine.status).toMatchObject({ pending: 0, offline: false });
});

test('a refused action disappears, with a notice', async () => {
  const { database, server, engine, notices } = await setUp();
  await engine.sync();
  server.state.offline = true;
  await engine.enqueue(habitSet, { habit_id: 'habit-1', date: DAY, done: true });
  server.state.offline = false;
  server.drop('programs_habit', 'habit-1'); // the coach removed it meanwhile
  await engine.sync();
  expect(await habitLogs(database)).toEqual([]);
  expect(notices).toEqual([{ action: 'habit.set', message: 'Not found.' }]);
  expect(engine.status.pending).toBe(0);
});

test('an untick the server refuses puts the day back as it was', async () => {
  const { database, server, engine } = await setUp();
  server.put('programs_habitlog', { id: 'log-1', habit_id: 'habit-1', athlete_id: ATHLETE, date: DAY, created_at: 'x' });
  await engine.sync();
  server.state.offline = true;
  await engine.enqueue(habitSet, { habit_id: 'habit-1', date: DAY, done: false });
  expect(await habitLogs(database)).toEqual([]);
  server.state.offline = false;
  server.put('programs_habit', { ...server.rows('programs_habit')[0], archived_at: '2026-09-24T12:00:00+00:00' });
  await engine.sync();
  expect((await habitLogs(database)).map((r) => r.id)).toEqual(['log-1']);
});

test('a server error keeps the action and those after it, in order, and pulling keeps them on top', async () => {
  const { database, server, engine } = await setUp();
  await engine.sync();
  server.state.failFrom = 'habit.set';
  await engine.enqueue(habitSet, { habit_id: 'habit-1', date: DAY, done: true });
  await engine.enqueue(messageSend, { message_id: 'msg-1', body: 'Knee is better' });
  server.put('exercises_category', { id: 'cat-2', gym_id: 'gym-1', name: 'Squat', order: 2 });
  await engine.sync();
  expect(engine.status.pending).toBe(2);
  expect(await habitLogs(database)).toHaveLength(1); // still shown after the pull
  expect(await database.write((tx) => select(tx, 'exercises_category'))).toHaveLength(2);

  server.state.failFrom = null;
  await engine.sync();
  expect(engine.status.pending).toBe(0);
  const names = server.state.received.map((a) => a.name);
  expect(names.slice(-2)).toEqual(['habit.set', 'message.send']);
});

test('a message keeps the id the phone chose, and moves into the server’s thread', async () => {
  const { database, server, engine } = await setUp();
  await engine.sync();
  server.state.offline = true;
  await engine.enqueue(messageSend, { message_id: 'msg-1', body: '  See you Monday  ' });
  const [standIn] = await database.write((tx) => select(tx, 'messaging_thread'));
  expect(standIn.id).toBe('phone-1');
  server.state.offline = false;
  await engine.sync();
  const threads = await database.write((tx) => select(tx, 'messaging_thread'));
  const messages = await database.write((tx) => select(tx, 'messaging_message'));
  expect(threads.map((t) => t.id)).toEqual([expect.stringMatching(/^server-/)]);
  expect(messages).toEqual([expect.objectContaining({ id: 'msg-1', thread_id: threads[0].id, body: 'See you Monday' })]);
});

test('an action the phone can refuse itself is never queued', async () => {
  const { database, engine } = await setUp();
  await engine.sync();
  await expect(engine.enqueue(messageSend, { message_id: 'm', body: '   ' })).rejects.toBeInstanceOf(Refused);
  await expect(engine.enqueue(habitSet, { habit_id: 'nope', date: DAY, done: true })).rejects.toThrow('That habit is gone.');
  expect(engine.status.pending).toBe(0);
  expect(await database.query('SELECT count(*) FROM local_changes')).toEqual([[0]]);
});

test('pulls come in pages', async () => {
  const { database, server, engine } = await setUp({ pageSize: 2 });
  await engine.sync();
  for (let n = 1; n <= 7; n += 1) server.put('exercises_category', { id: `c${n}`, gym_id: 'gym-1', name: `C${n}`, order: n });
  await engine.sync();
  expect(await database.write((tx) => select(tx, 'exercises_category'))).toHaveLength(8);
});

test('too long away (410) downloads everything again, and keeps what is waiting', async () => {
  const { database, server, engine } = await setUp();
  await engine.sync();
  server.state.offline = true;
  await engine.enqueue(habitSet, { habit_id: 'habit-1', date: DAY, done: true });
  server.state.offline = false;
  server.state.purgedBelow = 999;
  server.state.failFrom = 'habit.set'; // still can't send it
  await engine.sync();
  expect(server.state.bootstraps).toBe(2);
  expect(await habitLogs(database)).toEqual([expect.objectContaining({ id: 'phone-1' })]);
  expect(engine.status.pending).toBe(1);
});

test('a new gym library replaces the old one', async () => {
  const { database, server, engine } = await setUp();
  await engine.sync();
  server.drop('exercises_category', 'cat-1');
  server.put('exercises_category', { id: 'cat-new', gym_id: 'gym-2', name: 'Strength', order: 1 });
  server.state.libraryReset = true;
  await engine.sync();
  expect((await database.write((tx) => select(tx, 'exercises_category'))).map((r) => r.id)).toEqual(['cat-new']);
});

test("another athlete on this device starts from nothing", async () => {
  const { database, server, engine, who } = await setUp();
  await engine.sync();
  server.state.offline = true;
  await engine.enqueue(habitSet, { habit_id: 'habit-1', date: DAY, done: true });
  who.athleteId = 'ath-2';
  await engine.sync(); // offline: the old data goes anyway
  expect(await habitLogs(database)).toEqual([]);
  expect(await database.write((tx) => select(tx, 'programs_habit'))).toEqual([]);
  expect(engine.status.pending).toBe(0);
});

test('two syncs at once make one run, then one more', async () => {
  const { server, engine } = await setUp();
  await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
  expect(server.state.bootstraps).toBe(1);
});

test('forgetting (signing out) clears everything', async () => {
  const { database, engine, server } = await setUp();
  await engine.sync();
  server.state.offline = true;
  await engine.enqueue(habitSet, { habit_id: 'habit-1', date: DAY, done: true });
  await engine.forget();
  expect(engine.status.pending).toBe(0);
  expect(await database.write((tx) => select(tx, 'programs_habit'))).toEqual([]);
  expect(await database.query("SELECT count(*) FROM sync_state WHERE key IN ('cursor', 'owner')")).toEqual([[0]]);
});
