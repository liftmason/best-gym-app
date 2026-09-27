import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button, Field, SetRow, WeekStrip, weekTypeColours } from '.';

test('a button calls back, and not while busy', async () => {
  const press = jest.fn();
  await render(<Button title="Save" onPress={press} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await screen.rerender(<Button title="Save" onPress={press} busy />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(press).toHaveBeenCalledTimes(1);
});

test('a field shows its error as an alert', async () => {
  await render(<Field label="Code" error="That code isn't right." />);
  expect(screen.getByRole('alert')).toHaveTextContent("That code isn't right.");
});

test('a set row reports edits and the tick', async () => {
  const change = jest.fn();
  const toggle = jest.fn();
  await render(
    <SetRow number={2} asked="2 @ 80 kg" unit="kg" values={{ load: '80', reps: '2', rir: '' }} done={false} onChange={change} onToggle={toggle} />,
  );
  await fireEvent.changeText(screen.getByLabelText('Set 2 reps'), '3');
  expect(change).toHaveBeenCalledWith({ load: '80', reps: '3', rir: '' });
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Set 2 done' }));
  expect(toggle).toHaveBeenCalled();
});

test('the week strip says what each day is', async () => {
  await render(<WeekStrip days={[{ date: '2026-09-24', weekday: 'Thu', state: 'planned', today: true, mark: '4 ex' }]} />);
  expect(screen.getByLabelText('Thu 2026-09-24, planned')).toBeTruthy();
});

test('week-type tints come close to the tints the mockup picked by hand', () => {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const [colour, mockup] of [
    ['#2E9E5B', '#DFF2E7'],
    ['#8A63D2', '#EDE6FA'],
  ]) {
    const light = channels(weekTypeColours(colour).light);
    channels(mockup).forEach((c, i) => expect(Math.abs(c - light[i])).toBeLessThanOrEqual(4));
  }
});
