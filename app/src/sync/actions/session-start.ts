/**
 * `session.start`: a planned session's log, with a snapshot of every prescription, using the
 * ids the phone chose. Already started (here, or pulled from another device): nothing to do.
 */
import { weekdayName } from '@/domain/dates';
import { sessionName, snapshot } from '@/domain/sessions';
import type { DayRow, ExerciseRow, PrescribedSetRow, PrescriptionRow, ProgramRow, SessionRow, WeekRow } from '@/domain/world';

import { latestMax, row } from './sessions-local';
import { Refused, type Action } from './types';

export type SessionStart = {
  session_log_id: string;
  program_session_id: string;
  exercises: { id: string; prescription_id: string }[];
};

const byOrder = (a: { order: number; id: string }, b: { order: number; id: string }) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const sessionStart: Action<SessionStart> = {
  name: 'session.start',
  async apply(local, { session_log_id, program_session_id, exercises }, { at, day: today, athleteId }) {
    if ((await local.find('workouts_sessionlog', { program_session_id })).length) return;
    const session = (await local.get('programs_programsession', program_session_id)) as SessionRow | null;
    const day = session && ((await local.get('programs_programday', session.day_id)) as DayRow | null);
    const week = day && ((await local.get('programs_programweek', day.week_id)) as WeekRow | null);
    const program = week && ((await local.get('programs_program', week.program_id)) as ProgramRow | null);
    if (!session || !day || !week?.published || !program?.active) throw new Refused("That session isn't in your program any more.");
    if (day.date > today) throw new Refused(`This session unlocks on ${weekdayName(day.date)}.`);

    const prescriptions = ((await local.find('programs_prescription', { session_id: session.id })) as PrescriptionRow[]).sort(byOrder);
    const exercise = new Map<string, ExerciseRow>();
    for (const rx of prescriptions) {
      const ex = (await local.get('exercises_exercise', rx.exercise_id)) as ExerciseRow | null;
      if (ex) exercise.set(rx.exercise_id, ex);
    }
    const names = prescriptions.filter((rx) => !rx.warmup).map((rx) => exercise.get(rx.exercise_id)?.name ?? '');
    await local.put(
      'workouts_sessionlog',
      row({
        id: session_log_id,
        athlete_id: athleteId,
        program_session_id,
        date: day.date,
        name: session.name || sessionName(names),
        week_type_id: week.week_type_id,
        // Filling in a missed day afterwards skips the "how do you feel today" check-in.
        checkin_skipped: day.date < today,
        started_at: at,
        finished_at: null,
        session_rpe: null,
        comment: '',
      }),
    );
    const ids = new Map(exercises.map((e) => [e.prescription_id, e.id]));
    for (const [order, rx] of prescriptions.entries()) {
      const id = ids.get(rx.id);
      const ex = exercise.get(rx.exercise_id);
      if (!id || !ex) continue; // added since the screen asked: the server's copy brings it
      const source = (ex.percent_of_id && ((await local.get('exercises_exercise', ex.percent_of_id)) as ExerciseRow | null)) || ex;
      const working = rx.load_basis === 'percent' ? await latestMax(local, source.id) : null;
      const overrides = ((await local.find('programs_prescribedset', { prescription_id: rx.id })) as PrescribedSetRow[]).sort(
        (a, b) => a.set_number - b.set_number,
      );
      await local.put(
        'workouts_sessionexercise',
        row({
          id,
          session_log_id,
          athlete_id: athleteId,
          prescription_id: rx.id,
          exercise_id: ex.id,
          exercise_name: ex.name,
          order,
          prescribed: snapshot({ exercise: ex, rx, overrides, maxSource: source, workingMaxKg: working?.kg ?? null }),
          warmup: rx.warmup,
          checked_at: null,
        }),
      );
    }
  },
  adopt(payload, result) {
    const ids: Record<string, string> = {};
    const log = result.session_log_id as string | undefined;
    if (log && log !== payload.session_log_id) ids[payload.session_log_id] = log;
    const kept = (result.exercises ?? {}) as Record<string, string>;
    for (const e of payload.exercises) {
      const server = kept[e.prescription_id];
      if (server && server !== e.id) ids[e.id] = server;
    }
    return ids;
  },
};
