import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Messages from '@/app/(training)/(tabs)/messages';
import { SyncTestProvider } from '@/sync/provider';
import { upsert } from '@/sync/rows';
import { TrainingHeader } from '@/training/header';
import { now, paritySession } from '@/training/testing/parity-session';
import { TrainingProvider } from '@/training/use-training';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { router: { navigate: jest.fn(), push: jest.fn() }, useFocusEffect: (effect: () => () => void) => useEffect(effect, [effect]) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

// Whole screens on a real database: slower than a unit test, above all on CI's runners.
jest.setTimeout(30_000);

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(now), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

test('a message sent offline shows at once', async () => {
  const session = await paritySession();
  await render(
    <SyncTestProvider value={session}>
      <TrainingProvider>
        <Messages />
      </TrainingProvider>
    </SyncTestProvider>,
  );
  expect(await screen.findByText('No messages yet. Say hello to Dana.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Message Dana'), '  Knee feels better  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Knee feels better')).toBeTruthy();
  expect(screen.getByText('just now')).toBeTruthy();
  expect(session.engine.status.pending).toBe(1);
});

test("the coach's message is marked read once seen, and the badge goes", async () => {
  const session = await paritySession();
  const coaching = (await session.database.query("SELECT id FROM accounts_coaching WHERE status = 'active'"))[0][0] as string;
  await session.database.write(async (tx) => {
    await upsert(tx, 'messaging_thread', { id: 'thread-1', coaching_id: coaching, athlete_id: session.profile.athleteId, created_at: now });
    await upsert(tx, 'messaging_message', {
      id: 'm-1',
      thread_id: 'thread-1',
      athlete_id: session.profile.athleteId,
      sender_id: 'the-coach',
      body: 'Great squats today',
      sent_at: new Date(Date.parse(now) - 2 * 3600_000).toISOString(),
      read_at: null,
    });
  });
  const header = await render(
    <SyncTestProvider value={session}>
      <TrainingProvider>
        <TrainingHeader />
      </TrainingProvider>
    </SyncTestProvider>,
  );
  expect(await screen.findByRole('button', { name: 'Messages, 1 unread' })).toBeTruthy();
  await header.unmount();
  await render(
    <SyncTestProvider value={session}>
      <TrainingProvider>
        <Messages />
      </TrainingProvider>
    </SyncTestProvider>,
  );
  expect(await screen.findByText('Great squats today')).toBeTruthy();
  expect(screen.getByText('2h ago')).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy());
  expect(session.engine.status.pending).toBe(1); // message.read, waiting to be sent
});
