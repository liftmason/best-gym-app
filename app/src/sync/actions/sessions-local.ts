/** Reading a session's rows through an action's Local, and the checks every session action shares. */
import { editable } from '@/domain/sessions';
import type { LogRow, MaxRow, SessionExerciseRow, SetRow } from '@/domain/world';

import type { Local } from '../local';
import type { ServerRow } from '../rows';

import { Refused } from './types';

export const CLOSED = "This session can't be changed any more.";

export async function logFor(local: Local, id: string): Promise<LogRow> {
  const log = (await local.get('workouts_sessionlog', id)) as LogRow | null;
  if (!log) throw new Refused("That session isn't on this device.");
  return log;
}

/** The log, if it can still change (paused, or finished within 24 hours). */
export async function openLog(local: Local, id: string, at: string): Promise<LogRow> {
  const log = await logFor(local, id);
  if (!editable(log, at)) throw new Refused(CLOSED);
  return log;
}

export async function exerciseFor(local: Local, id: string): Promise<SessionExerciseRow> {
  const se = (await local.get('workouts_sessionexercise', id)) as SessionExerciseRow | null;
  if (!se) throw new Refused("That exercise isn't on this device.");
  return se;
}

export async function setsOf(local: Local, se: string): Promise<SetRow[]> {
  return ((await local.find('workouts_setlog', { session_exercise_id: se })) as SetRow[]).sort((a, b) => a.set_number - b.set_number);
}

export async function latestMax(local: Local, exerciseId: string): Promise<MaxRow | null> {
  const maxes = (await local.find('accounts_maxentry', { exercise_id: exerciseId })) as MaxRow[];
  maxes.sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  return maxes[0] ?? null;
}

export const row = (value: object) => value as unknown as ServerRow;
