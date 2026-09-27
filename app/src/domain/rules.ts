/**
 * Rules the phone runs offline, ported from the backend (apps/workouts/history.py and
 * sessions.py, apps/accounts/units.py). Weights are decimal strings, and every rounding is
 * half-up at the same place as Python's Decimal, so both give the same answer: the cases in
 * shared/rules-cases.json are checked by pytest and by this module's tests.
 */
import Big from 'big.js';

export type Unit = 'kg' | 'lb';
export type LoadBasis = 'percent' | 'weight' | 'rpe' | 'bodyweight' | 'none';

const KG_PER_LB = new Big('0.45359237');
const PLATE_STEP: Record<Unit, Big> = { kg: new Big('0.5'), lb: new Big('2.5') };
const HALF_UP = 1; // Big.roundHalfUp

/** "80", "63.5", "101.25": whole numbers without decimals, others without trailing zeros. */
function tidy(value: Big): string {
  return value.eq(value.round(0, HALF_UP)) ? value.toFixed(0) : value.toString();
}

/** A kg value in `unit`: kg to 0.01, lb to 0.1 (units.from_kg). */
export function fromKg(kg: string, unit: Unit): string {
  const value = new Big(kg);
  return unit === 'lb' ? value.div(KG_PER_LB).round(1, HALF_UP).toFixed(1) : value.round(2, HALF_UP).toFixed(2);
}

/** Estimated one-rep max (Epley), kg to 0.01; null without a load or reps. */
export function e1rm(loadKg: string | null, reps: number | null): string | null {
  if (!loadKg || !reps || new Big(loadKg).eq(0)) return null;
  return new Big(loadKg).times(new Big(1).plus(new Big(reps).div(30))).round(2, HALF_UP).toFixed(2);
}

/** A kg value shown in `unit`, rounded once to the nearest plate step (display only). */
export function plateRound(kg: string, unit: Unit): string {
  const step = PLATE_STEP[unit];
  const value = unit === 'kg' ? new Big(kg) : new Big(kg).div(KG_PER_LB);
  return tidy(value.div(step).round(0, HALF_UP).times(step));
}

/**
 * The load to show for a set, in `unit`: a percentage of the working max rounded to the
 * nearest plate, or a fixed weight as prescribed. Null when there's nothing to suggest.
 */
export function suggestedLoad(basis: LoadBasis, value: string | null, maxKg: string | null, unit: Unit): string | null {
  if (value === null) return null;
  if (basis === 'percent') {
    if (!maxKg) return null;
    const kg = new Big(maxKg).times(value).div(100);
    return kg.eq(0) ? null : plateRound(kg.toString(), unit);
  }
  if (basis === 'weight') {
    return new Big(value).eq(0) ? null : tidy(new Big(fromKg(value, unit)));
  }
  return null;
}
