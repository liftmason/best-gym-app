/**
 * Weights are exact kg decimal strings; convert only at the edges (backend
 * apps/accounts/units.py). Rounding is half-up, at the same places as Python's Decimal.
 */
import { Big } from 'big.js';

export type Unit = 'kg' | 'lb';

export const KG_PER_LB = new Big('0.45359237');
export const HALF_UP = 1; // Big.roundHalfUp

/** Python's format(Decimal(x).normalize(), "f"): no trailing zeros, never an exponent. */
export function norm(value: Big | string): string {
  return new Big(value).toFixed();
}

/** A decimal string that is missing, empty, or zero counts as no load (Python's falsy Decimal). */
export function hasValue(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== '' && !new Big(value).eq(0);
}

export function toKg(value: string, unit: Unit): string {
  let kg = new Big(value);
  if (unit === 'lb') kg = kg.times(KG_PER_LB);
  return kg.round(2, HALF_UP).toFixed(2);
}

/** A kg value in `unit`: kg to 0.01, lb to 0.1. */
export function fromKg(kg: string, unit: Unit): string {
  const value = new Big(kg);
  return unit === 'lb' ? value.div(KG_PER_LB).round(1, HALF_UP).toFixed(1) : value.round(2, HALF_UP).toFixed(2);
}

/** "82.5 kg" or "181.9 lb", trailing zeros dropped; "" for no value. */
export function display(kg: string | null | undefined, unit: Unit): string {
  if (kg === null || kg === undefined) return '';
  return `${norm(fromKg(kg, unit))} ${unit}`;
}
