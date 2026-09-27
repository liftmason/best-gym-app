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

test('a set row saves when a box is left or the set is ticked', async () => {
  const change = jest.fn();
  const commit = jest.fn();
  const values = { load: '80', reps: '2', time: '', rir: '' };
  await render(
    <SetRow number={2} unit="kg" measure="reps" timeUnit="s" values={values} placeholder="2" done={false} editable onChange={change} onCommit={commit} />,
  );
  await fireEvent.changeText(screen.getByLabelText('Set 2 reps'), '3');
  expect(change).toHaveBeenCalledWith({ ...values, reps: '3' });
  expect(commit).not.toHaveBeenCalled();
  await fireEvent(screen.getByLabelText('Set 2 reps'), 'endEditing');
  expect(commit).toHaveBeenCalledWith(values, false);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Mark set 2 done' }));
  expect(commit).toHaveBeenLastCalledWith(values, true);
});

test('a closed session is read only', async () => {
  const commit = jest.fn();
  await render(
    <SetRow number={1} unit="lb" measure="time" timeUnit="min" values={{ load: '', reps: '', time: '10', rir: '' }} placeholder="10 min" done editable={false} onChange={jest.fn()} onCommit={commit} />,
  );
  expect(screen.getByLabelText('Set 1 time in minutes').props.editable).toBe(false);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Mark set 1 done' }));
  expect(commit).not.toHaveBeenCalled();
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
