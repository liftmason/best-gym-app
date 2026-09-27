/** `session.finish`: finish (or, within 24 hours, change) a session: RPE 1-10 and a note. */
import { checkFinish, InvalidFinish } from '@/domain/sessions';

import { applyPrs } from './prs-local';
import { openLog, row } from './sessions-local';
import { Refused, type Action } from './types';

export type SessionFinish = { session_log_id: string; rpe: number; comment: string };

export const sessionFinish: Action<SessionFinish> = {
  name: 'session.finish',
  async apply(local, { session_log_id, rpe, comment }, context) {
    const log = await openLog(local, session_log_id, context.at);
    let checked: [number, string];
    try {
      checked = checkFinish(rpe, comment);
    } catch (error) {
      throw error instanceof InvalidFinish ? new Refused(error.message) : error;
    }
    const finished = { ...log, session_rpe: checked[0], comment: checked[1], finished_at: log.finished_at ?? context.at };
    await local.put('workouts_sessionlog', row(finished));
    await applyPrs(local, finished, context);
  },
};
