/**
 * The athlete's training as the rules read it: the rows the phone holds (in the server's
 * shape: snake_case, ids and decimals as strings, dates as YYYY-MM-DD), sorted as the server
 * sorts them, with the lookups the rules need. Built from the local tables by
 * src/training, and from shared/parity.json in the tests.
 */
import type { Unit } from './units';

export type Id = string;

export type ProgramRow = { id: Id; active: boolean; name: string; note: string; start_date: string; created_at: string };
export type WeekRow = {
  id: Id;
  program_id: Id;
  order: number;
  start_date: string;
  published: boolean;
  week_type_id: Id | null;
  focus_note: string;
};
export type DayRow = { id: Id; week_id: Id; date: string };
export type SessionRow = { id: Id; day_id: Id; name: string; order: number };
export type CustomField = { key: string; value: string };
export type PrescriptionRow = {
  id: Id;
  session_id: Id;
  exercise_id: Id;
  order: number;
  sets: number;
  rep_scheme: string;
  reps: number | null;
  duration_seconds: number | null;
  load_basis: string;
  load_value: string | null;
  rir: number | null;
  rir_max: number | null;
  note: string;
  custom_fields: CustomField[] | null;
  warmup: boolean;
  section: string;
  section_note: string;
  superset: boolean;
};
export type PrescribedSetRow = {
  id: Id;
  prescription_id: Id;
  set_number: number;
  rep_scheme: string;
  reps: number | null;
  load_value: string | null;
};
export type ExerciseRow = {
  id: Id;
  name: string;
  measure: string;
  percent_of_id: Id | null;
  category_id: Id | null;
  youtube_url?: string;
  cue?: string;
};
export type CategoryRow = { id: Id; name: string };
export type BodyweightRow = { id: Id; date: string; kg: string };
export type TrackedLiftRow = { id: Id; exercise_id: Id; order: number };
export type LogRow = {
  id: Id;
  program_session_id: Id | null;
  date: string;
  name: string;
  started_at: string;
  finished_at: string | null;
  checkin_skipped: boolean;
  session_rpe: number | null;
  comment: string;
  week_type_id: Id | null;
};
export type Snapshot = Record<string, unknown> | null;
export type SessionExerciseRow = {
  id: Id;
  session_log_id: Id;
  prescription_id: Id | null;
  exercise_id: Id | null;
  exercise_name: string;
  order: number;
  prescribed: Snapshot;
  warmup: boolean;
  checked_at: string | null;
};
export type SetRow = {
  id: Id;
  session_exercise_id: Id;
  set_number: number;
  load_kg: string | null;
  reps: number | null;
  duration_seconds: number | null;
  rir: number | null;
  done: boolean;
  max_dismissed: boolean;
};
export type MaxRow = { id: Id; exercise_id: Id; date: string; kg: string; reps: number; set_log_id: Id | null; source: string };
export type HabitRow = { id: Id; order: number; name: string; emoji: string; cadence: string; note: string; archived_at: string | null };
export type HabitLogRow = { id: Id; habit_id: Id; date: string };
export type QuestionRow = {
  id: Id;
  order: number;
  type: string;
  text: string;
  options: string[];
  low_label: string;
  high_label: string;
  detail_label: string;
  archived: boolean;
};
export type AnswerRow = {
  id: Id;
  session_log_id: Id;
  question_id: Id | null;
  question_text?: string;
  type?: string;
  value: string;
  other_text: string;
};
export type WeekTypeRow = { id: Id; name: string; colour: string; description: string };
export type IssueRow = { id: Id; session_log_id: Id | null; kind: string; text: string; created_at: string; resolved_at: string | null };

/** An exercise's best from before the phone's history (backend sync.bootstrap.baselines). */
export type Baseline = {
  name: string;
  heaviest_kg: string;
  heaviest_reps: number | null;
  heaviest_date: string;
  e1rm: string | null;
  e1rm_date: string | null;
};

export type Athlete = { id: Id; units: Unit; week_start: number; max_updates: string };

export type Tables = Partial<Record<string, Record<string, unknown>[]>>;

export type Clock = { today: string; now: string };

type Key<T> = ((row: T) => string | number | null) | { desc: (row: T) => string | number | null };

/** Sorted by each key in turn, as Django's `ordering` does; `desc(key)` for "-field". Stable. */
export function sortBy<T>(rows: T[], ...keys: Key<T>[]): T[] {
  // Nulls sort last going up and first going down, as in Postgres.
  const compare = (a: string | number | null, b: string | number | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const c = typeof key === 'function' ? compare(key(a), key(b)) : -compare(key.desc(a), key.desc(b));
      if (c) return c;
    }
    return 0;
  });
}

export function desc<T>(key: (row: T) => string | number | null): Key<T> {
  return { desc: key };
}

/** Milliseconds for an ISO instant; server rows say +00:00 and phone rows Z, so never compare the text. */
export const instant = (iso: string) => Date.parse(iso);

function group<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(row);
  }
  return out;
}

export function makeWorld(tables: Tables, athlete: Athlete, clock: Clock, historyFrom: string | null, baselines: Record<Id, Baseline>) {
  const rows = <T>(table: string) => (tables[table] ?? []) as unknown as T[];

  const program = rows<ProgramRow>('programs_program').filter((p) => p.active);
  const activeProgram = sortBy(program, desc((p) => instant(p.created_at)))[0] ?? null;
  const weeks = sortBy(
    rows<WeekRow>('programs_programweek').filter((w) => w.published && w.program_id === activeProgram?.id),
    (w) => w.order,
  );
  const weekIds = new Set(weeks.map((w) => w.id));
  const days = sortBy(rows<DayRow>('programs_programday').filter((d) => weekIds.has(d.week_id)), (d) => d.date);
  const dayIds = new Set(days.map((d) => d.id));
  const sessions = sortBy(
    rows<SessionRow>('programs_programsession').filter((s) => dayIds.has(s.day_id)),
    (s) => s.order,
    (s) => s.id,
  );
  const sessionIds = new Set(sessions.map((s) => s.id));
  const prescriptions = sortBy(
    rows<PrescriptionRow>('programs_prescription').filter((p) => sessionIds.has(p.session_id)),
    (p) => p.order,
    (p) => p.id,
  );
  const overrides = sortBy(rows<PrescribedSetRow>('programs_prescribedset'), (s) => s.set_number);
  const logs = sortBy(rows<LogRow>('workouts_sessionlog'), desc((l) => l.date), desc((l) => instant(l.started_at)));
  const exercisesOfLogs = sortBy(rows<SessionExerciseRow>('workouts_sessionexercise'), (e) => e.order, (e) => e.id);
  const sets = sortBy(rows<SetRow>('workouts_setlog'), (s) => s.set_number);
  const maxes = sortBy(rows<MaxRow>('accounts_maxentry'), desc((m) => m.date), desc((m) => m.id));
  const habits = sortBy(rows<HabitRow>('programs_habit'), (h) => h.order, (h) => h.id);
  const questions = sortBy(rows<QuestionRow>('workouts_checkinquestion'), (q) => q.order, (q) => q.id);

  return {
    athlete,
    today: clock.today,
    now: clock.now,
    historyFrom,
    baselines,
    program: activeProgram,
    weeks,
    days,
    daysOfWeek: group(days, (d) => d.week_id),
    week: new Map(weeks.map((w) => [w.id, w])),
    sessionsOfDay: group(sessions, (s) => s.day_id),
    day: new Map(days.map((d) => [d.id, d])),
    prescriptionsOfSession: group(prescriptions, (p) => p.session_id),
    overridesOf: group(overrides, (s) => s.prescription_id),
    exercise: new Map(rows<ExerciseRow>('exercises_exercise').map((e) => [e.id, e])),
    weekType: new Map(rows<WeekTypeRow>('programs_weektype').map((t) => [t.id, t])),
    category: new Map(rows<CategoryRow>('exercises_category').map((c) => [c.id, c])),
    logs,
    log: new Map(logs.map((l) => [l.id, l])),
    logOfSession: new Map(logs.filter((l) => l.program_session_id).map((l) => [l.program_session_id!, l])),
    exercisesOfLog: group(exercisesOfLogs, (e) => e.session_log_id),
    sessionExercise: new Map(exercisesOfLogs.map((e) => [e.id, e])),
    setsOf: group(sets, (s) => s.session_exercise_id),
    maxes,
    habits: habits.filter((h) => h.archived_at === null),
    bodyweights: sortBy(rows<BodyweightRow>('accounts_bodyweightentry'), (b) => b.date, (b) => b.id),
    tracked: sortBy(rows<TrackedLiftRow>('exercises_trackedlift'), (t) => t.order, (t) => t.id),
    habitLogsOf: group(rows<HabitLogRow>('programs_habitlog'), (l) => l.habit_id),
    questions: questions.filter((q) => !q.archived),
    answersOf: group(sortBy(rows<AnswerRow & { order: number }>('workouts_checkinanswer'), (a) => a.order, (a) => a.id), (a) => a.session_log_id),
    issuesOf: group(sortBy(rows<IssueRow>('workouts_issuereport'), (i) => instant(i.created_at)), (i) => i.session_log_id),
  };
}

export type World = ReturnType<typeof makeWorld>;

// ---------------------------------------------------------------- dates (YYYY-MM-DD, no zones)

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Python's date.weekday(): Monday 0 … Sunday 6. */
export function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}
