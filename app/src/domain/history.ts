/**
 * Values derived from session logs, never stored (backend apps/workouts/history.py): e1RM,
 * top sets, PRs, day status, streaks. History counts finished sessions and done sets only.
 * The phone holds 12 months; each lift's best from before that comes with the first
 * download (World.baselines), so PRs still count everything.
 */
import { Big } from 'big.js';

import { e1rm } from './rules';
import { display, fromKg, HALF_UP, hasValue, type Unit } from './units';
import { addDays, daysBetween, desc, instant, sortBy, type Id, type SetRow, type World } from './world';

export type HistorySet = Pick<SetRow, 'load_kg' | 'reps' | 'duration_seconds'>;

/** One exercise in one finished session. */
export type Entry = {
  date: string;
  log_id: Id;
  session_exercise_id: Id;
  exercise_id: Id | null;
  name: string;
  started_at: string;
  sets: SetRow[];
};

const big = (v: string) => new Big(v);

/** Heaviest done set (most reps breaks a tie); unloaded work: the most reps, then time. */
export function top(sets: HistorySet[]): HistorySet | null {
  const loaded = sets.filter((s) => hasValue(s.load_kg));
  let best: HistorySet | null = null;
  if (loaded.length) {
    for (const s of loaded) {
      if (!best || big(s.load_kg!).gt(best.load_kg!) || (big(s.load_kg!).eq(best.load_kg!) && (s.reps ?? 0) > (best.reps ?? 0))) best = s;
    }
    return best;
  }
  for (const s of sets) {
    const key = [s.reps ?? 0, s.duration_seconds ?? 0];
    const bestKey = best ? [best.reps ?? 0, best.duration_seconds ?? 0] : null;
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) best = s;
  }
  return best;
}

export function bestE1rm(sets: HistorySet[]): string | null {
  let best: string | null = null;
  for (const s of sets) {
    const value = e1rm(s.load_kg, s.reps);
    if (value && (best === null || big(value).gt(best))) best = value;
  }
  return best;
}

export function durationText(seconds: number): string {
  if (seconds % 60 === 0) return `${Math.floor(seconds / 60)} min`;
  if (seconds > 60) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${seconds} s`;
}

/** '78 kg ×2', '×10', '10 min' or '30 s' for one set. */
export function setText(s: HistorySet | null, unit: Unit): string {
  if (!s) return '';
  const parts: string[] = [];
  if (hasValue(s.load_kg)) parts.push(display(s.load_kg, unit));
  if (s.reps) parts.push(`×${s.reps}`);
  else if (s.duration_seconds) parts.push(durationText(s.duration_seconds));
  return parts.join(' ');
}

/** Done sets grouped like a prescription: '6×2 @ 64 kg, 1×1 @ 70 kg'. */
export function setsText(sets: HistorySet[], unit: Unit): string {
  const groups: [HistorySet, number][] = [];
  const same = (a: HistorySet, b: HistorySet) =>
    (a.load_kg === null ? b.load_kg === null : b.load_kg !== null && big(a.load_kg).eq(b.load_kg)) &&
    a.reps === b.reps &&
    a.duration_seconds === b.duration_seconds;
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && same(last[0], s)) last[1] += 1;
    else groups.push([s, 1]);
  }
  return groups
    .map(([s, count]) => {
      const dose = s.reps ? String(s.reps) : s.duration_seconds ? durationText(s.duration_seconds) : 'done';
      let text = dose !== 'done' ? `${count}×${dose}` : `${count} set${count > 1 ? 's' : ''}`;
      if (hasValue(s.load_kg)) text += ` @ ${display(s.load_kg, unit)}`;
      return text;
    })
    .join(', ');
}

/** e1RM to the nearest whole kg or lb. */
export function e1rmText(kg: string, unit: Unit): string {
  return `${new Big(fromKg(kg, unit)).round(0, HALF_UP).toFixed(0)} ${unit}`;
}

/** Every exercise done in a finished session, newest first. */
export function entries(
  world: World,
  { exerciseIds, excludeLog, since, before }: { exerciseIds?: Id[]; excludeLog?: Id; since?: string | null; before?: string } = {},
): Entry[] {
  const wanted = exerciseIds ? new Set(exerciseIds) : null;
  const out: Entry[] = [];
  const logs = sortBy(
    world.logs.filter((l) => l.finished_at !== null),
    desc((l) => l.date),
    desc((l) => instant(l.started_at)),
  );
  for (const log of logs) {
    if (log.id === excludeLog) continue;
    if (since && log.date < since) continue;
    if (before && log.date >= before) continue;
    for (const se of world.exercisesOfLog.get(log.id) ?? []) {
      if (wanted && !(se.exercise_id && wanted.has(se.exercise_id))) continue;
      const sets = (world.setsOf.get(se.id) ?? []).filter((s) => s.done);
      if (!sets.length) continue;
      out.push({
        date: log.date,
        log_id: log.id,
        session_exercise_id: se.id,
        exercise_id: se.exercise_id,
        name: se.exercise_name,
        started_at: log.started_at,
        sets,
      });
    }
  }
  return out;
}

/** {exercise id: [Entry…]} newest first, at most `limit` each. */
export function exerciseHistory(
  world: World,
  options: { exerciseIds?: Id[]; excludeLog?: Id; limit?: number; since?: string | null } = {},
): Map<Id, Entry[]> {
  const limit = options.limit ?? 10;
  const history = new Map<Id, Entry[]>();
  for (const entry of entries(world, options)) {
    if (entry.exercise_id === null) continue;
    if (!history.has(entry.exercise_id)) history.set(entry.exercise_id, []);
    const items = history.get(entry.exercise_id)!;
    if (items.length < limit) items.push(entry);
  }
  return history;
}

/** 'up', 'down' or 'flat' from the last two sessions' e1RM (or top load); null if too few. */
export function trend(list: Entry[]): 'up' | 'down' | 'flat' | null {
  if (list.length < 2) return null;
  const [a, b] = list.slice(0, 2).map((e) => bestE1rm(e.sets) ?? top(e.sets)?.load_kg ?? null);
  if (!hasValue(a) || !hasValue(b)) return 'flat';
  return big(a).gt(b) ? 'up' : big(a).lt(b) ? 'down' : 'flat';
}

export function ago(date: string, today: string): string {
  const days = daysBetween(date, today);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} wk ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

/** '78 kg ×1 · 2 days ago'. */
export function lastLine(entry: Entry, unit: Unit, today: string): string {
  return `${setText(top(entry.sets), unit)} · ${ago(entry.date, today)}`;
}

// ---------------------------------------------------------------- PRs

export type LifetimePr = {
  exercise_id: Id;
  name: string;
  heaviest: HistorySet;
  heaviest_date: string;
  e1rm: string | null;
  e1rm_date: string | null;
  date: string;
};

/** Per loaded exercise: heaviest set and best e1RM with their dates, most recent PR first. */
export function lifetimePrs(world: World): LifetimePr[] {
  const best = new Map<Id, Omit<LifetimePr, 'date'>>();
  for (const [id, b] of Object.entries(world.baselines)) {
    best.set(id, {
      exercise_id: id,
      name: b.name,
      heaviest: { load_kg: b.heaviest_kg, reps: b.heaviest_reps, duration_seconds: null },
      heaviest_date: b.heaviest_date,
      e1rm: b.e1rm,
      e1rm_date: b.e1rm_date,
    });
  }
  for (const entry of [...ownHistory(world)].reverse()) {
    const t = top(entry.sets);
    if (entry.exercise_id === null || !t || !hasValue(t.load_kg)) continue;
    let pr = best.get(entry.exercise_id);
    if (!pr) {
      pr = { exercise_id: entry.exercise_id, name: entry.name, heaviest: t, heaviest_date: entry.date, e1rm: null, e1rm_date: null };
      best.set(entry.exercise_id, pr);
    } else if (big(t.load_kg).gt(pr.heaviest.load_kg!)) {
      pr.heaviest = t;
      pr.heaviest_date = entry.date;
    }
    pr.name = entry.name;
    const value = bestE1rm(entry.sets);
    if (value && (pr.e1rm === null || big(value).gt(pr.e1rm))) {
      pr.e1rm = value;
      pr.e1rm_date = entry.date;
    }
  }
  const items = [...best.values()].map((pr) => ({
    ...pr,
    date: [pr.heaviest_date, pr.e1rm_date].filter((d): d is string => Boolean(d)).sort().at(-1)!,
  }));
  return sortBy(items, desc((p) => p.date), desc((p) => p.name));
}

/** History the phone holds from its start (older is in the baselines), newest first. */
function ownHistory(world: World): Entry[] {
  return entries(world, { since: world.historyFrom });
}

/**
 * Session exercises whose top set beat every earlier set of that lift and the working max
 * recorded before it. The first time doing a lift is not a PR unless it beats a max.
 */
export function prSessionExercises(world: World): Set<Id> {
  const maxes = new Map<Id, { date: string; kg: string }[]>();
  for (const m of sortBy(world.maxes.filter((m) => m.set_log_id === null), (m) => m.date, (m) => m.id)) {
    if (!maxes.has(m.exercise_id)) maxes.set(m.exercise_id, []);
    maxes.get(m.exercise_id)!.push(m);
  }
  const best = new Map<Id, Big>();
  for (const [id, b] of Object.entries(world.baselines)) best.set(id, big(b.heaviest_kg));
  const prs = new Set<Id>();
  for (const entry of [...ownHistory(world)].reverse()) {
    const t = top(entry.sets);
    if (entry.exercise_id === null || !t || !hasValue(t.load_kg)) continue;
    const earlier = (maxes.get(entry.exercise_id) ?? []).filter((m) => m.date <= entry.date).map((m) => big(m.kg));
    const bar = [...earlier, best.get(entry.exercise_id) ?? big('0')].reduce((a, b) => (b.gt(a) ? b : a));
    if (!bar.eq(0) && big(t.load_kg).gt(bar)) prs.add(entry.session_exercise_id);
    const previous = best.get(entry.exercise_id) ?? big('0');
    best.set(entry.exercise_id, big(t.load_kg).gt(previous) ? big(t.load_kg) : previous);
  }
  return prs;
}

// ---------------------------------------------------------------- days and streaks

export type DayStatus = 'done' | 'missed' | 'today' | 'upcoming' | 'rest';

export function finishedSessionIds(world: World): Set<Id> {
  return new Set(world.logs.filter((l) => l.finished_at !== null && l.program_session_id).map((l) => l.program_session_id!));
}

export function dayStatus(world: World, day: { id: Id; date: string }, today: string, done: Set<Id>): DayStatus {
  const sessions = world.sessionsOfDay.get(day.id) ?? [];
  if (!sessions.length) return 'rest';
  if (sessions.some((s) => done.has(s.id))) return 'done';
  if (day.date < today) return 'missed';
  return day.date === today ? 'today' : 'upcoming';
}

/** [date, done] for each day with a session up to `until` (from `since`), newest first. */
export function scheduledDays(world: World, until: string, since?: string): [string, boolean][] {
  const done = finishedSessionIds(world);
  return [...world.days]
    .filter((d) => d.date <= until && (!since || d.date >= since) && (world.sessionsOfDay.get(d.id) ?? []).length)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((d) => [d.date, (world.sessionsOfDay.get(d.id) ?? []).some((s) => done.has(s.id))]);
}

/** [done, scheduled] over the last `days` days; today counts only once it's done. */
export function compliance(world: World, today: string, days = 7): [number, number] {
  const start = addDays(today, -(days - 1));
  const rows = scheduledDays(world, today, start).filter(([d, done]) => d < today || done);
  return [rows.filter(([, done]) => done).length, rows.length];
}

/** Scheduled days done in a row back from today (today counts once it's done). */
export function streak(world: World, today: string): number {
  let count = 0;
  for (const [date, done] of scheduledDays(world, today)) {
    if (date === today && !done) continue;
    if (!done) break;
    count += 1;
  }
  return count;
}

export function nextSessionDate(world: World, after: string): string | null {
  return world.days.find((d) => d.date > after && (world.sessionsOfDay.get(d.id) ?? []).length)?.date ?? null;
}

export function recentFinished(world: World, limit = 5) {
  return sortBy(
    world.logs.filter((l) => l.finished_at !== null),
    desc((l) => l.date),
    desc((l) => instant(l.finished_at!)),
  ).slice(0, limit);
}
