import { ApiError } from '@/api/errors';
import { sessionStart } from '@/sync/actions';
import { makeSyncEngine } from '@/sync/engine';
import type { Transport } from '@/sync/transport';
import { memoryFiles, now, offline, paritySession } from '@/training/testing/parity-session';

import { makeVideoQueue } from './queue';

type Answer = { data?: unknown; error?: unknown; response: Response };
const answer = (status: number, data?: unknown): Promise<Answer> =>
  Promise.resolve({ data, error: status >= 400 ? data : undefined, response: new Response(null, { status }) });

function server(start: () => Promise<Answer>) {
  const calls: { method: string; path: string; init: unknown }[] = [];
  const client = {
    POST: jest.fn((path: string, init: unknown) => {
      calls.push({ method: 'POST', path, init });
      return start();
    }),
    PATCH: jest.fn(() => answer(204)),
    GET: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  };
  return { client: client as never, calls };
}

const started = { video_id: 'video-1', upload_url: 'https://bucket.example/put', content_type: 'video/mp4' };

async function setUp(start: () => Promise<Answer>) {
  const session = await paritySession();
  const world = await session.database.query("SELECT id, session_log_id FROM workouts_sessionexercise WHERE warmup = 0 LIMIT 1");
  const [se, log] = world[0] as [string, string];
  const api = server(start);
  const queue = makeVideoQueue({ database: session.database, engine: session.engine, api, files: memoryFiles });
  return { ...session, queue, api, se, log };
}

beforeEach(() => memoryFiles.put.mockReset().mockResolvedValue(200));

test('a video added offline waits, then goes: started, uploaded, attached, and the local copy dropped', async () => {
  let online = false;
  const { queue, se, log, engine, api } = await setUp(() => (online ? answer(201, started) : Promise.reject(ApiError.offline())));
  await queue.add(log, se, 'file:///clip.mov?size=5000', 'video/quicktime', 'Hips?');
  await queue.process();
  expect((await queue.all()).map((u) => u.state)).toEqual(['waiting']);
  online = true;
  await queue.process();
  expect(api.calls[api.calls.length - 1].init).toMatchObject({
    params: { path: { log_id: log } },
    body: { session_exercise_id: se, size: 5000, content_type: 'video/quicktime' },
  });
  expect(memoryFiles.put).toHaveBeenCalledWith(expect.stringMatching(/^kept:/), started.upload_url, 'video/mp4');
  expect(await queue.all()).toEqual([]);
  expect(engine.status.pending).toBe(1); // video.attach
});

test('it waits for its session to reach the server first', async () => {
  const { queue, engine, api, database } = await setUp(() => answer(201, started));
  const [[session]] = await database.query('SELECT id FROM programs_programsession WHERE name = ?', ['PM']);
  const rx = await database.query('SELECT id FROM programs_prescription WHERE session_id = ? ORDER BY "order"', [session]);
  await engine.enqueue(sessionStart, {
    session_log_id: 'new-log',
    program_session_id: session as string,
    exercises: rx.map(([id], i) => ({ id: `new-se-${i}`, prescription_id: id as string })),
  });
  await queue.add('new-log', 'new-se-0', 'file:///clip.mp4', 'video/mp4');
  await queue.process();
  expect(api.calls).toEqual([]);
  expect((await queue.all())[0].state).toBe('waiting');
});

test("a refusal keeps its reason; a failed upload tries again", async () => {
  let refuse = true;
  const { queue, se, log } = await setUp(() =>
    refuse
      ? answer(409, { error: { code: 'video_refused', message: 'Up to 3 videos per exercise.', fields: {} } })
      : answer(201, started),
  );
  await queue.add(log, se, 'file:///a.mp4', 'video/mp4');
  await queue.process();
  expect(await queue.all()).toEqual([expect.objectContaining({ state: 'refused', error: 'Up to 3 videos per exercise.' })]);
  refuse = false;
  await queue.remove((await queue.all())[0].id);
  await queue.add(log, se, 'file:///b.mp4', 'video/mp4');
  memoryFiles.put.mockResolvedValueOnce(500);
  await queue.process();
  expect((await queue.all())[0].state).toBe('waiting'); // a fresh signed URL next time
  await queue.process();
  expect(await queue.all()).toEqual([]);
});

test("a session another device started first: the waiting video follows the server's ids", async () => {
  const session = await paritySession();
  const [[pm]] = await session.database.query('SELECT id FROM programs_programsession WHERE name = ?', ['PM']);
  const rx = await session.database.query('SELECT id FROM programs_prescription WHERE session_id = ? ORDER BY "order"', [pm]);
  const transport: Transport = {
    ...offline,
    push: async (actions) =>
      actions.map((a) => ({
        id: a.id,
        status: 'done',
        result: a.name === 'session.start' ? { session_log_id: 'server-log', exercises: { [rx[0][0] as string]: 'server-se' } } : {},
      })),
  };
  let n = 0;
  const engine = makeSyncEngine({
    database: session.database,
    transport,
    who: () => session.profile,
    now: () => new Date(now),
    newId: () => `00000000-0000-7000-b000-${String(++n).padStart(12, '0')}`,
  });
  // The upload itself can't start (offline), so the row stays for us to look at.
  const queue = makeVideoQueue({ database: session.database, engine, api: server(() => Promise.reject(ApiError.offline())), files: memoryFiles });
  const stop = queue.start();
  await engine.enqueue(sessionStart, {
    session_log_id: 'phone-log',
    program_session_id: pm as string,
    exercises: rx.map(([id], i) => ({ id: `phone-se-${i}`, prescription_id: id as string })),
  });
  await queue.add('phone-log', 'phone-se-0', 'file:///c.mp4', 'video/mp4');
  await engine.sync();
  stop();
  expect(await session.database.query('SELECT session_log_id, session_exercise_id FROM uploads')).toEqual([['server-log', 'server-se']]);
});
