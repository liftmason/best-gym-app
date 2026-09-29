/** The template editor, against a fake API typed by the real schema. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ToastProvider } from '@/ui';

import { body, useFakeApi, type Handler, type Route } from '../testing/fake-api';
import { slotIndex, TemplateEditor } from './editor';
import type { Editor } from './queries';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/auth/me', () => ({ useMe: () => ({ data: { coach: { gym: { units: 'kg' }, entitlements: { programming: true } } } }) }));
jest.mock('@/ui/confirm', () => ({ confirm: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.setTimeout(30_000);
const mockRouter = jest.requireMock('expo-router').router as Record<string, jest.Mock>;

const ACC = { id: 'wt-acc', name: 'Accumulation', colour: '#2E9E5B' };
const slot = (id: string, name: string, extra = {}) => ({ id, kind: 'exercise', exercise: { id: `ex-${id}`, name }, tags: [], summary: '4×3 @ 70%', heading: '', heading_note: '', label: '', warmup: false, ...extra });
const editor: Editor = {
  id: 'tpl-1',
  kind: 'program',
  name: '12-Week Competition Cycle',
  description: '',
  program_note: '',
  sessions_per_week: 3,
  stats: { weeks: 1, sessions: 2, slots: 2, tag_slots: 1, habits: 0, calendar_weeks: 1 },
  weeks: [
    {
      id: 'tw-1',
      label: 'Week 1',
      focus_note: '',
      week_type: ACC,
      sessions: [
        { id: 'ts-a', name: 'A — Snatch + Squat', slots: [slot('sl-1', 'Snatch'), slot('sl-2', 'Romanian Deadlift', { kind: 'tag', tags: [{ id: 'tag-pc', name: 'posterior-chain' }] })] },
        { id: 'ts-b', name: 'B — Clean & Jerk', slots: [] },
      ],
    },
  ],
  habits: [],
};
const exercises = body('/api/v1/exercises', 'get', [
  { id: 'ex-sn', name: 'Snatch', category: { id: 'c1', name: 'Snatch' }, measure: 'reps', tags: [{ id: 'tag-sp', name: 'speed' }], percent_of: null, youtube_url: '', cue: '', warmup: false, archived: false, tracked: true },
  { id: 'ex-pc', name: 'Power Clean', category: { id: 'c2', name: 'Clean & Jerk' }, measure: 'reps', tags: [{ id: 'tag-sp', name: 'speed' }], percent_of: null, youtube_url: '', cue: '', warmup: false, archived: false, tracked: false },
]);
const snatchSlot = body('/api/v1/templates/{template_id}/slots/{slot_id}', 'get', {
  id: 'sl-1',
  kind: 'exercise',
  exercise: { id: 'ex-sn', name: 'Snatch' },
  tags: [],
  summary: '4×3 @ 70%',
  dose: { sets: 4, rep_scheme: '3', load_basis: 'percent', load_value: '70', rir: '', note: '', warmup: false, section: '', section_note: '', superset: false, custom_fields: [], vary: false, set_rows: [] },
});

const fakeApi = useFakeApi; // not a React hook, despite its name
async function show(extra: Partial<Record<Route, Handler>> = {}) {
  const calls = fakeApi({
    'GET /api/v1/templates/{template_id}': () => body('/api/v1/templates/{template_id}', 'get', editor),
    'GET /api/v1/exercises': () => exercises,
    'GET /api/v1/tags': () => body('/api/v1/tags', 'get', [{ id: 'tag-sp', name: 'speed' }]),
    'GET /api/v1/week-types': () => body('/api/v1/week-types', 'get', [{ ...ACC, description: '', archived: false, uses: 3 }]),
    'GET /api/v1/templates/{template_id}/slots/{slot_id}': () => snatchSlot,
    ...extra,
  });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={queries}>
      <ToastProvider>
        <TemplateEditor id="tpl-1" readOnly={false} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue('A — Snatch + Squat');
  return calls;
}
const sent = (calls: ReturnType<typeof useFakeApi>, route: Route) => calls.filter((c) => c.route === route).map((c) => c.init as { params?: { path?: object }; body?: unknown });

test('a moved slot counts positions without itself', () => {
  const session = editor.weeks[0].sessions[0];
  expect(slotIndex(session, 'sl-1', null)).toBe(1);
  expect(slotIndex(session, 'sl-2', 'sl-1')).toBe(0);
});

test('the summary, and adding exercises and tag slots to the selected session', async () => {
  const calls = await show({ 'POST /api/v1/templates/{template_id}/template-sessions/{template_session_id}/slots': () => ({ status: 201, body: editor }) });
  expect(screen.getByText('1 week · 2 sessions · 2 exercise slots · 1 tag-based · At 3×/week this runs 1 calendar week')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add Power Clean as a fixed exercise' }));
  expect(await screen.findByText('Select a session on the left first')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add an exercise to B — Clean & Jerk' }));
  expect(screen.getByText('Adding to Week 1 · B — Clean & Jerk')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add Power Clean as a fixed exercise' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Tag speed' }));
  await fireEvent.press(await screen.findByRole('button', { name: '+ Tag slot (2 qualify)' }));
  await waitFor(() =>
    expect(sent(calls, 'POST /api/v1/templates/{template_id}/template-sessions/{template_session_id}/slots')).toEqual([
      { params: { path: { template_id: 'tpl-1', template_session_id: 'ts-b' } }, body: { exercise_id: 'ex-pc', tag_ids: [] } },
      { params: { path: { template_id: 'tpl-1', template_session_id: 'ts-b' } }, body: { tag_ids: ['tag-sp'] } },
    ]),
  );
});

test("a slot's dose, with the server's message under its field", async () => {
  let attempt = 0;
  const calls = await show({
    'PUT /api/v1/templates/{template_id}/slots/{slot_id}': () =>
      ++attempt === 1 ? { status: 400, body: { error: { code: 'invalid_dose', message: 'Load: enter a percentage between 1 and 200.', fields: { load_value: 'Load: enter a percentage between 1 and 200.' } } } } : snatchSlot,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Edit Snatch, 4×3 @ 70%' }));
  await fireEvent.changeText(await screen.findByLabelText('Load (% of max)'), '300');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Load: enter a percentage between 1 and 200.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Load (% of max)'), '75');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Slot saved')).toBeTruthy();
  expect(sent(calls, 'PUT /api/v1/templates/{template_id}/slots/{slot_id}')[1].body).toMatchObject({ kind: 'exercise', exercise_id: 'ex-sn', dose: { load_value: '75' } });
});

test('adding a heavier week, and deleting the template', async () => {
  const calls = await show({
    'POST /api/v1/templates/{template_id}/weeks': () => ({ status: 201, body: editor }),
    'DELETE /api/v1/templates/{template_id}': () => ({ status: 204 }),
  });
  await fireEvent.changeText(screen.getByLabelText('Percentage points heavier'), '2.5');
  await fireEvent.press(screen.getByRole('button', { name: '+ Add week (copy of the last week)' }));
  expect(await screen.findByText('Week 2 added as a copy of the previous week, percentages +2.5')).toBeTruthy();
  expect(sent(calls, 'POST /api/v1/templates/{template_id}/weeks')[0].body).toEqual({ points: '2.5' });
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/programming?tab=templates'));
});
