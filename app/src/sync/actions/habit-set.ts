/** `habit.set`: a habit done or not done on a day (the same call again changes nothing). */
import { Refused, type Action } from './types';

export type HabitSet = { habit_id: string; date: string; done: boolean };

export const habitSet: Action<HabitSet> = {
  name: 'habit.set',
  async apply(local, { habit_id, date, done }, { id, at, athleteId }) {
    if (!(await local.get('programs_habit', habit_id))) throw new Refused('That habit is gone.');
    const logs = await local.find('programs_habitlog', { habit_id, date });
    if (done && !logs.length) {
      await local.put('programs_habitlog', { id, habit_id, athlete_id: athleteId, date, created_at: at });
    }
    if (!done) for (const log of logs) await local.delete('programs_habitlog', log.id as string);
  },
};
