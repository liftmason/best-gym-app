/**
 * Every push action the app sends, by name. S4 has the first two; the session player's
 * actions (session.start, set.save, warmup.tick, check-ins, session.finish, issue.report,
 * metrics.update, video.attach) come with their screens in S5.
 */
import { habitSet } from './habit-set';
import { messageSend } from './message-send';
import type { Action } from './types';

export { Refused, type Action, type ActionContext } from './types';
export { habitSet, type HabitSet } from './habit-set';
export { messageSend, type MessageSend } from './message-send';

export const ACTIONS: Record<string, Action<any>> = Object.fromEntries(
  [habitSet, messageSend].map((action) => [action.name, action]),
);
