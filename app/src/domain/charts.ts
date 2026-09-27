/**
 * The numbers behind the athlete's charts (backend apps/workouts/charts.py): each lift's
 * e1RM per session with the bodyweight and week type then, the phase bands, and the change.
 * From the phone's own 12 months.
 */
import { exerciseHistory, bestE1rm } from './history';
import { fromKg } from './units';
import type { ExerciseRow, Id, World } from './world';
import { addDays, daysBetween } from './world';

export const CHART_POINTS = 12;

/** [date, e1rm kg, bodyweight kg or null, week type name or null], oldest first. */
export type Point = [string, string, string | null, string | null];

function weekTypeOn(world: World, date: string): string | null {
  const week = world.weeks.find((w) => w.start_date <= date && date <= addDays(w.start_date, 6));
  return week?.week_type_id ? (world.weekType.get(week.week_type_id)?.name ?? null) : null;
}

export function e1rmPoints(world: World, exerciseId: Id, limit = CHART_POINTS): Point[] {
  const entries = (exerciseHistory(world, { exerciseIds: [exerciseId], limit }).get(exerciseId) ?? [])
    .slice()
    .reverse()
    .map((e) => ({ e, value: bestE1rm(e.sets) }))
    .filter((x) => x.value);
  return entries.map(({ e, value }) => {
    const bw = [...world.bodyweights].reverse().find((b) => b.date <= e.date);
    return [e.date, value!, bw?.kg ?? null, weekTypeOn(world, e.date)];
  });
}

/** [week type, first index, last index]: runs of points in the same week type (none left out). */
export function phaseBands(points: Point[]): [string, number, number][] {
  const bands: [string, number, number][] = [];
  let i = 0;
  while (i < points.length) {
    const type = points[i][3];
    let j = i;
    while (j + 1 < points.length && points[j + 1][3] === type) j += 1;
    if (type !== null) bands.push([type, i, j]);
    i = j + 1;
  }
  return bands;
}

/** Python's round(): halves to even (2.5 is 2, 3.5 is 4). */
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export type Change = { change: number; drop: number; weeks: number };

/** How far the e1RM moved over the chart, in `unit`, and over how many weeks; null with fewer than two points. */
export function progressChange(world: World, exerciseId: Id): Change | null {
  const points = e1rmPoints(world, exerciseId);
  if (points.length < 2) return null;
  const unit = world.athlete.units;
  const [first, last] = [points[0], points[points.length - 1]].map((p) => Number(fromKg(p[1], unit)));
  const change = pyRound(last - first);
  const days = daysBetween(points[0][0], points[points.length - 1][0]);
  return { change, drop: Math.abs(change), weeks: Math.max(1, pyRound(days / 7)) };
}

/** Lifts worth charting: the gym's tracked lifts, then others logged with a load, by name. */
export function chartLifts(world: World): ExerciseRow[] {
  const tracked = world.tracked.map((t) => world.exercise.get(t.exercise_id)).filter((e): e is ExerciseRow => Boolean(e));
  const trackedIds = new Set(tracked.map((e) => e.id));
  const logged = exerciseHistory(world, { limit: 2 });
  const others = [...logged]
    .filter(([id, list]) => !trackedIds.has(id) && list.some((e) => bestE1rm(e.sets)))
    .map(([id]) => world.exercise.get(id))
    .filter((e): e is ExerciseRow => Boolean(e))
    .sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1));
  return [...tracked, ...others];
}

/** The lifts the Progress chart offers: those with at least two points. */
export function progressLifts(world: World): ExerciseRow[] {
  return chartLifts(world).filter((e) => e1rmPoints(world, e.id).length >= 2);
}
