/**
 * What the session player shows (backend apps/workouts/player.py): where a session picks
 * up, each exercise's set rows, the prescription banner, and the done screen's counts.
 */
import { Big } from 'big.js';

import { exerciseHistory, lastLine } from './history';
import { loadText, rirText } from './prescriptions';
import { plateRound } from './rules';
import { plannedSets, prescribed, stepDone, steps, suggestedLoad, targetKg, type Prescribed } from './sessions';
import { display, fromKg, hasValue, norm, type Unit } from './units';
import type { LogRow, SessionExerciseRow, World } from './world';

export type ResumePoint = ['checkin', number] | ['checkin_summary', null] | ['player', number] | ['finish', null];

const setsOf = (world: World) => (se: SessionExerciseRow) => world.setsOf.get(se.id) ?? [];

export function resumePoint(world: World, log: LogRow): ResumePoint {
  const exercises = world.exercisesOfLog.get(log.id) ?? [];
  if (log.finished_at === null && !log.checkin_skipped) {
    const answered = new Set((world.answersOf.get(log.id) ?? []).map((a) => a.question_id));
    const anySets = exercises.some((se) => (world.setsOf.get(se.id) ?? []).length);
    if (world.questions.length && !anySets) {
      const n = world.questions.findIndex((q) => !answered.has(q.id));
      return n >= 0 ? ['checkin', n + 1] : ['checkin_summary', null];
    }
  }
  const list = steps(exercises);
  const lifting = list.some((step) => step.items.some((se) => setsOf(world)(se).some((s) => s.done)));
  for (const [i, step] of list.entries()) {
    if (step.warmup && lifting) continue;
    if (!stepDone(step, setsOf(world))) return ['player', i + 1];
  }
  if (log.finished_at !== null && list.length) return ['player', 1];
  return ['finish', null];
}

/** Timed work is entered in minutes when prescribed in whole minutes of 2 or more. */
export function timeUnit(p: Prescribed | null): 'min' | 's' {
  const seconds = p?.duration_seconds;
  return seconds && seconds >= 120 && seconds % 60 === 0 ? 'min' : 's';
}

// Python's format(float, "g"): six significant digits, no trailing zeros.
const pyG = (x: number) => String(Number(x.toPrecision(6)));

export type SetRowView = {
  number: number;
  load: string;
  reps: number | '';
  time: number | string;
  rir: string;
  done: boolean;
  placeholder: string;
};

export function setRows(world: World, se: SessionExerciseRow, p: Prescribed | null, unit: Unit): [SetRowView[], 'min' | 's'] {
  const logged = new Map((world.setsOf.get(se.id) ?? []).map((s) => [s.set_number, s]));
  const planned = p ? p.overrides.length || p.sets : 0;
  const count = Math.max(planned, ...logged.keys(), 1);
  const overrides = new Map((p?.overrides ?? []).map((o) => [o.set_number, o]));
  const unitOfTime = timeUnit(p);
  const rows: SetRowView[] = [];
  for (let number = 1; number <= count; number += 1) {
    const s = logged.get(number);
    const o = overrides.get(number);
    let load = '';
    let reps: number | '' = '';
    let rir = '';
    let done = false;
    let seconds: number | null;
    if (s) {
      load = s.load_kg !== null ? norm(fromKg(s.load_kg, unit)) : '';
      reps = s.reps ?? '';
      seconds = s.duration_seconds;
      rir = s.rir === null ? '' : String(s.rir);
      done = s.done;
    } else {
      seconds = p ? p.duration_seconds : null;
      if (p) {
        const loadValue = o && o.load_value !== null ? o.load_value : p.load_value;
        load = suggestedLoad(p, loadValue, unit) ?? '';
        reps = (o && o.reps !== null ? o.reps : p.reps) || '';
      }
    }
    const time = seconds === null ? '' : unitOfTime === 'min' ? pyG(seconds / 60) : seconds;
    rows.push({
      number,
      load,
      reps,
      time,
      rir,
      done,
      placeholder: p ? (o && o.rep_scheme ? o.rep_scheme : p.rep_scheme) : '',
    });
  }
  return [rows, unitOfTime];
}

export type Banner = { sets: number; reps: string; load: string; rir: string; hint: string };

export function banner(p: Prescribed | null, unit: Unit): Banner | null {
  if (!p) return null;
  const reps = p.rep_scheme || (!p.sets ? '—' : '');
  const load = loadText(p.load_basis, p.load_value, unit);
  let hint = load ? 'prescribed load' : '';
  if (p.overrides.length) hint = 'loads vary by set';
  if (p.load_basis === 'percent') {
    const kg = targetKg(p, p.load_value);
    if (kg && !new Big(kg).eq(0)) {
      hint = `≈ ${plateRound(kg, unit)} ${unit} from your ${p.max_exercise} max`;
      if (p.overrides.length) hint = `loads vary by set · ${p.max_exercise} max ${display(p.max_kg, unit)}`;
    } else {
      hint = 'no max on file, go by feel';
    }
  }
  return { sets: p.overrides.length || p.sets, reps, load, rir: rirText(p.rir, p.rir_max), hint };
}

/** [exercises, sets done, sets planned] for the done screen (warm-up drills left out). */
export function setCounts(world: World, log: LogRow): [number, number, number] {
  const exercises = (world.exercisesOfLog.get(log.id) ?? []).filter((se) => !se.warmup);
  const doneOf = (se: SessionExerciseRow) => (world.setsOf.get(se.id) ?? []).filter((s) => s.done).length;
  const done = exercises.reduce((n, se) => n + doneOf(se), 0);
  const planned = exercises.reduce((n, se) => n + Math.max(plannedSets(se), doneOf(se)), 0);
  return [exercises.length, done, planned];
}

/** Exercises with at least one completed set with a load. */
export function topSets(world: World, log: LogRow): number {
  return (world.exercisesOfLog.get(log.id) ?? []).filter((se) =>
    (world.setsOf.get(se.id) ?? []).some((s) => s.done && hasValue(s.load_kg)),
  ).length;
}

/** '78 kg ×1 · 7 days ago' for the exercise's last top set before this session, or null. */
export function lastTime(world: World, se: SessionExerciseRow, log: LogRow, unit: Unit): string | null {
  if (se.exercise_id === null) return null;
  const list = exerciseHistory(world, { exerciseIds: [se.exercise_id], excludeLog: log.id, limit: 1 }).get(se.exercise_id);
  return list?.length ? lastLine(list[0], unit, world.today) : null;
}

/** How the exercise is logged: its own measure, or (deleted) time if it was timed, else reps. */
export function measureFor(world: World, se: SessionExerciseRow, p: Prescribed | null): string {
  const exercise = se.exercise_id ? world.exercise.get(se.exercise_id) : undefined;
  if (exercise) return exercise.measure;
  return p && p.duration_seconds ? 'time' : 'reps';
}

export { prescribed };
