/** `checkin.answer` and `checkin.finish`: the check-in before a session (backend checkins.py). */
import { cleanAnswer, InvalidAnswer } from '@/domain/checkins';
import type { AnswerRow, QuestionRow } from '@/domain/world';

import { CLOSED, logFor, row } from './sessions-local';
import { Refused, type Action } from './types';

export type CheckinAnswer = { answer_id: string; session_log_id: string; question_id: string; value: string; other: string };
export type CheckinFinish = { session_log_id: string; skip: boolean };

export const checkinAnswer: Action<CheckinAnswer> = {
  name: 'checkin.answer',
  async apply(local, p, { athleteId }) {
    const log = await logFor(local, p.session_log_id);
    if (log.finished_at !== null) throw new Refused(CLOSED);
    const active = ((await local.find('workouts_checkinquestion', { archived: 0 })) as QuestionRow[]).sort(
      (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1),
    );
    const index = active.findIndex((q) => q.id === p.question_id);
    if (index < 0) throw new Refused("That question isn't in your check-in any more.");
    const question = active[index];
    let value: string, other: string;
    try {
      [value, other] = cleanAnswer(question, p.value, p.other);
    } catch (error) {
      throw error instanceof InvalidAnswer ? new Refused(error.message) : error;
    }
    const [existing] = (await local.find('workouts_checkinanswer', {
      session_log_id: log.id,
      question_id: question.id,
    })) as AnswerRow[];
    await local.put(
      'workouts_checkinanswer',
      row({
        id: existing?.id ?? p.answer_id,
        session_log_id: log.id,
        athlete_id: athleteId,
        question_id: question.id,
        order: index,
        question_text: question.text,
        type: question.type,
        value,
        other_text: other,
      }),
    );
  },
};

export const checkinFinish: Action<CheckinFinish> = {
  name: 'checkin.finish',
  async apply(local, { session_log_id, skip }) {
    const log = await logFor(local, session_log_id);
    if (log.finished_at !== null) throw new Refused(CLOSED);
    if (skip) {
      for (const a of await local.find('workouts_checkinanswer', { session_log_id })) {
        await local.delete('workouts_checkinanswer', a.id as string);
      }
    }
    await local.put('workouts_sessionlog', row({ ...log, checkin_skipped: skip }));
  },
};
