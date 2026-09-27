/**
 * The athlete's training for screens, live: re-read when a committed write changes one of
 * its tables (a sync page, an action), and when the athlete's day turns over at midnight.
 */
import { useEffect, useState } from 'react';

import { localDate } from '@/domain/dates';
import type { World } from '@/domain/world';
import { watch } from '@/db/live';
import { useSync } from '@/sync/provider';

import { loadWorld, TRAINING_TABLES } from './load';

/** The athlete's date now, updated each minute. */
export function useToday(timezone: string): string {
  const [today, setToday] = useState(() => localDate(new Date().toISOString(), timezone));
  useEffect(() => {
    const timer = setInterval(() => setToday(localDate(new Date().toISOString(), timezone)), 60_000);
    return () => clearInterval(timer);
  }, [timezone]);
  return today;
}

export function useTraining(): World | undefined {
  const { database, profile } = useSync();
  const today = useToday(profile.timezone);
  const [world, setWorld] = useState<World>();
  const { athleteId, units, weekStart, maxUpdates } = profile;

  useEffect(() => {
    let alive = true;
    const athlete = { id: athleteId, units, week_start: weekStart, max_updates: maxUpdates };
    const load = () =>
      loadWorld(database, athlete, { today, now: new Date().toISOString() }).then((w) => alive && setWorld(w));
    load();
    const stop = watch(database, TRAINING_TABLES, load);
    return () => {
      alive = false;
      stop();
    };
  }, [database, athleteId, units, weekStart, maxUpdates, today]);

  return world;
}
