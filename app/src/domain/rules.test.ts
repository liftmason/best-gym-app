import cases from '../../../shared/rules-cases.json';

import { e1rm, plateRound, suggestedLoad, type LoadBasis, type Unit } from './rules';

describe('the shared rules cases (also run by pytest)', () => {
  test.each(cases.e1rm)('e1RM of $load_kg kg x $reps', (c) => {
    expect(e1rm(c.load_kg, c.reps)).toBe(c.expected);
  });

  test.each(cases.plate_round)('plate rounding $kg kg in $unit', (c) => {
    expect(plateRound(c.kg, c.unit as Unit)).toBe(c.expected);
  });

  test.each(cases.suggested_load)('suggested load: $basis $value', (c) => {
    expect(suggestedLoad(c.basis as LoadBasis, c.value, c.max_kg, c.unit as Unit)).toBe(c.expected);
  });
});
