import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Today from '@/app/(coaching)/(tabs)/dashboard';

import { body, useFakeApi, type Route, type Handler } from './testing/fake-api';

const ATHLETE = { id: 'ath-1', name: 'Maya Torres' };
const routes: Partial<Record<Route, Handler>> = {
  'GET /api/v1/dashboard': () =>
    body('/api/v1/dashboard', 'get', {
      kpis: { active: 6, joined: 1, compliance: 87, compliance_change: 4, compliance_dir: 'up', sessions: 14, sessions_change: 2, sessions_dir: 'down', need_programming: 2 },
      today: [
        { athlete: ATHLETE, count: 4, done: false },
        { athlete: { id: 'ath-2', name: 'Jonas Kim' }, count: 0, done: false },
      ],
      recent: [{ id: 'log-1', athlete: ATHLETE, date: '2026-09-26', name: 'Snatch + Back Squat', rpe: 9, issues: 1 }],
      unread: 1,
    }),
  'GET /api/v1/feed': () =>
    body('/api/v1/feed', 'get', {
      items: [
        { id: 'n-1', kind: 'message', key: 'thread:t', athlete: ATHLETE, text: '“78 or 80 for the opener?”', created_at: new Date(Date.now() - 3600_000).toISOString(), read: false, link: '/athletes/ath-1?tab=messages&focus=latest' },
        { id: 'n-2', kind: 'pr', key: 'pr:x', athlete: ATHLETE, text: 'Snatch 85 kg beats the 82 kg max', created_at: new Date().toISOString(), read: true, link: '/athletes/ath-1?tab=metrics&focus=prs' },
      ],
      next: null,
    }),
  'POST /api/v1/feed/{notification_id}/read': () => ({ status: 204 }),
  'POST /api/v1/feed/clear-read': () => body('/api/v1/feed/clear-read', 'post', { cleared: 1 }),
};
let calls: ReturnType<typeof useFakeApi>;
beforeEach(() => {
  calls = useFakeApi(routes);
});
jest.mock('@/auth/me', () => ({
  useMe: () => ({ data: { name: 'Dana Whitfield', coach: { gym: { name: 'Iron Ridge', timezone: 'America/New_York' } } } }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.setTimeout(30_000);

const mockRouter = jest.requireMock('expo-router').router as { push: jest.Mock };

async function today() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={queries}>
      <Today />
    </QueryClientProvider>,
  );
  await screen.findByText('Needs your attention');
}

test('the numbers, the attention feed, today and recent sessions', async () => {
  await today();
  expect(screen.getByText(/, Dana$/)).toBeTruthy();
  expect(screen.getByText('87%')).toBeTruthy();
  expect(screen.getByText('▲ 4 pts')).toBeTruthy();
  expect(screen.getByText('▼ 2 vs last week')).toBeTruthy();
  expect(screen.getByText('▼ runs out < 7 days')).toBeTruthy();
  expect(await screen.findByText('“78 or 80 for the opener?”')).toBeTruthy();
  expect(screen.getByText('1h ago')).toBeTruthy();
  expect(screen.getByText('4 exercises')).toBeTruthy();
  expect(screen.getByText('rest day')).toBeTruthy();
  expect(screen.getByText('RPE 9')).toBeTruthy();
  expect(screen.getByLabelText('Issue reported')).toBeTruthy();
});

test('opening an item marks it read and goes to it; read ones can be cleared', async () => {
  await today();
  await fireEvent.press(await screen.findByRole('link', { name: /Unread message: Maya Torres/ }));
  expect(mockRouter.push).toHaveBeenCalledWith('/athletes/ath-1?tab=messages&focus=latest');
  await waitFor(() => expect(calls.some((c) => c.route === 'POST /api/v1/feed/{notification_id}/read')).toBe(true));
  await fireEvent.press(screen.getByRole('button', { name: 'Clear read' }));
  await waitFor(() => expect(calls.some((c) => c.route === 'POST /api/v1/feed/clear-read')).toBe(true));
});
