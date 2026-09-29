/**
 * Height in feet and inches, for athletes and gyms that use pounds. Height is stored in
 * centimetres (the backend's `height_cm`, 100 to 250), so this only converts for showing and
 * entering it, the way weights are stored in kg.
 */
import { Big } from 'big.js';

import { InvalidMetric } from './metrics';
import { norm, type Unit } from './units';

const CM_PER_INCH = new Big('2.54');
// The backend's limits, 100 to 250 cm, in whole inches that fit inside them.
const LOWEST = 40; // 3 ft 4 in (101.6 cm)
const HIGHEST = 98; // 8 ft 2 in (248.9 cm)

const feetInches = (total: number) => `${Math.floor(total / 12)} ft ${total % 12} in`;

export function showHeight(cm: string, unit: Unit): string {
  if (unit === 'kg') return `${norm(cm)} cm`;
  return feetInches(Number(new Big(cm).div(CM_PER_INCH).round(0)));
}

/** Centimetres, to a tenth, from feet and inches as typed; null when both are blank. */
export function heightFromFeet(feet: string, inches: string): string | null {
  const [f, i] = [feet.trim(), inches.trim()];
  if (!f && !i) return null;
  if (!/^\d+$/.test(f || '0')) throw new InvalidMetric('Feet: enter a whole number.');
  if (!/^\d+(\.\d)?$/.test(i || '0') || Number(i || '0') >= 12) throw new InvalidMetric('Inches: enter 0 to 11.');
  const total = new Big(f || '0').times(12).plus(i || '0');
  if (total.lt(LOWEST) || total.gt(HIGHEST)) {
    throw new InvalidMetric(`Height: enter between ${feetInches(LOWEST)} and ${feetInches(HIGHEST)}.`);
  }
  return total.times(CM_PER_INCH).round(1).toFixed(1);
}
