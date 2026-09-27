/**
 * Every push action the app sends, by name (backend apps/sync/actions.py).
 */
import { checkinAnswer, checkinFinish } from './checkin';
import { habitSet } from './habit-set';
import { issueReport } from './issue-report';
import { messageRead } from './message-read';
import { messageSend } from './message-send';
import { metricsUpdate } from './metrics-update';
import { videoAttach } from './video-attach';
import { sessionFinish } from './session-finish';
import { sessionStart } from './session-start';
import { setSave } from './set-save';
import type { Action } from './types';
import { warmupTick } from './warmup-tick';

export { Refused, type Action, type ActionContext } from './types';
export { habitSet, type HabitSet } from './habit-set';
export { messageSend, type MessageSend } from './message-send';
export { messageRead, type MessageRead } from './message-read';
export { metricsUpdate, type MetricsUpdate } from './metrics-update';
export { videoAttach, type VideoAttach } from './video-attach';
export { sessionStart, type SessionStart } from './session-start';
export { setSave, type SetSave } from './set-save';
export { warmupTick, type WarmupTick } from './warmup-tick';
export { checkinAnswer, checkinFinish, type CheckinAnswer, type CheckinFinish } from './checkin';
export { sessionFinish, type SessionFinish } from './session-finish';
export { issueReport, ISSUE_KINDS, type IssueReport } from './issue-report';

export const ACTIONS: Record<string, Action<any>> = Object.fromEntries(
  [sessionStart, setSave, warmupTick, checkinAnswer, checkinFinish, sessionFinish, habitSet, issueReport, messageSend, messageRead, metricsUpdate, videoAttach].map(
    (action) => [action.name, action],
  ),
);
