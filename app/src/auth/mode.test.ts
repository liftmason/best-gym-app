import { modeFor } from './mode';

const coach = {} as never;
const athlete = {} as never;

test('one profile decides the mode; with both, the last one used (coaching at first)', () => {
  expect(modeFor({ coach, athlete: null }, 'training')).toBe('coaching');
  expect(modeFor({ coach: null, athlete }, 'coaching')).toBe('training');
  expect(modeFor({ coach, athlete }, null)).toBe('coaching');
  expect(modeFor({ coach, athlete }, 'training')).toBe('training');
  expect(modeFor({ coach: null, athlete: null }, null)).toBeNull();
});
