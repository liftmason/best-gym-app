import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useFakeApi } from '@/coaching/testing/fake-api';

import { NoCoachYet } from './no-coach';
import { StartCoaching } from './start-coaching';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/auth/me', () => ({
  ME: ['me'],
  useMe: () => ({ data: { name: 'Admin', email: 'spearw@gmail.com', coach: null, athlete: null } }),
}));
jest.mock('@/auth/mode', () => ({ ...jest.requireActual('@/auth/mode'), rememberMode: jest.fn(async () => {}) }));
jest.mock('@/auth/sign-out', () => ({ signOut: jest.fn() }));
const mockRouter = jest.requireMock('expo-router').router as Record<string, jest.Mock>;
const mockRememberMode = jest.requireMock('@/auth/mode').rememberMode as jest.Mock;
const fakeApi = useFakeApi; // not a React hook, despite its name

const STARTERS = [{ key: 'weightlifting', label: 'Weightlifting', description: 'The Olympic lifts and their accessories.' }];

async function show(screenToShow: React.ReactElement) {
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>
      {screenToShow}
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

test('"No coach yet" offers to start coaching', async () => {
  await show(<NoCoachYet email="spearw@gmail.com" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Start coaching' }));
  expect(mockRouter.push).toHaveBeenCalledWith('/start-coaching');
});

test('an existing account sets up its gym and opens coaching', async () => {
  const calls = fakeApi({
    'GET /api/v1/auth/signup/starters': () => ({ body: STARTERS }),
    'POST /api/v1/me/coach': () => ({ status: 201 }),
  });
  await show(<StartCoaching />);
  const name = await screen.findByLabelText('Your name');
  expect(name.props.value).toBe('Admin');
  await fireEvent.changeText(name, 'Will Spear');
  await fireEvent.changeText(screen.getByLabelText('Gym name'), 'Spear Barbell');
  await fireEvent.press(await screen.findByRole('button', { name: 'Create my gym' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/dashboard'));
  expect(mockRememberMode).toHaveBeenCalledWith('coaching');
  const sent = calls.find((c) => c.route === 'POST /api/v1/me/coach')!.init as { body: Record<string, unknown> };
  expect(sent.body).toMatchObject({ name: 'Will Spear', gym_name: 'Spear Barbell', units: 'kg', starter: 'weightlifting' });
});

test("a refusal is shown and nothing moves", async () => {
  fakeApi({
    'GET /api/v1/auth/signup/starters': () => ({ body: STARTERS }),
    'POST /api/v1/me/coach': () => ({
      status: 409,
      body: { error: { code: 'already_coaching', message: 'You already coach at Spear Barbell.', fields: {} } },
    }),
  });
  await show(<StartCoaching />);
  await fireEvent.changeText(await screen.findByLabelText('Gym name'), 'Spear Barbell');
  await fireEvent.press(await screen.findByRole('button', { name: 'Create my gym' }));
  expect(await screen.findByText('You already coach at Spear Barbell.')).toBeTruthy();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
