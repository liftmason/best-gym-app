/**
 * After a session is finished or edited: redo the maxes it set by itself (backend
 * prs.apply). With "update automatically", a set beating the working max becomes the new max;
 * otherwise the coach decides, online.
 */
import { Big } from 'big.js';

import { hasValue } from '@/domain/units';
import type { LogRow, MaxRow, SetRow } from '@/domain/world';

import { derivedId } from '../aliases';
import type { Local } from '../local';

import { latestMax, row, setsOf } from './sessions-local';
import type { ActionContext } from './types';

function best(sets: SetRow[]): SetRow | null {
  let found: SetRow | null = null;
  for (const s of sets) {
    if (!(s.done && hasValue(s.load_kg) && (s.reps ?? 0) >= 1 && !s.max_dismissed)) continue;
    const load = new Big(s.load_kg);
    if (!found || load.gt(found.load_kg!) || (load.eq(found.load_kg!) && (s.reps ?? 0) > (found.reps ?? 0))) found = s;
  }
  return found;
}

export async function applyPrs(local: Local, log: LogRow, context: ActionContext): Promise<void> {
  const exercises = await local.find('workouts_sessionexercise', { session_log_id: log.id });
  const setIds = new Set<string>();
  for (const se of exercises) for (const s of await setsOf(local, se.id as string)) setIds.add(s.id);
  for (const m of (await local.find('accounts_maxentry', { source: 'session' })) as MaxRow[]) {
    if (m.set_log_id && setIds.has(m.set_log_id)) await local.delete('accounts_maxentry', m.id);
  }
  if (log.finished_at === null || context.maxUpdates !== 'auto') return;
  for (const se of exercises) {
    const exerciseId = se.exercise_id as string | null;
    if (!exerciseId) continue;
    const b = best(await setsOf(local, se.id as string));
    const current = await latestMax(local, exerciseId);
    if (!b || !current || !new Big(b.load_kg!).gt(current.kg) || log.date < current.date) continue;
    await local.put(
      'accounts_maxentry',
      row({
        id: derivedId('max', b.id),
        athlete_id: context.athleteId,
        exercise_id: exerciseId,
        date: log.date,
        kg: b.load_kg,
        reps: 1,
        source: 'session',
        set_log_id: b.id,
        created_at: context.at,
      }),
    );
  }
}
