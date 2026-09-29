/**
 * A whole session through the real screens, offline, on the parity scenario: today's second
 * session, from the check-in to done. What the phone would then send is kept in
 * shared/offline-session.json, which the backend pushes to the real server on the same
 * scenario (backend/tests/unit/test_offline_parity.py): run with UPDATE_OFFLINE=1 to rewrite it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Checkin from '@/app/(training)/session/[log]/checkin';
import Done from '@/app/(training)/session/[log]/done';
import Finish from '@/app/(training)/session/[log]/finish';
import Session from '@/app/(training)/session/[log]/index';
import Player from '@/app/(training)/session/[log]/player';
import Summary from '@/app/(training)/session/[log]/summary';
import { SyncTestProvider } from '@/sync/provider';
import { now, paritySession } from '@/training/testing/parity-session';
import { startSession } from '@/training/start';
import { loadWorld } from '@/training/load';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    router: { replace: jest.fn(), push: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), navigate: jest.fn() },
    useLocalSearchParams: () => mockParams,
    Redirect: ({ href }: { href: unknown }) => <Text>{`redirect ${JSON.stringify(href)}`}</Text>,
  };
});
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
// Ids the phone makes, the same on every run.
let mockIds = 0;
jest.mock('@/domain/ids', () => ({ uuid7: () => `00000000-0000-7000-a000-${String(++mockIds).padStart(12, '0')}` }));
// Node's file access, for this test only (the app itself has no Node types).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFileSync, writeFileSync } = require('node:fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, text: string): void;
};
const OFFLINE_FILE = `${process.cwd()}/../shared/offline-session.json`;
jest.mock('expo-haptics', () => ({ impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const mockRouter = jest.requireMock('expo-router').router as Record<string, jest.Mock>;

// Whole screens on a real database: slower than a unit test, above all on CI's runners.
jest.setTimeout(30_000);

beforeEach(() => {
  mockIds = 0;
  Object.values(mockRouter).forEach((f) => f.mockClear());
  jest.useFakeTimers({ now: new Date(now), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

test('check-in, lifts, finish, done', async () => {
  const session = await paritySession();
  const world = await loadWorld(
    session.database,
    { id: session.profile.athleteId, units: 'kg', week_start: 0, max_updates: 'approve' },
    { today: '2026-09-24', now },
  );
  const pm = [...world.sessionsOfDay.values()].flat().find((s) => s.name === 'PM')!;
  expect(pm).toBeTruthy();
  const log = await startSession(session.engine, world, pm.id);
  const show = async (Screen: () => React.ReactElement | null, params: Record<string, string> = {}) => {
    mockParams = { log, ...params };
    const view = await render(
      <SyncTestProvider value={session}>
        <Screen />
      </SyncTestProvider>,
    );
    return view;
  };

  await show(Session);
  expect(await screen.findByText(/redirect .*checkin.*"n":"1"/)).toBeTruthy();

  let view = await show(Checkin, { n: '1' });
  await fireEvent.press(await screen.findByRole('radio', { name: '8 of 10' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenLastCalledWith({ pathname: '/session/[log]/checkin', params: { log, n: '2' } }));
  await view.unmount();

  view = await show(Checkin, { n: '2' });
  await fireEvent.press(await screen.findByRole('radio', { name: 'Legs are sore' }));
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Legs are sore' }).props.accessibilityState.checked).toBe(true));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenLastCalledWith({ pathname: '/session/[log]/summary', params: { log } }));
  await view.unmount();

  view = await show(Summary);
  expect(await screen.findByText('8 / 10')).toBeTruthy();
  expect(screen.getByText('2 exercises · Intensification week')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Start session →' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenLastCalledWith({ pathname: '/session/[log]/player', params: { log, n: '1' } }));
  await view.unmount();

  view = await show(Player, { n: '1' });
  expect(await screen.findByText('Push Press')).toBeTruthy();
  expect(screen.getByText('PRESS · first time')).toBeTruthy();
  expect(screen.getByLabelText('Set 1 load in kg').props.value).toBe('50');
  for (let set = 1; set <= 4; set += 1) {
    await fireEvent.press(screen.getByRole('checkbox', { name: `Mark set ${set} done` }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: `Mark set ${set} done` }).props.accessibilityState.checked).toBe(true));
  }
  await fireEvent.changeText(screen.getByLabelText('Set 4 reps'), '4');
  await fireEvent(screen.getByLabelText('Set 4 reps'), 'endEditing');
  await waitFor(() => expect(screen.getByLabelText('Set 4 reps').props.value).toBe('4'));
  await fireEvent.changeText(screen.getByLabelText('Set 3 reps'), '2.5');
  await fireEvent(screen.getByLabelText('Set 3 reps'), 'endEditing');
  expect(await screen.findByText("Set 3: Reps isn't a number.")).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Next exercise →' }));
  expect(mockRouter.replace).toHaveBeenLastCalledWith({ pathname: '/session/[log]/player', params: { log, n: '2' } });
  await view.unmount();

  view = await show(Player, { n: '2' });
  expect(await screen.findByText('Ab Wheel Rollout')).toBeTruthy();
  for (let set = 1; set <= 3; set += 1) {
    await fireEvent.press(screen.getByRole('checkbox', { name: `Mark set ${set} done` }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: `Mark set ${set} done` }).props.accessibilityState.checked).toBe(true));
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Finish session →' }));
  expect(mockRouter.replace).toHaveBeenLastCalledWith({ pathname: '/session/[log]/finish', params: { log } });
  await view.unmount();

  view = await show(Finish);
  expect(await screen.findByText('Session complete. Two quick questions')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Finish & save' }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Report an issue or pain' }));
  await fireEvent.changeText(await screen.findByLabelText('Where / what?'), 'Left wrist');
  await fireEvent.press(screen.getByRole('button', { name: 'Send to Dana' }));
  expect(await screen.findByText('Pain / possible injury')).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'RPE 8' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Finish & save' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenLastCalledWith({ pathname: '/session/[log]/done', params: { log } }));
  await view.unmount();

  await show(Done);
  expect(await screen.findByText('Session complete')).toBeTruthy();
  expect(screen.getByText('7/7')).toBeTruthy();
  expect(screen.getByText('Your results and notes have been shared with Dana.')).toBeTruthy();
  expect(session.engine.status.pending).toBeGreaterThan(10);

  // What the phone sends when it's back online.
  const outbox = (await session.database.query('SELECT id, name, at, payload FROM outbox ORDER BY seq')).map(
    ([id, name, at, payload]) => ({ id, name, at, payload: JSON.parse(payload as string) }),
  );
  const shown = { counts: [2, 7, 7], rpe: 8, answers: 2, issues: 1 };
  const text = `${JSON.stringify({ about: 'Written by app/src/training/session/flow.test.tsx (UPDATE_OFFLINE=1); pushed by backend/tests/unit/test_offline_parity.py.', log, shown, actions: outbox }, null, 1)}\n`;
  if (process.env.UPDATE_OFFLINE) writeFileSync(OFFLINE_FILE, text);
  expect(readFileSync(OFFLINE_FILE, 'utf8')).toBe(text);
});

test('a session finished long ago opens read only', async () => {
  const session = await paritySession();
  const world = await loadWorld(
    session.database,
    { id: session.profile.athleteId, units: 'kg', week_start: 0, max_updates: 'approve' },
    { today: '2026-09-24', now },
  );
  const monday = [...world.logs].reverse().find((l) => l.finished_at)!; // last week's Monday
  mockParams = { log: monday.id, n: '1' };
  await render(
    <SyncTestProvider value={session}>
      <Player />
    </SyncTestProvider>,
  );
  expect(await screen.findByText('Logged on Mon 14 Sep. Read only now.')).toBeTruthy();
  expect(screen.getByLabelText('Set 1 load in kg').props.editable).toBe(false);
});
