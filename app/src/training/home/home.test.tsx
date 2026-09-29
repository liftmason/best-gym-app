import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Home from '@/app/(training)/(tabs)/home';
import { SyncTestProvider } from '@/sync/provider';
import { now, paritySession } from '@/training/testing/parity-session';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

// Whole screens on a real database: slower than a unit test, above all on CI's runners.
jest.setTimeout(30_000);

beforeEach(() => {
  mockPush.mockClear();
  // Only the clock stands still (Thursday 24 September); timers and promises run as usual.
  jest.useFakeTimers({ now: new Date(now), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

async function home() {
  const session = await paritySession();
  await render(
    <SyncTestProvider value={session}>
      <Home />
    </SyncTestProvider>,
  );
  await screen.findByText('Wk 2 · Sep 21–27');
  return session;
}

test("the week opens on today: one session to resume, one to start", async () => {
  await home();
  expect(screen.getByText('Hi, Maya')).toBeTruthy();
  expect(screen.getByText('Comp Prep · wk 2 · Iron Ridge Weightlifting')).toBeTruthy();
  expect(screen.getAllByText("Today's session")).toHaveLength(1);
  expect(screen.getByText("Today's session · PM")).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Resume session →' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Start session →' })).toBeTruthy();
  expect(screen.getByText('6×2 @ 78% · RIR 1–2')).toBeTruthy();
  expect(screen.getByText('Paused session')).toBeTruthy(); // last Friday's
  expect(screen.getByText("Coach's focus this week")).toBeTruthy();
});

test('other days: done, still ahead, a rest day, and last week', async () => {
  await home();
  await fireEvent.press(screen.getByRole('button', { name: /Sat 2026-09-26/ }));
  expect(await screen.findByText('This session unlocks on Saturday.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /Tue 2026-09-22/ }));
  expect(await screen.findByText('Tuesday: rest day')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: /Wed 2026-09-23/ }));
  expect(await screen.findByRole('button', { name: 'Review or edit what you logged' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Previous week' }));
  expect(await screen.findByText('Wk 1 · Sep 14–20')).toBeTruthy();
});

test('starting a session queues it and opens it', async () => {
  const { engine } = await home();
  await fireEvent.press(screen.getByRole('button', { name: 'Start session →' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[log]', params: { log: expect.any(String) } });
  expect(engine.status.pending).toBe(1);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Resume session →' })).toHaveLength(2));
});

test('habits tick offline, today and yesterday', async () => {
  const { engine } = await home();
  const mobility = screen.getByRole('checkbox', { name: 'Mobility' });
  expect(mobility.props.accessibilityState.checked).toBe(false);
  await fireEvent.press(mobility);
  expect(await screen.findByText('2/3 done')).toBeTruthy();
  expect(engine.status.pending).toBe(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Forgot yesterday?' }));
  expect(await screen.findByText("Yesterday's habits")).toBeTruthy();
});
