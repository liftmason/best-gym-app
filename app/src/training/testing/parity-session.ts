/**
 * For screen tests: the parity scenario (shared/parity.json) in a Node SQLite database, with
 * an engine that is offline, and the training profile of its athlete. Only tests import it.
 */
import parity from '../../../../shared/parity.json';

import { ApiError } from '@/api/errors';
import { makeDatabase } from '@/db/database';
import { openNodeDriver } from '@/db/node-driver';
import { prepare, setState, STATE } from '@/db/setup';
import { makeSyncEngine } from '@/sync/engine';
import { isSynced, upsert } from '@/sync/rows';
import type { Transport } from '@/sync/transport';

import type { TrainingProfile } from '../profile';

export const offline: Transport = {
  bootstrap: () => Promise.reject(ApiError.offline()),
  pull: () => Promise.reject(ApiError.offline()),
  push: () => Promise.reject(ApiError.offline()),
};

export const profile: TrainingProfile = {
  athleteId: parity.athlete.id,
  userId: parity.athlete.user_id,
  timezone: parity.athlete.timezone,
  maxUpdates: parity.athlete.max_updates,
  name: 'Maya Torres',
  units: 'kg',
  weekStart: parity.athlete.week_start,
  coachName: 'Dana Whitfield',
  gymName: 'Iron Ridge Weightlifting',
  heightCm: parity.athlete.height_cm,
  yearsTraining: parity.athlete.years_training,
};

export async function paritySession(overrides: Partial<TrainingProfile> = {}) {
  const database = makeDatabase(openNodeDriver());
  await prepare(database);
  await database.write(async (tx) => {
    for (const [table, rows] of Object.entries(parity.snapshot.tables as Record<string, Record<string, unknown>[]>)) {
      if (isSynced(table)) for (const row of rows) await upsert(tx, table, row);
    }
    await setState(tx, STATE.cursor, 'parity');
    await setState(tx, STATE.owner, parity.athlete.id);
    await setState(tx, STATE.historyFrom, parity.snapshot.history_from);
    await setState(tx, STATE.baselines, JSON.stringify(parity.snapshot.baselines));
  });
  const who = { ...profile, ...overrides };
  let n = 0;
  // Action ids as the server expects them (UUIDs), and the same on every run.
  const newId = () => `00000000-0000-7000-9000-${String(++n).padStart(12, '0')}`;
  const engine = makeSyncEngine({ database, transport: offline, who: () => who, newId });
  return { database, engine, profile: who };
}

export const now = parity.now;
