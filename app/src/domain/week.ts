/**
 * The athlete's week (backend apps/workouts/week.py): which week and day open, each day's
 * status, and each session's card (start, resume, fill in afterwards, or wait for its day).
 */
import { dayStatus, finishedSessionIds, type DayStatus } from './history';
import { layout, summary } from './prescriptions';
import { editable } from './sessions';
import { addDays, desc, instant, sortBy, type DayRow, type LogRow, type SessionRow, type WeekRow, type World } from './world';

export type CardState = 'done' | 'paused' | 'start' | 'backfill' | 'locked';

export const weekEnd = (week: WeekRow) => addDays(week.start_date, 6);

export function pickWeek(weeks: WeekRow[], today: string, wanted: string | null): WeekRow | null {
  if (!weeks.length) return null;
  if (wanted) {
    const w = weeks.find((w) => w.start_date <= wanted && wanted <= weekEnd(w));
    if (w) return w;
  }
  const current = weeks.find((w) => w.start_date <= today && today <= weekEnd(w));
  if (current) return current;
  return today < weeks[0].start_date ? weeks[0] : weeks[weeks.length - 1];
}

export function pickDay(week: WeekRow, today: string, wanted: string | null): string {
  if (wanted && week.start_date <= wanted && wanted <= weekEnd(week)) return wanted;
  return week.start_date <= today && today <= weekEnd(week) ? today : week.start_date;
}

export function cardState(log: LogRow | null, date: string, today: string): CardState {
  if (log && log.finished_at !== null) return 'done';
  if (log) return 'paused';
  if (date === today) return 'start';
  return date < today ? 'backfill' : 'locked';
}

export type Card = {
  session: SessionRow;
  log: LogRow | null;
  items: { name: string; dose: string }[];
  count: number;
  state: CardState;
  editable: boolean | null;
};

export function sessionCard(world: World, session: SessionRow, date: string, today: string): Card {
  const unit = world.athlete.units;
  const [warmups, entries] = layout(world.prescriptionsOfSession.get(session.id) ?? [], (rx) => rx);
  const items: Card['items'] = [];
  if (warmups.length) items.push({ name: 'Warm-up', dose: `${warmups.length} drill${warmups.length !== 1 ? 's' : ''}` });
  for (const e of entries) {
    const rx = e.item;
    const name = world.exercise.get(rx.exercise_id)?.name ?? '';
    items.push({
      name: `${e.label} ${name}`.trim(),
      dose: summary(rx, unit, world.overridesOf.get(rx.id) ?? [], false),
    });
  }
  const log = world.logOfSession.get(session.id) ?? null;
  const state = cardState(log, date, today);
  return { session, log, items, count: entries.length, state, editable: state === 'done' ? editable(log!, world.now) : null };
}

export type StripDay = { day: DayRow; status: DayStatus; count: number; is_today: boolean; selected: boolean };

export type WeekView = {
  today: string;
  week: WeekRow | null;
  paused: LogRow[];
  number?: number;
  strip?: StripDay[];
  cards?: Card[] | null;
  prev_week?: WeekRow | null;
  next_week?: WeekRow | null;
};

export function weekView(world: World, wantedWeek: string | null = null, wantedDay: string | null = null): WeekView {
  const today = world.today;
  const week = pickWeek(world.weeks, today, wantedWeek);
  const paused = sortBy(world.logs.filter((l) => l.finished_at === null), desc((l) => instant(l.started_at)));
  if (!week) return { today, week: null, paused };
  const done = finishedSessionIds(world);
  const selectedDate = pickDay(week, today, wantedDay);
  const strip: StripDay[] = [];
  let cards: Card[] | null = null;
  for (const day of world.daysOfWeek.get(week.id) ?? []) {
    const sessions = world.sessionsOfDay.get(day.id) ?? [];
    const entry: StripDay = {
      day,
      status: dayStatus(world, day, today, done),
      count: sessions.reduce((n, s) => n + (world.prescriptionsOfSession.get(s.id) ?? []).filter((rx) => !rx.warmup).length, 0),
      is_today: day.date === today,
      selected: day.date === selectedDate,
    };
    strip.push(entry);
    if (entry.selected) cards = sessions.map((s) => sessionCard(world, s, day.date, today));
  }
  const index = world.weeks.indexOf(week);
  return {
    today,
    week,
    number: week.order + 1,
    strip,
    cards,
    prev_week: index > 0 ? world.weeks[index - 1] : null,
    next_week: index + 1 < world.weeks.length ? world.weeks[index + 1] : null,
    paused: paused.filter((p) => p.date !== selectedDate),
  };
}
