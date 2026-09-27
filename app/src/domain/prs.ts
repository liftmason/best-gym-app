/**
 * When a session beats a working max (backend apps/workouts/prs.py): the heaviest load done
 * for at least one rep, above the latest max of that exercise, on or after that max's date.
 */
import { Big } from 'big.js';

import { hasValue } from './units';
import type { Id, LogRow, MaxRow, SetRow, World } from './world';

/** The latest max per exercise (by date, then id, newest first). */
export function currentMaxes(world: World): Map<Id, MaxRow> {
  const latest = new Map<Id, MaxRow>();
  for (const m of world.maxes) if (!latest.has(m.exercise_id)) latest.set(m.exercise_id, m);
  return latest;
}

function best(sets: SetRow[]): SetRow | null {
  let found: SetRow | null = null;
  for (const s of sets) {
    if (!(s.done && hasValue(s.load_kg) && (s.reps ?? 0) >= 1 && !s.max_dismissed)) continue;
    const load = new Big(s.load_kg);
    if (!found || load.gt(found.load_kg!) || (load.eq(found.load_kg!) && (s.reps ?? 0) > (found.reps ?? 0))) found = s;
  }
  return found;
}

export type Candidate = { set: SetRow; current: MaxRow };

export function sessionCandidates(world: World, log: LogRow): Candidate[] {
  const maxes = currentMaxes(world);
  const found: Candidate[] = [];
  for (const se of world.exercisesOfLog.get(log.id) ?? []) {
    if (se.exercise_id === null) continue;
    const b = best(world.setsOf.get(se.id) ?? []);
    const current = maxes.get(se.exercise_id);
    if (b && current && new Big(b.load_kg!).gt(current.kg) && log.date >= current.date) found.push({ set: b, current });
  }
  return found;
}
