/** `set.save`: one set as entered, in kg and seconds (the screen converts from the athlete's unit). */
import { checkSet, InvalidSet } from '@/domain/sessions';

import { applyPrs } from './prs-local';
import { exerciseFor, openLog, row, setsOf } from './sessions-local';
import { Refused, type Action } from './types';

export type SetSave = {
  set_id: string;
  session_exercise_id: string;
  set_number: number;
  load_kg: string | null;
  reps: number | null;
  duration_seconds: number | null;
  rir: number | null;
  done: boolean;
};

export const setSave: Action<SetSave> = {
  name: 'set.save',
  async apply(local, p, context) {
    const se = await exerciseFor(local, p.session_exercise_id);
    const log = await openLog(local, se.session_log_id, context.at);
    let entry;
    try {
      entry = checkSet(p.set_number, p);
    } catch (error) {
      throw error instanceof InvalidSet ? new Refused(error.message) : error;
    }
    const existing = (await setsOf(local, se.id)).find((s) => s.set_number === p.set_number);
    await local.put(
      'workouts_setlog',
      row({
        ...(existing ?? {
          id: p.set_id,
          session_exercise_id: se.id,
          athlete_id: context.athleteId,
          set_number: p.set_number,
          logged_at: context.at,
          max_dismissed: false,
        }),
        ...entry,
        done: Boolean(p.done),
      }),
    );
    if (log.finished_at !== null) await applyPrs(local, log, context); // an edit can change the session's PRs
  },
};
