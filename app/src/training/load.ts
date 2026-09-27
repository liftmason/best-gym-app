/** The athlete's training from the device's tables, as the rules read it (src/domain/world). */
import type { Database } from '@/db/database';
import { getState, STATE } from '@/db/setup';
import type { SyncedTable } from '@/db/schema.generated';
import { makeWorld, type Athlete, type Baseline, type Clock, type Tables, type World } from '@/domain/world';
import { select } from '@/sync/rows';

/** The tables the training screens' rules read (the week, sessions, history, habits, check-ins). */
export const TRAINING_TABLES: SyncedTable[] = [
  'programs_program',
  'programs_programweek',
  'programs_programday',
  'programs_programsession',
  'programs_prescription',
  'programs_prescribedset',
  'programs_weektype',
  'programs_habit',
  'programs_habitlog',
  'exercises_exercise',
  'exercises_category',
  'workouts_sessionlog',
  'workouts_sessionexercise',
  'workouts_setlog',
  'workouts_checkinquestion',
  'workouts_checkinanswer',
  'workouts_issuereport',
  'workouts_formvideo',
  'accounts_maxentry',
  'accounts_coaching',
  'messaging_thread',
  'messaging_message',
  'accounts_bodyweightentry',
  'exercises_trackedlift',
];

export async function loadWorld(database: Database, athlete: Athlete, clock: Clock): Promise<World> {
  return database.write(async (tx) => {
    const tables: Tables = {};
    for (const table of TRAINING_TABLES) tables[table] = await select(tx, table);
    const historyFrom = await getState(tx, STATE.historyFrom);
    const baselines = JSON.parse((await getState(tx, STATE.baselines)) ?? '{}') as Record<string, Baseline>;
    return makeWorld(tables, athlete, clock, historyFrom, baselines);
  });
}
