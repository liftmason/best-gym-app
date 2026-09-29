import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Profile from '@/app/(training)/(tabs)/profile';
import Welcome from '@/app/(training)/welcome';
import { SyncTestProvider } from '@/sync/provider';
import { now, paritySession } from '@/training/testing/parity-session';
import { TrainingProvider } from '@/training/use-training';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { navigate: jest.fn(), push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
// Online settings: this phone is offline.
jest.mock('@/api', () => {
  const actual = jest.requireActual('@/api');
  const offline = () => Promise.reject(actual.ApiError.offline());
  return { ...actual, api: { ...actual.api, client: { GET: offline, PUT: offline, POST: offline } } };
});
jest.mock('@/auth/me', () => ({
  ME: ['me'],
  useMe: () => ({ data: undefined, refetch: () => {} }),
}));

const mockRouter = jest.requireMock('expo-router').router as Record<string, jest.Mock>;

// Whole screens on a real database: slower than a unit test, above all on CI's runners.
jest.setTimeout(30_000);

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(now), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

async function show(Screen: () => React.ReactElement | null, profile: { units?: 'kg' | 'lb' } = {}) {
  const session = await paritySession(profile);
  // No retries, and no garbage-collection timer to keep Jest waiting after the test.
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={queries}>
      <SyncTestProvider value={session}>
        <TrainingProvider>
          <Screen />
        </TrainingProvider>
      </SyncTestProvider>
    </QueryClientProvider>,
  );
  return session;
}

test('the training numbers, edited offline', async () => {
  const { engine } = await show(Profile);
  expect(await screen.findByText('82 kg')).toBeTruthy(); // snatch 1RM
  expect(screen.getByText('168.5 cm')).toBeTruthy();
  expect(screen.getByText('3–5')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Bodyweight: 63.8 kg. Change' }));
  await fireEvent.changeText(await screen.findByLabelText('Bodyweight (kg)'), '65.4');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('65.4 kg')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Height: 168.5 cm. Change' }));
  await fireEvent.changeText(await screen.findByLabelText('Height (cm)'), '1700');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Height: enter a value between 100 and 250.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Height (cm)'), '170');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('170 cm')).toBeTruthy(); // from the outbox until /me catches up
  expect(engine.status.pending).toBe(2);
  expect(await screen.findByText('This needs a connection.')).toBeTruthy(); // devices, offline
});

test('onboarding after an invite: some numbers, some skipped', async () => {
  const { engine } = await show(Welcome);
  expect(await screen.findByText('Your training numbers')).toBeTruthy();
  expect(screen.getByText('Dana Whitfield at Iron Ridge Weightlifting')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Bodyweight (kg)'), '64');
  await fireEvent.press(screen.getByRole('button', { name: 'Skip Height' }));
  expect(screen.getByRole('button', { name: 'Height skipped' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: '1–3' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText("You're all set")).toBeTruthy();
  expect(screen.getByText('Dana has your details (4 fields left blank, so your coach can fill them in).')).toBeTruthy();
  expect(engine.status.pending).toBe(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Show me my week →' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/home'));
});

test('onboarding in pounds takes height in feet and inches, and stores centimetres', async () => {
  const { engine } = await show(Welcome, { units: 'lb' });
  const queued = jest.spyOn(engine, 'enqueue');
  expect(await screen.findByText('Your training numbers')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Feet'), '5');
  await fireEvent.changeText(screen.getByLabelText('Inches'), '10');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText("You're all set")).toBeTruthy();
  expect(queued).toHaveBeenCalledWith(expect.anything(), { values: { height_cm: '177.8' } });
});
