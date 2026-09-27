import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Athletes from '@/app/(coaching)/(tabs)/athletes/index';

import { body, useFakeApi, type Handler, type Route } from './testing/fake-api';

const maya = {
  athlete: { id: 'ath-1', name: 'Maya Torres' },
  email: 'maya@example.com',
  weight_class: '64 kg',
  competition_name: 'Nationals',
  competition_date: '2026-10-17',
  week: { id: 'w', label: 'Wk 3', week_type: { id: 't', name: 'Comp Prep', colour: '#D97706' } },
  compliance: 92,
  band: 'good',
  last: { id: 'l', date: '2026-09-26', name: 'Snatch + Back Squat' },
  readiness: '8',
  missing_metrics: 0,
  alerts: 2,
  top_alert: '“78 or 80 for the opener?”',
};
const marcus = { ...maya, athlete: { id: 'ath-2', name: 'Marcus Webb' }, week: null, compliance: 64, band: 'low', last: null, readiness: null, alerts: 0, top_alert: null, competition_name: '' };

const routes: Partial<Record<Route, Handler>> = {
  'GET /api/v1/roster': ({ params }) =>
    body('/api/v1/roster', 'get', params?.query?.q ? [maya] : params?.query?.sort === 'name' ? [marcus, maya] : [maya, marcus]),
  'GET /api/v1/invites': () =>
    body('/api/v1/invites', 'get', [
      { id: 'inv-1', email: '', link: 'https://gt.example/join/abc', created_at: '2026-09-20T10:00:00Z', expires_at: '2026-10-04T10:00:00Z', starting_template: null },
    ]),
  'GET /api/v1/invites/templates': () => body('/api/v1/invites/templates', 'get', [{ id: 'tpl-1', name: 'Technique Reset (3 wk)', kind: 'template' }]),
  'POST /api/v1/invites': ({ body: sent }) =>
    ({
      status: 201,
      body: {
        id: 'inv-2',
        email: (sent as { email: string }).email,
        email_sent: true,
        link: 'https://gt.example/join/xyz',
        created_at: '2026-09-27T10:00:00Z',
        expires_at: '2026-10-11T10:00:00Z',
        starting_template: 'Technique Reset (3 wk)',
      },
    }),
  'POST /api/v1/invites/{invite_id}/revoke': () => ({ status: 204 }),
};
let calls: ReturnType<typeof useFakeApi>;
beforeEach(() => {
  calls = useFakeApi(routes);
});

jest.mock('expo-router', () => ({ router: { push: jest.fn(), setParams: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.setTimeout(30_000);

const mockRouter = jest.requireMock('expo-router').router as { push: jest.Mock };

async function athletes() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={queries}>
      <Athletes />
    </QueryClientProvider>,
  );
  await screen.findByText('Maya Torres');
}

test('each athlete: class and competition, the week, last session, compliance and what needs looking at', async () => {
  await athletes();
  expect(screen.getByText('64 kg · Nationals — Sat 17 Oct')).toBeTruthy();
  expect(screen.getByText('Comp Prep · wk 3')).toBeTruthy();
  expect(screen.getByText('Sat 26 Sep · readiness 8/10')).toBeTruthy();
  expect(screen.getByText('92%')).toBeTruthy();
  expect(screen.getByText('“78 or 80 for the opener?” · +1 more')).toBeTruthy();
  expect(screen.getByText('no program this week')).toBeTruthy();
  await fireEvent.press(screen.getByRole('link', { name: 'Maya Torres, 2 to look at' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/athletes/[id]', params: { id: 'ath-1' } });
});

test('sorting and filtering ask the server', async () => {
  await athletes();
  await fireEvent.press(screen.getByRole('radio', { name: 'Name A–Z' }));
  await waitFor(() => expect(calls.some((c) => JSON.stringify(c.init).includes('"sort":"name"'))).toBe(true));
  await fireEvent.changeText(screen.getByLabelText('Filter athletes'), 'maya');
  await waitFor(() => expect(screen.queryByText('Marcus Webb')).toBeNull());
});

test('inviting by email, with a starting template; revoking a link', async () => {
  await athletes();
  expect(await screen.findByText('Link only')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '+ Invite athlete' }));
  await fireEvent.changeText(await screen.findByLabelText('Athlete email'), 'nia@example.com');
  await fireEvent.press(await screen.findByRole('radio', { name: 'Technique Reset (3 wk)' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Create invite' }));
  expect(await screen.findByText('We emailed nia@example.com a link. You can also share it yourself:')).toBeTruthy();
  expect(screen.getByText('https://gt.example/join/xyz')).toBeTruthy();
  expect(calls.find((c) => c.route === 'POST /api/v1/invites')?.init).toMatchObject({ body: { email: 'nia@example.com', starting_template_id: 'tpl-1' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Revoke' }));
  await waitFor(() => expect(calls.some((c) => c.route === 'POST /api/v1/invites/{invite_id}/revoke')).toBe(true));
});
