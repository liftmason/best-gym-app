import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AthleteScreen from '@/app/(coaching)/(tabs)/athletes/[id]';

import { body, useFakeApi, type Handler, type Route } from '../testing/fake-api';

const COMP = { id: 't', name: 'Comp Prep', colour: '#D97706' };
const ACC = { id: 'a', name: 'Accumulation', colour: '#2E9E5B' };
const header = body('/api/v1/athletes/{athlete_id}', 'get', {
  athlete: { id: 'ath-1', name: 'Maya Torres' },
  email: 'maya@example.com',
  units: 'kg',
  weight_class: '64 kg',
  competition_name: 'Nationals',
  competition_date: '2026-10-17',
  joined_at: '2026-03-01T10:00:00Z',
  max_updates: 'approve',
  hide_history_before_link: false,
  metrics: [
    { key: 'bodyweight', label: 'Bodyweight', kind: 'weight', value: '63.8 kg', date: '2026-09-19', source: 'Athlete' },
    { key: 'lift_sn', label: 'Snatch 1RM', kind: 'weight', value: '82 kg', date: '2026-07-26', source: 'Coach' },
    { key: 'lift_cj', label: 'Clean & Jerk 1RM', kind: 'weight', value: null, date: null, source: null },
  ],
  missing_metrics: ['lift_cj'],
  week: { id: 'w', label: 'Wk 3', week_type: COMP },
  compliance: 92,
  band: 'good',
  streak: 9,
});
const overview = (lift: string) =>
  body('/api/v1/athletes/{athlete_id}/overview', 'get', {
    chart: {
      lift: lift === 'cj' ? { id: 'cj', name: 'Clean & Jerk' } : { id: 'sn', name: 'Snatch' },
      lifts: [
        { id: 'sn', name: 'Snatch' },
        { id: 'cj', name: 'Clean & Jerk' },
      ],
      points: [
        { date: '2026-09-14', e1rm: 59.7, bodyweight: 64.2, week_type: ACC },
        { date: '2026-09-21', e1rm: 87.8, bodyweight: 63.8, week_type: COMP },
      ],
      bands: [
        { week_type: ACC, first: 0, last: 0 },
        { week_type: COMP, first: 1, last: 1 },
      ],
      change: lift === 'cj' ? null : { change: 28, drop: 28, weeks: 1 },
    },
    weekly: [
      { week_start: '2026-09-14', volume: 3.4, compliance: 67 },
      { week_start: '2026-09-21', volume: 4.1, compliance: 100 },
    ],
    checkins: [{ session_id: 's1', date: '2026-09-24', name: 'Snatch + Back Squat', readiness: '7', choice: 'Legs are sore', rpe: 8 }],
    week: [
      { date: '2026-09-21', label: '✓ done', today: false },
      { date: '2026-09-22', label: 'rest', today: false },
      { date: '2026-09-24', label: '2 ex', today: true },
    ],
    top_prs: [{ name: 'Snatch', heaviest: '85 kg ×1', ago: '3 days ago' }],
  });

const routes: Partial<Record<Route, Handler>> = {
  'GET /api/v1/athletes/{athlete_id}': () => header,
  'GET /api/v1/athletes/{athlete_id}/overview': ({ params }) => overview(String(params?.query?.lift ?? 'sn')),
  'POST /api/v1/athletes/{athlete_id}/archive': () => ({ status: 204 }),
};
let calls: ReturnType<typeof useFakeApi>;
let mockParams: Record<string, string> = {};
beforeEach(() => {
  calls = useFakeApi(routes);
  mockParams = { id: 'ath-1' };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, setParams: jest.fn((p: Record<string, string>) => Object.assign(mockParams, p)) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/auth/me', () => ({ useMe: () => ({ data: { coach: { gym: { units: 'kg' } } } }) }));
jest.mock('@/ui/confirm', () => ({ confirm: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.setTimeout(30_000);

const mockRouter = jest.requireMock('expo-router').router as Record<string, jest.Mock>;

async function show() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <QueryClientProvider client={queries}>
      <AthleteScreen />
    </QueryClientProvider>,
  );
  await screen.findByText('Comp Prep · wk 3');
  return view;
}

test('the header and the overview', async () => {
  await show();
  expect(screen.getByText('64 kg · next comp: Nationals — Sat 17 Oct')).toBeTruthy();
  expect(screen.getByText('9-session streak')).toBeTruthy();
  expect(screen.getByText('82 kg')).toBeTruthy();
  expect(screen.getByText('92%')).toBeTruthy();
  expect(await screen.findByText('▲ +28 kg / 1 wk')).toBeTruthy();
  expect(screen.getByLabelText('Snatch progress chart')).toBeTruthy();
  expect(screen.getByLabelText('Weekly volume and compliance, last 2 weeks')).toBeTruthy();
  expect(screen.getByText('Readiness 7/10 · “Legs are sore”')).toBeTruthy();
  expect(screen.getByText('2 ex')).toBeTruthy();
  expect(screen.getByText('85 kg ×1 · 3 days ago')).toBeTruthy(); // a lifetime PR
  await fireEvent.press(screen.getByRole('radio', { name: 'Clean & Jerk' }));
  expect(await screen.findByLabelText('Clean & Jerk progress chart')).toBeTruthy();
  expect(calls.some((c) => JSON.stringify(c.init).includes('"lift":"cj"'))).toBe(true);
});

test('the program tab says where programming is; archiving asks first', async () => {
  const view = await show();
  await fireEvent.press(screen.getByRole('tab', { name: 'Program' }));
  await view.rerender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>
      <AthleteScreen />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Programming is on a computer for now')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'More actions' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Archive athlete' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/athletes'));
  expect(calls.some((c) => c.route === 'POST /api/v1/athletes/{athlete_id}/archive')).toBe(true);
});
