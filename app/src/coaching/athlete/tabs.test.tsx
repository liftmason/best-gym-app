import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AthleteScreen from '@/app/(coaching)/(tabs)/athletes/[id]';
import Inbox from '@/app/(coaching)/(tabs)/inbox';

import { body, useFakeApi, type Handler, type Route } from '../testing/fake-api';

const athlete = body('/api/v1/athletes/{athlete_id}', 'get', {
  athlete: { id: 'ath-1', name: 'Maya Torres' },
  email: 'maya@example.com',
  units: 'kg',
  weight_class: '64 kg',
  competition_name: '',
  competition_date: null,
  joined_at: '2026-03-01T10:00:00Z',
  max_updates: 'approve',
  hide_history_before_link: false,
  metrics: [
    { key: 'bodyweight', label: 'Bodyweight', kind: 'weight', value: '63.8 kg', date: '2026-09-19', source: 'Athlete' },
    { key: 'lift_cj', label: 'Clean & Jerk 1RM', kind: 'weight', value: null, date: null, source: null },
  ],
  missing_metrics: ['lift_cj'],
  week: null,
  compliance: null,
  band: 'good',
  streak: 0,
});
const session = {
  id: 'log-1',
  date: '2026-09-21',
  name: 'Snatch + Back Squat',
  finished: true,
  status: 'done',
  logged_late: false,
  pr_day: true,
  readiness: '7',
  rpe: 8,
  comment: 'Snatch felt fast',
  week_type: { id: 't', name: 'Intensification', colour: '#1F4FD8' },
  warmup: { done: 1, total: 1 },
  answers: [{ question: 'How recovered do you feel today?', type: 'scale', value: '7', other: '' }],
  exercises: [{ name: 'Snatch', asked: '5×2 @ 75%', did: '4×2 @ 61.5 kg, 1×1 @ 85 kg', done_count: 5, planned: 5, e1rm: '88 kg', pr: true, deleted: false }],
  issues: [{ id: 'iss-1', kind: 'pain', text: 'Left wrist', created_at: '2026-09-21T18:00:00Z', resolved: false }],
  videos: [{ id: 'vid-1', exercise: 'Snatch', note: 'Hips?', created_at: '2026-09-21T18:00:00Z', available: true, reviewed: false, feedback: '' }],
};
const messages = [
  { id: 'm-2', sender: 'athlete', body: '78 or 80 for the opener?', sent_at: new Date(Date.now() - 600_000).toISOString(), read: false },
  { id: 'm-1', sender: 'coach', body: 'Great week', sent_at: new Date(Date.now() - 86_400_000 * 2).toISOString(), read: true },
];

const routes: Partial<Record<Route, Handler>> = {
  'GET /api/v1/athletes/{athlete_id}': () => athlete,
  'GET /api/v1/athletes/{athlete_id}/sessions': () => body('/api/v1/athletes/{athlete_id}/sessions', 'get', { items: [session], next: null }),
  'POST /api/v1/athletes/{athlete_id}/issues/{issue_id}/resolve': () => ({ status: 204 }),
  'GET /api/v1/athletes/{athlete_id}/videos/{video_id}': () => body('/api/v1/athletes/{athlete_id}/videos/{video_id}', 'get', { url: 'https://bucket.example/v.mp4', expires_in: 600 }),
  'POST /api/v1/athletes/{athlete_id}/videos/{video_id}/review': () => ({ status: 204 }),
  'GET /api/v1/athletes/{athlete_id}/metrics': () =>
    body('/api/v1/athletes/{athlete_id}/metrics', 'get', {
      metrics: athlete.body ? (athlete.body as { metrics: never }).metrics : [],
      history: [{ what: 'Bodyweight', value: '63.8 kg', date: '2026-09-19', source: 'Athlete' }],
    }),
  'GET /api/v1/athletes/{athlete_id}/prs': () =>
    body('/api/v1/athletes/{athlete_id}/prs', 'get', [{ set_id: 'set-9', exercise: 'Snatch', lift: '85 kg × 1', date: '2026-09-21', current_max: '82 kg' }]),
  'POST /api/v1/athletes/{athlete_id}/prs/{set_id}': () => ({ status: 204 }),
  'PUT /api/v1/athletes/{athlete_id}/max-updates': () => ({ status: 204 }),
  'PUT /api/v1/athletes/{athlete_id}/metrics/{key}': () => ({ status: 200, body: {} }),
  'POST /api/v1/athletes/{athlete_id}/remind-metrics': () => body('/api/v1/athletes/{athlete_id}/remind-metrics', 'post', { missing: ['lift_cj'] }),
  'GET /api/v1/athletes/{athlete_id}/messages': () => body('/api/v1/athletes/{athlete_id}/messages', 'get', { items: messages, next: null }),
  'POST /api/v1/athletes/{athlete_id}/messages/read': () => body('/api/v1/athletes/{athlete_id}/messages/read', 'post', { marked: 1 }),
  'POST /api/v1/athletes/{athlete_id}/messages': () => ({ status: 201, body: { id: 'm-3', sender: 'coach', body: '80', sent_at: new Date().toISOString(), read: false } }),
  'GET /api/v1/threads': () =>
    body('/api/v1/threads', 'get', [
      { athlete: { id: 'ath-1', name: 'Maya Torres' }, last_body: '78 or 80 for the opener?', last_at: new Date(Date.now() - 600_000).toISOString(), last_from: 'athlete', unread: 2 },
      { athlete: { id: 'ath-2', name: 'Jonas Kim' }, last_body: 'Great week', last_at: new Date(Date.now() - 86_400_000).toISOString(), last_from: 'coach', unread: 0 },
    ]),
};
let calls: ReturnType<typeof useFakeApi>;
let mockParams: Record<string, string> = {};
beforeEach(() => {
  calls = useFakeApi(routes);
});
const called = (route: Route) => calls.filter((c) => c.route === route);

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, setParams: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-video', () => {
  const { View } = jest.requireActual('react-native');
  return { useVideoPlayer: () => ({}), VideoView: () => <View accessibilityLabel="Video player" /> };
});
jest.mock('@/auth/me', () => ({ useMe: () => ({ data: { coach: { gym: { units: 'kg' } } } }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.setTimeout(30_000);
const mockRouter = jest.requireMock('expo-router').router as Record<string, jest.Mock>;

async function show(params: Record<string, string>, Screen: () => React.ReactElement | null = AthleteScreen) {
  mockParams = params;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={queries}>
      <Screen />
    </QueryClientProvider>,
  );
}

test('sessions: the whole session; resolving an issue; watching and reviewing a video', async () => {
  await show({ id: 'ath-1', tab: 'sessions', focus: 'video-vid-1' });
  expect(await screen.findByText('4×2 @ 61.5 kg, 1×1 @ 85 kg')).toBeTruthy();
  expect(screen.getByText('asked 5×2 @ 75% · 5/5 sets · e1RM 88 kg')).toBeTruthy();
  expect(screen.getByText('7 / 10')).toBeTruthy();
  expect(screen.getByText('“Snatch felt fast”')).toBeTruthy();
  expect(screen.getByText('Issue reported: Pain / possible injury')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Resolve' }));
  await waitFor(() => expect(called('POST /api/v1/athletes/{athlete_id}/issues/{issue_id}/resolve')).toHaveLength(1));
  await fireEvent.press(screen.getByRole('button', { name: 'Form video: Snatch. Watch and review' }));
  expect(await screen.findByLabelText('Video player')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Feedback for Maya (optional)'), 'Stay over it longer');
  await fireEvent.press(screen.getByRole('button', { name: 'Mark reviewed' }));
  await waitFor(() => expect(called('POST /api/v1/athletes/{athlete_id}/videos/{video_id}/review')[0]?.init).toMatchObject({ body: { feedback: 'Stay over it longer' } }));
});

test('metrics: deciding a PR, the max setting, editing a metric, a reminder', async () => {
  await show({ id: 'ath-1', tab: 'metrics', focus: 'prs' });
  expect(await screen.findByText('Session PRs')).toBeTruthy();
  expect(await screen.findByText('on Mon 21 Sep · working max 82 kg')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Use as working max' }));
  await waitFor(() => expect(called('POST /api/v1/athletes/{athlete_id}/prs/{set_id}')[0]?.init).toMatchObject({ body: { use: true } }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Update the max automatically' }));
  await waitFor(() => expect(called('PUT /api/v1/athletes/{athlete_id}/max-updates')[0]?.init).toMatchObject({ body: { value: 'auto' } }));
  await fireEvent.press(screen.getByRole('button', { name: 'Edit Clean & Jerk 1RM' }));
  await fireEvent.changeText(await screen.findByLabelText('Clean & Jerk 1RM (kg)'), '104');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(called('PUT /api/v1/athletes/{athlete_id}/metrics/{key}')[0]?.init).toMatchObject({ params: { path: { key: 'lift_cj' } }, body: { value: '104' } }));
  await fireEvent.press(screen.getByRole('button', { name: 'Remind athlete' }));
  expect(await screen.findByText('Reminder sent to Maya')).toBeTruthy();
});

test('messages: the thread oldest first, marked read when shown, and sending', async () => {
  await show({ id: 'ath-1', tab: 'messages' });
  expect(await screen.findByText('78 or 80 for the opener?')).toBeTruthy();
  expect(screen.getByText('10 min ago')).toBeTruthy();
  await waitFor(() => expect(called('POST /api/v1/athletes/{athlete_id}/messages/read')).toHaveLength(1));
  await fireEvent.changeText(screen.getByLabelText('Message Maya'), '  80  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(called('POST /api/v1/athletes/{athlete_id}/messages')[0]?.init).toMatchObject({ body: { body: '80' } }));
});

test('the inbox: latest first, with unread counts', async () => {
  await show({}, Inbox);
  expect(await screen.findByText('78 or 80 for the opener?')).toBeTruthy();
  expect(screen.getByText('You: Great week')).toBeTruthy();
  await fireEvent.press(screen.getByRole('link', { name: 'Maya Torres, 2 unread' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/athletes/[id]', params: { id: 'ath-1', tab: 'messages' } });
});
