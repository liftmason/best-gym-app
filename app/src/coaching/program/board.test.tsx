/** The program board, against a fake API typed by the real schema. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { localDate } from '@/domain/dates';
import { ToastProvider } from '@/ui';

import { body, useFakeApi, type Handler, type Route } from '../testing/fake-api';
import { board, week } from '../testing/board';
import { ProgramBoard } from './board';
import { weekOf } from './start';

let mockProgramming = true;
jest.mock('@/auth/me', () => ({
  useMe: () => ({
    data: { name: 'Dana', coach: { gym: { units: 'kg', timezone: 'America/New_York', week_start: 0 }, entitlements: { programming: mockProgramming } } },
  }),
}));
jest.mock('@/ui/confirm', () => ({ confirm: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.setTimeout(30_000);

const rail = body('/api/v1/athletes/{athlete_id}/rail', 'get', [
  { id: 'ex-power-clean', name: 'Power Clean', category: 'Clean & Jerk', tags: ['speed'], warmup: false, history: { line: '90 kg ×2 · 3 days ago', trend: 'up', series: [80, 85, 90], log: [{ date: '2026-09-24', top: '90 kg ×2' }] } },
]);
const snatchRx = body('/api/v1/athletes/{athlete_id}/prescriptions/{rx_id}', 'get', {
  id: 'rx-sn',
  exercise: { id: 'ex-snatch', name: 'Snatch' },
  summary: '6×2 @ 78%',
  suggested: '≈ 64 kg of Snatch max 82 kg',
  swaps: [{ id: 'ex-power-snatch', name: 'Power Snatch' }],
  dose: { sets: 6, rep_scheme: '2', load_basis: 'percent', load_value: '78', rir: '', note: '', warmup: false, section: '', section_note: '', superset: false, custom_fields: [], vary: false, set_rows: [] },
});

function routes(extra: Partial<Record<Route, Handler>> = {}): Partial<Record<Route, Handler>> {
  return {
    'GET /api/v1/athletes/{athlete_id}/program': () => body('/api/v1/athletes/{athlete_id}/program', 'get', board()),
    'GET /api/v1/athletes/{athlete_id}/rail': () => rail,
    'GET /api/v1/tags': () => body('/api/v1/tags', 'get', [{ id: 't1', name: 'speed' }]),
    'GET /api/v1/athletes/{athlete_id}/habits': () => body('/api/v1/athletes/{athlete_id}/habits', 'get', []),
    'GET /api/v1/athletes/{athlete_id}/apply/sources': () =>
      body('/api/v1/athletes/{athlete_id}/apply/sources', 'get', [{ id: 'tpl-1', kind: 'program', name: '12-Week Competition Cycle' }]),
    'GET /api/v1/athletes/{athlete_id}/prescriptions/{rx_id}': () => snatchRx,
    ...extra,
  };
}

const fakeApi = useFakeApi; // not a React hook, despite its name

async function show(extra: Partial<Record<Route, Handler>> = {}, applyTemplate?: string) {
  const calls = fakeApi(routes(extra));
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={queries}>
      <ToastProvider>
        <ProgramBoard id="ath-1" first="Maya" applyTemplate={applyTemplate} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return calls;
}

const sent = (calls: ReturnType<typeof useFakeApi>, route: Route) => calls.filter((c) => c.route === route).map((c) => (c.init as { body?: unknown }).body);

beforeEach(() => {
  mockProgramming = true;
});

test('with no program, a coach starts one from a week and a type', async () => {
  const calls = await show({
    'GET /api/v1/athletes/{athlete_id}/program': () => body('/api/v1/athletes/{athlete_id}/program', 'get', board({ program: null, weeks: [], week: null })),
    'POST /api/v1/athletes/{athlete_id}/program': () => ({ status: 201, body: board() }),
  });
  expect(await screen.findByText('Start a program for Maya')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Start program' }));
  expect(screen.getByText('Give the block a name of up to 80 characters.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Block name'), 'Autumn block');
  await fireEvent.press(screen.getByRole('button', { name: 'Start program' }));
  const thisWeek = weekOf(localDate(new Date().toISOString(), 'America/New_York'), 0);
  await waitFor(() =>
    expect(sent(calls, 'POST /api/v1/athletes/{athlete_id}/program')).toEqual([{ name: 'Autumn block', first_day: thisWeek, weeks: 4, week_type_id: 'wt-acc' }]),
  );
  expect(await screen.findByText('Started “Autumn block” with 4 weeks.')).toBeTruthy();
});

test('the week: its state, publishing, and the focus note', async () => {
  const calls = await show({
    'PATCH /api/v1/athletes/{athlete_id}/weeks/{week_id}': () => body('/api/v1/athletes/{athlete_id}/weeks/{week_id}', 'patch', week({ published: true })),
  });
  expect(await screen.findByText('Draft — not visible to Maya')).toBeTruthy();
  expect(screen.getByText('6×2 @ 78%')).toBeTruthy();
  expect(screen.getByRole('tab', { name: /^Wk 3, Comp Prep/ })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Publish to Maya' }));
  await waitFor(() => expect(sent(calls, 'PATCH /api/v1/athletes/{athlete_id}/weeks/{week_id}')).toEqual([{ published: true }]));
  expect(await screen.findByText('Wk 3 published — Maya sees it now, and later edits go live straight away')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Focus this week'), 'Openers Saturday');
  await fireEvent(screen.getByLabelText('Focus this week'), 'blur');
  await waitFor(() => expect(sent(calls, 'PATCH /api/v1/athletes/{athlete_id}/weeks/{week_id}')).toContainEqual({ focus_note: 'Openers Saturday' }));
});

test('adding from the library needs a day first', async () => {
  const calls = await show({
    'POST /api/v1/athletes/{athlete_id}/days/{day_id}/prescriptions': () => ({ status: 201, body: snatchRx.body }),
  });
  const add = await screen.findByRole('button', { name: 'Add Power Clean to the selected day' });
  await fireEvent.press(add);
  expect(await screen.findByText('Click a day on the board first')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Mon 21' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add Power Clean to Mon 21 Sep' }));
  await waitFor(() => expect(calls.find((c) => c.route === 'POST /api/v1/athletes/{athlete_id}/days/{day_id}/prescriptions')?.init).toMatchObject({ params: { path: { day_id: 'd0' } }, body: { exercise_id: 'ex-power-clean' } }));
  expect(await screen.findByText('Power Clean → Mon 21 Sep')).toBeTruthy();
});

test("editing a dose shows the server's message under the field", async () => {
  let attempt = 0;
  const calls = await show({
    'PUT /api/v1/athletes/{athlete_id}/prescriptions/{rx_id}': () =>
      ++attempt === 1
        ? { status: 400, body: { error: { code: 'invalid_dose', message: 'Enter a number (2) or a range (1-2), up to 10.', fields: { rir: 'Enter a number (2) or a range (1-2), up to 10.' } } } }
        : snatchRx,
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Edit Snatch, 6×2 @ 78%' }));
  expect(await screen.findByText('≈ 64 kg of Snatch max 82 kg')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('RIR target'), 'lots');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Enter a number (2) or a range (1-2), up to 10.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('RIR target'), '1-2');
  await fireEvent.changeText(screen.getByLabelText('Sets'), '5');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Snatch updated')).toBeTruthy();
  expect(sent(calls, 'PUT /api/v1/athletes/{athlete_id}/prescriptions/{rx_id}')[1]).toMatchObject({ sets: 5, rir: '1-2', load_basis: 'percent', load_value: '78', set_rows: [] });
});

test('removing from the editor closes it', async () => {
  const calls = await show({ 'DELETE /api/v1/athletes/{athlete_id}/prescriptions/{rx_id}': () => ({ status: 204 }) });
  await fireEvent.press(await screen.findByRole('button', { name: 'Edit Snatch, 6×2 @ 78%' }));
  await screen.findByText('≈ 64 kg of Snatch max 82 kg'); // loaded (the editor starts afresh when it is)
  await fireEvent.press(screen.getByRole('button', { name: 'Remove from day' }));
  expect(await screen.findByText('Removed Snatch from Sat')).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('≈ 64 kg of Snatch max 82 kg')).toBeNull());
  expect(sent(calls, 'DELETE /api/v1/athletes/{athlete_id}/prescriptions/{rx_id}')).toHaveLength(1);
});

test('undo, and moving a card through its menu', async () => {
  const calls = await show({
    'GET /api/v1/athletes/{athlete_id}/program': () => body('/api/v1/athletes/{athlete_id}/program', 'get', board({ week: week({ undo: 'Add Snatch' }) })),
    'POST /api/v1/athletes/{athlete_id}/weeks/{week_id}/undo': () => body('/api/v1/athletes/{athlete_id}/weeks/{week_id}/undo', 'post', { undone: 'Add Snatch' }),
    'POST /api/v1/athletes/{athlete_id}/prescriptions/{rx_id}/move': () => ({ status: 204 }),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Undo: Add Snatch' }));
  expect(await screen.findByText('Undone: Add Snatch')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'More for Snatch' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Move to…' }));
  await fireEvent.press(await screen.findByText('Thu (rest day)'));
  await waitFor(() =>
    expect(calls.find((c) => c.route === 'POST /api/v1/athletes/{athlete_id}/prescriptions/{rx_id}/move')?.init).toMatchObject({ params: { path: { rx_id: 'rx-sn' } }, body: { day_id: 'd3', index: 0 } }),
  );
});

test('applying a template: preview, then confirm', async () => {
  const preview = body('/api/v1/athletes/{athlete_id}/apply/preview', 'post', {
    choices: { template_id: 'tpl-1', days: [0, 2, 4], mode: 'recent', start: 'append', publish: false },
    placements: [{ value: 'append', label: 'After Wk 3 (append)' }],
    weeks: [{ label: 'Wk 4', start: '2026-09-28', week_type: null, days: [{ offset: 0, date: '2026-09-28', session: 'A — Snatch + Squat', exercises: [{ exercise: 'Snatch', summary: '6×2 @ 70%', tag_slot: false }] }] }],
    summary: { weeks: 1, sessions: 1, tag_slots: 0, habits: 0, replaced: 0, moved: 0, new_program: false },
    replaced: [],
    moved: [],
  });
  const calls = await show({
    'POST /api/v1/athletes/{athlete_id}/apply/preview': () => preview,
    'POST /api/v1/athletes/{athlete_id}/apply': () => ({ status: 201, body: { program_id: 'p1', first_week_id: 'w4', habits_added: 0 } }),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Add from template' }));
  expect(await screen.findByText(/^1 new week \(Wk 4\) at 3×\/week · 1 session · arrives unpublished/)).toBeTruthy();
  expect(screen.getByText('A — Snatch + Squat')).toBeTruthy(); // the dashed preview week
  expect(sent(calls, 'POST /api/v1/athletes/{athlete_id}/apply')).toEqual([]); // nothing written yet
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm apply' }));
  await waitFor(() => expect(sent(calls, 'POST /api/v1/athletes/{athlete_id}/apply')).toEqual([{ template_id: 'tpl-1', days: [0, 2, 4], mode: 'recent', start: 'append', publish: false }]));
  expect(await screen.findByText('“12-Week Competition Cycle” applied — from Wk 4, unpublished — review, then publish to Maya')).toBeTruthy();
});

test("opened from Programming's “Apply to athlete…”, the board starts in that template's preview", async () => {
  const calls = await show({ 'POST /api/v1/athletes/{athlete_id}/apply/preview': () => ({ status: 400, body: { error: { code: 'x', message: 'x', fields: {} } } }) }, 'tpl-9');
  expect(await screen.findByText('Previewing')).toBeTruthy();
  await waitFor(() => expect(sent(calls, 'POST /api/v1/athletes/{athlete_id}/apply/preview')[0]).toMatchObject({ template_id: 'tpl-9' }));
});

test('when the plan has lapsed, the board is read-only and says why', async () => {
  mockProgramming = false;
  await show();
  expect(await screen.findByText(/Your plan has lapsed, so programming is read-only/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Publish to Maya' }).props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.queryByRole('button', { name: /^Add Power Clean/ })).toBeNull();
});
