/**
 * Habits (backend apps/programs/habits.py): what's due on a day, and streaks.
 * - Every day: due daily; the streak is days in a row done.
 * - Training days: due on days with a session; the streak counts those days.
 * - 3× / 5× a week: due until done that many times in the gym's week; the streak is weeks
 *   in a row the target was hit.
 * Today only breaks a streak once it's over. Today and yesterday can be ticked.
 */
import { addDays, weekday, type HabitRow, type Id, type World } from './world';

export const TICKABLE_DAYS = 2;
export const LOOKBACK_DAYS = 400;

export function weeklyTarget(habit: Pick<HabitRow, 'cadence'>): number | null {
  return habit.cadence === '3x' ? 3 : habit.cadence === '5x' ? 5 : null;
}

/** The first day of the training week containing `date`. */
export function weekStartFor(date: string, weekStart: number): string {
  return addDays(date, -((((weekday(date) - weekStart) % 7) + 7) % 7));
}

export function canTick(date: string, today: string): boolean {
  return addDays(today, -(TICKABLE_DAYS - 1)) <= date && date <= today;
}

export function trainingDates(world: World, start: string, end: string): Set<string> {
  return new Set(
    world.days.filter((d) => d.date >= start && d.date <= end && (world.sessionsOfDay.get(d.id) ?? []).length).map((d) => d.date),
  );
}

export function weekCount(date: string, done: Set<string>, weekStart: number): number {
  const start = weekStartFor(date, weekStart);
  const end = addDays(start, 6);
  return [...done].filter((d) => start <= d && d <= end).length;
}

export function isDue(habit: HabitRow, date: string, training: Set<string>): boolean {
  return habit.cadence === 'training' ? training.has(date) : true;
}

export function streak(habit: HabitRow, today: string, done: Set<string>, training: Set<string>, weekStart: number): number {
  const lookback = addDays(today, -LOOKBACK_DAYS);
  const target = weeklyTarget(habit);
  if (target) {
    const perWeek = new Map<string, number>();
    for (const d of done) {
      const w = weekStartFor(d, weekStart);
      perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
    }
    let week = weekStartFor(today, weekStart);
    let count = (perWeek.get(week) ?? 0) >= target ? 1 : 0;
    week = addDays(week, -7);
    while (week >= lookback && (perWeek.get(week) ?? 0) >= target) {
      count += 1;
      week = addDays(week, -7);
    }
    return count;
  }
  let days: string[];
  if (habit.cadence === 'training') {
    days = [...training].filter((d) => lookback <= d && d <= today).sort().reverse();
  } else {
    days = [];
    for (let d = today; d >= lookback; d = addDays(d, -1)) days.push(d);
  }
  let count = 0;
  for (const day of days) {
    if (day === today && !done.has(day)) continue;
    if (!done.has(day)) break;
    count += 1;
  }
  return count;
}

export type HabitItem = { habit: HabitRow; done: boolean; met_for_week: boolean; week_count: number | null; streak: number };

/** The habits for a day: those due, plus weekly ones already met ("done for this week"). */
export function forDay(world: World, date: string): HabitItem[] {
  const { today } = world;
  const weekStart = world.athlete.week_start;
  const week = weekStartFor(date, weekStart);
  const start = [addDays(today, -LOOKBACK_DAYS), week].sort()[0];
  const end = [today, addDays(week, 6), date].sort()[2];
  const training = trainingDates(world, start, end);
  const items: HabitItem[] = [];
  for (const h of world.habits) {
    const done = new Set((world.habitLogsOf.get(h.id as Id) ?? []).map((l) => l.date).filter((d) => d >= start && d <= end));
    const isDone = done.has(date);
    const target = weeklyTarget(h);
    const count = target ? weekCount(date, done, weekStart) : null;
    const met = Boolean(target) && count! >= target! && !isDone;
    if (!isDue(h, date, training) && !isDone) continue;
    items.push({
      habit: h,
      done: isDone,
      met_for_week: met,
      week_count: count,
      streak: streak(h, today, new Set([...done].filter((d) => d <= today)), training, weekStart),
    });
  }
  return items;
}
