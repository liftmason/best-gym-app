/**
 * A logged session (backend apps/workouts/sessions.py): what was asked for (the snapshot
 * frozen when it started), suggested loads, the player's steps, and the limits on what's
 * entered.
 */
import { Big } from 'big.js';

import { layout, type LaidOut } from './prescriptions';
import { plateRound, tidy } from './rules';
import { fromKg, type Unit } from './units';
import { instant, type SessionExerciseRow, type SetRow } from './world';

export const SNAPSHOT_VERSION = 1;
export const EDIT_WINDOW_MS = 24 * 3600 * 1000;
export const MAX_SET_NUMBER = 50;

export type Prescribed = {
  sets: number;
  rep_scheme: string;
  reps: number | null;
  duration_seconds: number | null;
  load_value: string | null;
  load_basis: string;
  rir: number | null;
  rir_max: number | null;
  note: string;
  custom_fields: { key: string; value: string }[];
  warmup: boolean;
  section: string;
  section_note: string;
  superset: boolean;
  overrides: { set_number: number; rep_scheme: string; reps: number | null; load_value: string | null }[];
  max_exercise: string | null;
  max_kg: string | null;
};

const dec = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

/** The snapshot as the rules read it; null for an exercise added without a plan. */
export function prescribed(se: Pick<SessionExerciseRow, 'prescribed'>): Prescribed | null {
  const data = (se.prescribed ?? {}) as Record<string, unknown>;
  if (!Object.keys(data).length) return null;
  const overrides = (data.set_overrides as Record<string, unknown>[] | undefined) ?? [];
  return {
    sets: (data.sets as number) || 1,
    rep_scheme: (data.rep_scheme as string) ?? '',
    reps: (data.reps as number | null) ?? null,
    duration_seconds: (data.duration_seconds as number | null) ?? null,
    load_value: dec(data.load_value),
    load_basis: (data.load_basis as string) ?? 'none',
    rir: (data.rir as number | null) ?? null,
    rir_max: (data.rir_max as number | null) ?? null,
    note: (data.note as string) ?? '',
    custom_fields: (data.custom_fields as Prescribed['custom_fields']) || [],
    warmup: Boolean(data.warmup),
    section: (data.section as string) ?? '',
    section_note: (data.section_note as string) ?? '',
    superset: Boolean(data.superset),
    overrides: overrides.map((o) => ({
      set_number: o.set_number as number,
      rep_scheme: (o.rep_scheme as string) ?? '',
      reps: (o.reps as number | null) ?? null,
      load_value: dec(o.load_value),
    })),
    max_exercise: (data.max_exercise as string | null) ?? null,
    max_kg: dec(data.max_kg),
  };
}

/** The kg a set is worked at: a % of the snapshot's max, or a fixed weight; else null. */
export function targetKg(p: Prescribed, loadValue: string | null): string | null {
  if (loadValue === null) return null;
  if (p.load_basis === 'percent') {
    return p.max_kg && !new Big(p.max_kg).eq(0) ? new Big(p.max_kg).times(loadValue).div(100).toFixed() : null;
  }
  if (p.load_basis === 'weight') return loadValue;
  return null;
}

/** The load to show for a set in `unit`: a % plate-rounded, a fixed weight as prescribed. */
export function suggestedLoad(p: Prescribed, loadValue: string | null, unit: Unit): string | null {
  const kg = targetKg(p, loadValue);
  if (!kg || new Big(kg).eq(0)) return null;
  if (p.load_basis === 'percent') return plateRound(kg, unit);
  return tidy(new Big(fromKg(kg, unit)));
}

/** 'Snatch + Back Squat + 2 more' for a session with no name. */
export function sessionName(names: string[]): string {
  const text = names.slice(0, 2).join(' + ');
  return text + (names.length > 2 ? ` + ${names.length - 2} more` : '');
}

/** Sets asked for; 0 for a warm-up drill (ticked off, not logged). */
export function plannedSets(se: Pick<SessionExerciseRow, 'prescribed' | 'warmup'>): number {
  const p = prescribed(se);
  if (p === null || se.warmup) return 0;
  return p.overrides.length || p.sets;
}

export type Step = {
  warmup: boolean;
  items: SessionExerciseRow[];
  labels: string[];
  section: string;
  section_note: string;
};

/** The player's screens: the warm-up checklist, then one per exercise (a superset's together). */
export function steps(exercises: SessionExerciseRow[]): Step[] {
  const [warmups, entries] = layout(exercises, (se) => {
    const p = prescribed(se);
    return { warmup: se.warmup, superset: Boolean(p?.superset), section: p?.section ?? '', section_note: p?.section_note ?? '' };
  });
  const result: Step[] = [];
  if (warmups.length) result.push({ warmup: true, items: warmups, labels: [], section: '', section_note: '' });
  for (const e of entries as LaidOut<SessionExerciseRow>[]) {
    if (!e.first) {
      result[result.length - 1].items.push(e.item);
      result[result.length - 1].labels.push(e.label);
      continue;
    }
    result.push({
      warmup: false,
      items: [e.item],
      labels: e.label ? [e.label] : [],
      section: e.section,
      section_note: e.section_note,
    });
  }
  return result;
}

/** A warm-up is done once every drill is ticked; an exercise once its planned sets are. */
export function stepDone(step: Step, setsOf: (se: SessionExerciseRow) => SetRow[]): boolean {
  if (step.warmup) return step.items.every((se) => se.checked_at !== null);
  return step.items.every((se) => setsOf(se).filter((s) => s.done).length >= Math.max(plannedSets(se), 1));
}

/** Paused sessions can always be continued; finished ones for 24 hours. */
export function editable(log: { finished_at: string | null }, now: string): boolean {
  if (log.finished_at === null) return true;
  return instant(now) < instant(log.finished_at) + EDIT_WINDOW_MS;
}
