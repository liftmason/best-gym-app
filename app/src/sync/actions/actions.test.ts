/**
 * The session actions' local effects, on the parity scenario's rows (shared/parity.json) in
 * a real SQLite database: what the athlete sees while offline must follow the server's rules.
 */
import parity from '../../../../shared/parity.json';

import { ApiError } from '@/api/errors';
import { makeDatabase } from '@/db/database';
import { openNodeDriver } from '@/db/node-driver';
import { prepare, setState, STATE } from '@/db/setup';
import { resumePoint, setCounts } from '@/domain/player';
import { snapshot } from '@/domain/sessions';
import { weekView } from '@/domain/week';
import type { Athlete, ExerciseRow, MaxRow, PrescribedSetRow, PrescriptionRow, World } from '@/domain/world';
import { loadWorld } from '@/training/load';

import { makeSyncEngine, type Who } from '../engine';
import { isSynced, select, upsert } from '../rows';
import type { Transport } from '../transport';

import {
  checkinAnswer,
  checkinFinish,
  issueReport,
  Refused,
  sessionFinish,
  sessionStart,
  setSave,
  warmupTick,
} from './index';

const tables = parity.snapshot.tables as unknown as Record<string, Record<string, unknown>[]>;
const today = parity.today;
const athlete = { ...(parity.athlete as unknown as Athlete) };
const days = parity.expect.kg.week;
const todayView = days[0].view as { cards: { session: string; log: string | null }[] };
const [amCard, pmCard] = todayView.cards;
const saturday = days.find((d) => d.wanted_day === '2026-09-26')!.view as { cards: { session: string }[] };

const offline: Transport = {
  bootstrap: () => Promise.reject(ApiError.offline()),
  pull: () => Promise.reject(ApiError.offline()),
  push: () => Promise.reject(ApiError.offline()),
};

async function setUp({ maxUpdates = 'approve', transport = offline } = {}) {
  const database = makeDatabase(openNodeDriver());
  await prepare(database);
  await database.write(async (tx) => {
    for (const [table, rows] of Object.entries(tables)) {
      if (isSynced(table)) for (const r of rows) await upsert(tx, table, r);
    }
    await setState(tx, STATE.cursor, 'parity');
    await setState(tx, STATE.owner, athlete.id);
    await setState(tx, STATE.historyFrom, parity.snapshot.history_from);
    await setState(tx, STATE.baselines, JSON.stringify(parity.snapshot.baselines));
  });
  const who: Who = { athleteId: athlete.id, userId: parity.athlete.user_id, timezone: 'America/New_York', maxUpdates };
  let n = 0;
  const engine = makeSyncEngine({
    database,
    transport,
    who: () => who,
    now: () => new Date(parity.now),
    newId: () => `action-${++n}`,
  });
  const world = () => loadWorld(database, athlete, { today, now: parity.now });
  return { database, engine, world };
}

const prescriptionsOf = (session: string) =>
  (tables.programs_prescription as unknown as PrescriptionRow[])
    .filter((rx) => rx.session_id === session)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

const start = (session: string, log = `log-${session}`) => ({
  session_log_id: log,
  program_session_id: session,
  exercises: prescriptionsOf(session).map((rx, i) => ({ id: `${log}-se${i}`, prescription_id: rx.id })),
});

test('a snapshot made on the phone is the one the server made', () => {
  const exercises = new Map((tables.exercises_exercise as unknown as ExerciseRow[]).map((e) => [e.id, e]));
  const rxs = new Map((tables.programs_prescription as unknown as PrescriptionRow[]).map((rx) => [rx.id, rx]));
  const maxes = tables.accounts_maxentry as unknown as MaxRow[];
  let compared = 0;
  for (const se of tables.workouts_sessionexercise as { prescription_id: string | null; prescribed: unknown }[]) {
    const rx = se.prescription_id ? rxs.get(se.prescription_id) : undefined;
    if (!rx) continue;
    const ex = exercises.get(rx.exercise_id)!;
    const source = (ex.percent_of_id && exercises.get(ex.percent_of_id)) || ex;
    const working = maxes
      .filter((m) => m.exercise_id === source.id)
      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1))[0];
    const overrides = (tables.programs_prescribedset as unknown as PrescribedSetRow[])
      .filter((s) => s.prescription_id === rx.id)
      .sort((a, b) => a.set_number - b.set_number);
    expect(snapshot({ exercise: ex, rx, overrides, maxSource: source, workingMaxKg: working?.kg ?? null })).toEqual(se.prescribed);
    compared += 1;
  }
  expect(compared).toBeGreaterThan(10);
});

test("a whole session done offline: today's second session", async () => {
  const { engine, world } = await setUp();
  const payload = start(pmCard.session);
  await engine.enqueue(sessionStart, payload);
  const log = payload.session_log_id;
  let w: World = await world();
  expect(weekView(w).cards!.find((c) => c.session.id === pmCard.session)!.state).toBe('paused');
  expect(resumePoint(w, w.log.get(log)!)).toEqual(['checkin', 1]);

  for (const [i, q] of w.questions.entries()) {
    const value = q.type === 'scale' ? '8' : q.options[0];
    await engine.enqueue(checkinAnswer, { answer_id: `answer-${i}`, session_log_id: log, question_id: q.id, value, other: '' });
  }
  w = await world();
  expect(resumePoint(w, w.log.get(log)!)).toEqual(['checkin_summary', null]);
  await engine.enqueue(checkinFinish, { session_log_id: log, skip: false });

  const exercises = w.exercisesOfLog.get(log)!;
  expect(exercises.map((se) => se.exercise_name)).toEqual(['Push Press', 'Ab Wheel Rollout']);
  for (const [i, se] of exercises.entries()) {
    const planned = i === 0 ? 4 : 3;
    for (let n = 1; n <= planned; n += 1) {
      await engine.enqueue(setSave, {
        set_id: `set-${i}-${n}`,
        session_exercise_id: se.id,
        set_number: n,
        load_kg: i === 0 ? '50' : null,
        reps: i === 0 ? 5 : 10,
        duration_seconds: null,
        rir: null,
        done: true,
      });
    }
  }
  w = await world();
  expect(resumePoint(w, w.log.get(log)!)).toEqual(['finish', null]);
  expect(setCounts(w, w.log.get(log)!)).toEqual([2, 7, 7]);

  await engine.enqueue(sessionFinish, { session_log_id: log, rpe: 8, comment: '  Pressed well ' });
  await engine.enqueue(issueReport, { issue_id: 'issue-1', session_log_id: log, kind: 'pain', text: ' Left wrist ' });
  w = await world();
  const card = weekView(w).cards!.find((c) => c.session.id === pmCard.session)!;
  expect(card).toMatchObject({ state: 'done', editable: true });
  expect(w.log.get(log)).toMatchObject({ session_rpe: 8, comment: 'Pressed well' });
  expect(Date.parse(w.log.get(log)!.finished_at!)).toBe(Date.parse(parity.now));
  expect(engine.status.pending).toBe(2 + 2 + 7 + 2);
});

test("what the server would refuse isn't queued", async () => {
  const { engine, database } = await setUp();
  const refused = (promise: Promise<unknown>) => expect(promise).rejects.toBeInstanceOf(Refused);
  await expect(engine.enqueue(sessionStart, start(saturday.cards[0].session))).rejects.toThrow('This session unlocks on Saturday.');

  const w = await loadWorld(database, athlete, { today, now: parity.now });
  const monday = [...w.logs].reverse()[0]; // last week's Monday: finished long ago
  const se = w.exercisesOfLog.get(monday.id)![0];
  const set = { set_id: 's', session_exercise_id: se.id, set_number: 1, load_kg: '50', reps: 1, duration_seconds: null, rir: null, done: true };
  await expect(engine.enqueue(setSave, set)).rejects.toThrow("This session can't be changed any more.");

  const am = w.exercisesOfLog.get(amCard.log!)!;
  await expect(engine.enqueue(setSave, { ...set, session_exercise_id: am[0].id, set_number: 51 })).rejects.toThrow('Sets are numbered 1 to 50.');
  await expect(engine.enqueue(setSave, { ...set, session_exercise_id: am[0].id, reps: 1000 })).rejects.toThrow('Reps must be between 0 and 999.');
  await refused(engine.enqueue(warmupTick, { session_exercise_id: am[0].id, checked: true }));
  const scale = w.questions.find((q) => q.type === 'scale')!;
  await expect(
    engine.enqueue(checkinAnswer, { answer_id: 'a', session_log_id: amCard.log!, question_id: scale.id, value: '11', other: '' }),
  ).rejects.toThrow('Pick a number from 1 to 10.');
  await expect(engine.enqueue(sessionFinish, { session_log_id: amCard.log!, rpe: 0, comment: '' })).rejects.toThrow(
    'Pick how hard it was, from 1 to 10.',
  );
  await refused(engine.enqueue(issueReport, { issue_id: 'i', session_log_id: amCard.log!, kind: 'gossip', text: '' }));
  expect(engine.status.pending).toBe(0);
  expect(await database.query('SELECT count(*) FROM local_changes')).toEqual([[0]]);
});

test('with automatic max updates, a set beating the max becomes the max, and stops being one when changed', async () => {
  const { engine, database, world } = await setUp({ maxUpdates: 'auto' });
  const w = await world();
  const squat = w.exercisesOfLog.get(amCard.log!)!.find((se) => se.exercise_name === 'Back Squat')!;
  const save = (load: string) =>
    engine.enqueue(setSave, { set_id: 'heavy', session_exercise_id: squat.id, set_number: 1, load_kg: load, reps: 1, duration_seconds: null, rir: null, done: true });
  const sessionMaxes = async () =>
    (await database.write((tx) => select(tx, 'accounts_maxentry', { source: 'session' }))).map((m) => m.kg);
  await save('140');
  await engine.enqueue(sessionFinish, { session_log_id: amCard.log!, rpe: 9, comment: '' });
  expect(await sessionMaxes()).toEqual(['140.00']);
  await save('130'); // an edit within the day: no longer above the 135 kg max
  expect(await sessionMaxes()).toEqual([]);
});

test("a session another device started first: what's waiting moves to the server's ids", async () => {
  const pushed: { name: string; payload: Record<string, unknown> }[][] = [];
  const transport: Transport = {
    ...offline,
    push: async (actions) => {
      pushed.push(actions.map((a) => ({ name: a.name, payload: a.payload })));
      if (pushed.length > 1) return Promise.reject(ApiError.offline());
      return actions.map((a, i) =>
        i === 0
          ? { id: a.id, status: 'done', result: { session_log_id: 'server-log', exercises: { [prescriptionsOf(pmCard.session)[0].id]: 'server-se' } } }
          : { id: a.id, status: 'retry' },
      );
    },
  };
  const { engine, database } = await setUp({ transport });
  const payload = start(pmCard.session);
  await engine.enqueue(sessionStart, payload);
  await engine.enqueue(setSave, {
    set_id: 'set-1',
    session_exercise_id: payload.exercises[0].id,
    set_number: 1,
    load_kg: '50',
    reps: 5,
    duration_seconds: null,
    rir: null,
    done: true,
  });
  await engine.sync();
  const [[waiting]] = await database.query('SELECT payload FROM outbox');
  expect(JSON.parse(waiting as string)).toMatchObject({ session_exercise_id: 'server-se' });
});
