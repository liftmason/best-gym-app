/**
 * The athlete's training metrics (backend apps/accounts/metrics.py): bodyweight, height, the
 * gym's tracked lifts' maxes, and years training. Bodyweight and maxes are dated rows the
 * phone holds; height and years training come with the profile (/me).
 */
import { Big } from 'big.js';

import { currentMaxes } from './prs';
import type { World } from './world';

export type MetricKind = 'weight' | 'height' | 'years';
export type Spec = { key: string; label: string; kind: MetricKind; exerciseId: string | null };

export const LIFT_PREFIX = 'lift_';
export const YEARS: [string, string][] = [
  ['<1', '< 1'],
  ['1-3', '1–3'],
  ['3-5', '3–5'],
  ['5+', '5+'],
];
const SOURCE: Record<string, string> = { onboarding: 'Onboarding', athlete: 'Athlete', coach: 'Coach', session: 'Session' };
const LIMITS: Record<'bodyweight' | 'height_cm' | 'lift', [string, string, number]> = {
  bodyweight: ['20', '600', 2],
  height_cm: ['100', '250', 1],
  lift: ['1', '1000', 2],
};

export function metricSpecs(world: World): Spec[] {
  const lifts: Spec[] = world.tracked
    .map((t) => world.exercise.get(t.exercise_id))
    .filter((e) => e !== undefined)
    .map((e) => ({ key: `${LIFT_PREFIX}${e.id}`, label: `${e.name} 1RM`, kind: 'weight', exerciseId: e.id }));
  return [
    { key: 'bodyweight', label: 'Bodyweight', kind: 'weight', exerciseId: null },
    { key: 'height_cm', label: 'Height', kind: 'height', exerciseId: null },
    ...lifts,
    { key: 'years_training', label: 'Years training', kind: 'years', exerciseId: null },
  ];
}

export type Current = { key: string; label: string; kind: MetricKind; value: string | null; date: string | null; source: string | null };

/** Each metric and its value now (weights in kg); null when not provided. */
export function currentMetrics(world: World, profile: { heightCm: string | null; yearsTraining: string | null }): Current[] {
  const maxes = currentMaxes(world);
  const bw = world.bodyweights.length ? world.bodyweights[world.bodyweights.length - 1] : null;
  return metricSpecs(world).map((m) => {
    const base = { key: m.key, label: m.label, kind: m.kind };
    if (m.key === 'bodyweight') return { ...base, value: bw?.kg ?? null, date: bw?.date ?? null, source: bw ? SOURCE[(bw as { source?: string }).source ?? ''] ?? null : null };
    if (m.key === 'height_cm') return { ...base, value: profile.heightCm, date: null, source: null };
    if (m.key === 'years_training') {
      return { ...base, value: YEARS.find(([v]) => v === profile.yearsTraining)?.[1] ?? null, date: null, source: null };
    }
    const max = maxes.get(m.exerciseId!);
    return { ...base, value: max?.kg ?? null, date: max?.date ?? null, source: max ? (SOURCE[max.source] ?? null) : null };
  });
}

export class InvalidMetric extends Error {}

/** A value as entered, checked against the metric's limits; null for blank. */
export function cleanMetric(spec: { key: string; label: string; kind: string; lift: boolean }, raw: string | null): string | null {
  if (raw === null || String(raw).trim() === '') return null;
  if (spec.kind === 'years') {
    if (!YEARS.some(([v]) => v === raw)) throw new InvalidMetric("Pick how long they've been training.");
    return raw;
  }
  const text = String(raw).trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) throw new InvalidMetric('Enter a number.');
  const value = new Big(text);
  const [low, high, places] = LIMITS[spec.lift ? 'lift' : (spec.key as 'bodyweight' | 'height_cm')];
  if (value.lt(low) || value.gt(high)) throw new InvalidMetric(`${spec.label}: enter a value between ${low} and ${high}.`);
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  if (decimals > places) throw new InvalidMetric(`${spec.label}: at most ${places} decimal place${places !== 1 ? 's' : ''}.`);
  return text.replace(/^\+/, '');
}
