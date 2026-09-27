import { fireEvent, render, screen } from '@testing-library/react-native';

import Progress from '@/app/(training)/(tabs)/progress';
import { SyncTestProvider } from '@/sync/provider';
import { now, paritySession } from '@/training/testing/parity-session';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

beforeEach(() => {
  mockPush.mockClear();
  jest.useFakeTimers({ now: new Date(now), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

async function progress(units: 'kg' | 'lb' = 'kg') {
  const session = await paritySession({ units });
  await render(
    <SyncTestProvider value={session}>
      <Progress />
    </SyncTestProvider>,
  );
  await screen.findByText('Your progress');
}

test('a lift chart with its change, records, and recent sessions', async () => {
  await progress();
  expect(screen.getByText('Snatch e1RM')).toBeTruthy();
  expect(screen.getByText('▲ +28 kg / 1 wk')).toBeTruthy();
  expect(screen.getByLabelText('Snatch progress chart')).toBeTruthy();
  expect(screen.getByText('85 kg ×1')).toBeTruthy(); // the snatch PR
  expect(screen.getByText('Mon 21 Sep')).toBeTruthy();
  await fireEvent.press(screen.getByText('Mon 21 Sep'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[log]', params: { log: expect.any(String), review: '1' } });
});

test('another lift, and pounds', async () => {
  await progress('lb');
  await fireEvent.press(screen.getByRole('button', { name: 'Lift: Snatch. Change' }));
  await fireEvent.press(await screen.findByRole('radio', { name: 'Back Squat e1RM' }));
  expect(await screen.findByText('Back Squat e1RM')).toBeTruthy();
  expect(screen.getByText('▲ +32 lb / 1 wk')).toBeTruthy();
});
