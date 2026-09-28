/** Programming's lists, the exercise library, check-in questions and Settings, against a fake API. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ToastProvider } from '@/ui';

import { body, useFakeApi, type Handler, type Route } from '../testing/fake-api';
import { ExerciseLibrary } from './exercises';
import { TemplateList } from './lists';
import { QuestionsEditor } from './questions';
import { Settings } from './settings';

let mockBilling = false;
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/auth/me', () => ({
  ME: ['me'],
  useMe: () => ({
    data: {
      coach: {
        role: 'owner',
        gym: { units: 'kg' },
        entitlements: { billing_enabled: mockBilling, programming: true, form_videos: true, status: 'active', plan: { code: 'coach', name: 'Coach' }, athletes: { used: 7, max: 15 } },
      },
    },
  }),
}));
jest.mock('@/ui/confirm', () => ({ confirm: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.setTimeout(30_000);
const mockRouter = jest.requireMock('expo-router').router as Record<string, jest.Mock>;
const mockConfirm = jest.requireMock('@/ui/confirm').confirm as jest.Mock;

const fakeApi = useFakeApi; // not a React hook, despite its name
async function show(ui: ReactElement, routes: Partial<Record<Route, Handler>>) {
  const calls = fakeApi(routes);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={queries}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return calls;
}
const sent = (calls: ReturnType<typeof useFakeApi>, route: Route) => calls.filter((c) => c.route === route).map((c) => (c.init as { body?: unknown }).body);

const snatch = { id: 'ex-sn', name: 'Snatch', category: { id: 'c1', name: 'Snatch' }, measure: 'reps', tags: [], percent_of: null, youtube_url: '', cue: 'Bar close', warmup: false, archived: false, tracked: true };

beforeEach(() => {
  mockBilling = false;
  mockConfirm.mockClear();
});

test('a template goes to an athlete through their board', async () => {
  await show(<TemplateList kind="program" readOnly={false} />, {
    'GET /api/v1/templates': () =>
      body('/api/v1/templates', 'get', [
        { id: 'tpl-1', kind: 'program', name: '12-Week Competition Cycle', description: '', sessions_per_week: 3, stats: { weeks: 12, sessions: 35, slots: 120, tag_slots: 33, habits: 2, calendar_weeks: 12 }, exercises: [], used: 1, updated_at: '2026-09-20T10:00:00Z' },
      ]),
    'GET /api/v1/roster': () => body('/api/v1/roster', 'get', [{ athlete: { id: 'ath-1', name: 'Maya Torres' }, alerts: 0, band: 'good', competition_date: null, competition_name: '', compliance: 90, email: '', last: null, streak: 3, week: null, weight_class: '', next: null } as never]),
  });
  expect(await screen.findByText('12 weeks · 35 sessions · written for 3×/week · 33 tag slots · 2 habits')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Apply to athlete…' }));
  await fireEvent.press(await screen.findByText('Maya Torres'));
  expect(mockRouter.push).toHaveBeenCalledWith('/athletes/ath-1?tab=program&edit=1&apply=tpl-1');
});

test('a new exercise, with the server refusing a duplicate name', async () => {
  let attempt = 0;
  const calls = await show(<ExerciseLibrary readOnly={false} />, {
    'GET /api/v1/exercises': () => body('/api/v1/exercises', 'get', [snatch]),
    'GET /api/v1/tags': () => body('/api/v1/tags', 'get', []),
    'GET /api/v1/categories': () => body('/api/v1/categories', 'get', [{ id: 'c1', name: 'Snatch', exercises: 1 }]),
    'POST /api/v1/exercises': () =>
      ++attempt === 1
        ? { status: 400, body: { error: { code: 'invalid_exercise', message: 'Your library already has an exercise with this name.', fields: { name: 'Your library already has an exercise with this name.' } } } }
        : { status: 201, body: { ...snatch, id: 'ex-new', name: 'Tall Snatch', tracked: false } },
  });
  expect(await screen.findByText('Bar close')).toBeTruthy(); // the cue, under its name
  expect(screen.getByText('own max')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '+ New exercise' }));
  await fireEvent.changeText(await screen.findByLabelText('Name'), 'Snatch');
  await fireEvent.press(screen.getByRole('button', { name: /^Category:/ }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Snatch' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save exercise' }));
  expect(await screen.findByText('Your library already has an exercise with this name.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Name'), 'Tall Snatch');
  await fireEvent.press(screen.getByRole('button', { name: 'Save exercise' }));
  expect(await screen.findByText('“Tall Snatch” added to the library')).toBeTruthy();
  expect(sent(calls, 'POST /api/v1/exercises')[1]).toMatchObject({ name: 'Tall Snatch', category_id: 'c1', measure: 'reps', percent_of_id: null, tag_ids: [] });
});

test('archiving a tracked lift warns what it changes', async () => {
  await show(<ExerciseLibrary readOnly={false} />, {
    'GET /api/v1/exercises': () => body('/api/v1/exercises', 'get', [snatch]),
    'GET /api/v1/tags': () => body('/api/v1/tags', 'get', []),
    'POST /api/v1/exercises/{exercise_id}/archive': () => body('/api/v1/exercises/{exercise_id}/archive', 'post', { was_tracked: true, percent_users: 3 }),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Archive' }));
  expect(mockConfirm.mock.calls[0][1]).toContain("It's also a tracked lift");
  expect(await screen.findByText('“Snatch” archived and removed from tracked lifts — 3 exercises still take percentages from it')).toBeTruthy();
});

test('default questions: add one, and push them to every athlete', async () => {
  const calls = await show(<QuestionsEditor athlete={null} />, {
    'GET /api/v1/default-questions': () =>
      body('/api/v1/default-questions', 'get', [{ id: 'q1', type: 'choice', text: 'Anything affecting today’s session?', options: ['Nothing — all good', 'Poor sleep'], low_label: '', high_label: '', detail_label: '' }]),
    'POST /api/v1/default-questions': () => ({ status: 201, body: {} }),
    'POST /api/v1/push-default-questions': () => body('/api/v1/push-default-questions', 'post', { athletes: 7 }),
  });
  expect(await screen.findByText('Poor sleep')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '+ option' }));
  expect(await screen.findByText('Type the option first')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '+ short answer question' }));
  await waitFor(() => expect(sent(calls, 'POST /api/v1/default-questions')).toEqual([{ type: 'text' }]));
  await fireEvent.press(screen.getByRole('button', { name: 'Push defaults to all my athletes' }));
  expect(await screen.findByText('Default questions pushed to 7 athletes')).toBeTruthy();
});

test('settings save, and the plan shows only when billing is on', async () => {
  const saved = { gym_name: 'Iron Ridge Weightlifting', timezone: 'America/New_York', units: 'kg', week_start: 0, coach_title: 'Head coach', digest: true };
  const routes: Partial<Record<Route, Handler>> = {
    'GET /api/v1/settings': () => body('/api/v1/settings', 'get', saved),
    'PUT /api/v1/settings': () => body('/api/v1/settings', 'put', saved),
    'GET /api/v1/tracked-lifts': () => body('/api/v1/tracked-lifts', 'get', [{ id: 't1', exercise: { id: 'ex-sn', name: 'Snatch' } }]),
    'GET /api/v1/trackable-lifts': () => body('/api/v1/trackable-lifts', 'get', []),
    'GET /api/v1/week-types': () => body('/api/v1/week-types', 'get', []),
    'GET /api/v1/billing/plans': () => body('/api/v1/billing/plans', 'get', [{ code: 'coach', name: 'Coach', max_athletes: 15, max_coaches: 1, form_videos: true }, { code: 'gym', name: 'Gym', max_athletes: null, max_coaches: null, form_videos: true }]),
  };
  const calls = await show(<Settings />, routes);
  await fireEvent.press(await screen.findByRole('radio', { name: 'pounds' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByText('Settings saved')).toBeTruthy();
  expect(sent(calls, 'PUT /api/v1/settings')[0]).toMatchObject({ units: 'lb', week_start: 0 });
  expect(screen.queryByText('Plan')).toBeNull();
});

test('the owner sees the plan with Stripe’s buttons', async () => {
  mockBilling = true;
  await show(<Settings />, {
    'GET /api/v1/settings': () => body('/api/v1/settings', 'get', { gym_name: 'Iron Ridge', timezone: 'UTC', units: 'kg', week_start: 0, coach_title: '', digest: false }),
    'GET /api/v1/tracked-lifts': () => body('/api/v1/tracked-lifts', 'get', []),
    'GET /api/v1/trackable-lifts': () => body('/api/v1/trackable-lifts', 'get', []),
    'GET /api/v1/week-types': () => body('/api/v1/week-types', 'get', []),
    'GET /api/v1/billing/plans': () => body('/api/v1/billing/plans', 'get', [{ code: 'coach', name: 'Coach', max_athletes: 15, max_coaches: 1, form_videos: true }, { code: 'gym', name: 'Gym', max_athletes: null, max_coaches: null, form_videos: true }]),
  });
  expect(await screen.findByText('7 athletes of 15 · form videos included')).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Choose Gym' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Manage billing' })).toBeTruthy();
});
