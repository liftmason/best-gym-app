/** Height in feet and inches on the screens that show or take it (src/domain/height.ts). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { Metrics } from '@/coaching/athlete/metrics';
import { useFakeApi } from '@/coaching/testing/fake-api';
import type { Current } from '@/domain/metrics';
import { MetricSheet, shown } from '@/training/profile/metric-sheet';

jest.mock('@/coaching/library/questions', () => ({ QuestionsEditor: () => null }));
const fakeApi = useFakeApi; // not a React hook, despite its name

const HEIGHT: Current = { key: 'height_cm', label: 'Height', kind: 'height', value: '177.8', date: null, source: null };

test("the athlete's profile shows height in the athlete's units", () => {
  expect(shown(HEIGHT, 'lb')).toBe('5 ft 10 in');
  expect(shown(HEIGHT, 'kg')).toBe('177.8 cm');
});

test('an athlete using pounds enters feet and inches, and centimetres are saved', async () => {
  const engine = { enqueue: jest.fn(async () => {}) };
  const onClose = jest.fn();
  await render(<MetricSheet metric={HEIGHT} unit="lb" engine={engine as never} onClose={onClose} />);
  await fireEvent.changeText(screen.getByLabelText('Feet'), '5');
  await fireEvent.changeText(screen.getByLabelText('Inches'), '12');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Inches: enter 0 to 11.')).toBeTruthy();
  expect(engine.enqueue).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Inches'), '11');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(engine.enqueue).toHaveBeenCalledWith(expect.anything(), { values: { height_cm: '180.3' } });
});

async function coachTab(unit: 'kg' | 'lb') {
  const calls = fakeApi({
    'GET /api/v1/athletes/{athlete_id}/metrics': () => ({
      body: { history: [], metrics: [{ key: 'height_cm', label: 'Height', kind: 'height', value: '177.8', date: null, source: null }] },
    }),
    'PUT /api/v1/athletes/{athlete_id}/metrics/{key}': () => ({ status: 204 }),
  });
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>
      <Metrics id="a1" first="Maya" unit={unit} maxUpdates="auto" />
    </QueryClientProvider>,
  );
  return calls;
}

test("the coach sees and edits height in the gym's units", async () => {
  const calls = await coachTab('lb');
  expect(await screen.findByText('5 ft 10 in')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit Height' }));
  await fireEvent.changeText(screen.getByLabelText('Feet'), '6');
  await fireEvent.changeText(screen.getByLabelText('Inches'), '0');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(calls.some((c) => c.route === 'PUT /api/v1/athletes/{athlete_id}/metrics/{key}')).toBe(true));
  const put = calls.find((c) => c.route === 'PUT /api/v1/athletes/{athlete_id}/metrics/{key}')!;
  expect((put.init as { body: unknown }).body).toEqual({ value: '182.9' });
});

test('a gym using kilograms shows height in centimetres', async () => {
  await coachTab('kg');
  expect(await screen.findByText('177.8 cm')).toBeTruthy();
});
