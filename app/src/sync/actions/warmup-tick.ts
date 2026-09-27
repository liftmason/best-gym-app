/** `warmup.tick`: a warm-up drill ticked off (or not) while the session can still change. */
import { exerciseFor, openLog, row } from './sessions-local';
import { Refused, type Action } from './types';

export type WarmupTick = { session_exercise_id: string; checked: boolean };

export const warmupTick: Action<WarmupTick> = {
  name: 'warmup.tick',
  async apply(local, { session_exercise_id, checked }, { at }) {
    const se = await exerciseFor(local, session_exercise_id);
    if (!se.warmup) throw new Refused('Only warm-up drills are ticked off; lifts log sets.');
    await openLog(local, se.session_log_id, at);
    await local.put('workouts_sessionexercise', row({ ...se, checked_at: checked ? at : null }));
  },
};
