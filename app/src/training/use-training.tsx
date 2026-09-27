/**
 * The athlete's training for screens, loaded once for all of training mode and kept live:
 * re-read when a committed write changes one of its tables (a sync page, an action), and
 * when the athlete's day turns over at midnight.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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

const Context = createContext<World | undefined>(undefined);
const Provided = createContext(false);

/** Reads the world and keeps it live while `enabled`. */
function useWorld(enabled: boolean): World | undefined {
  const { database, profile } = useSync();
  const today = useToday(profile.timezone);
  const [world, setWorld] = useState<World>();
  const { athleteId, units, weekStart, maxUpdates } = profile;

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, database, athleteId, units, weekStart, maxUpdates, today]);

  return world;
}

/** Training mode's one live copy, shared by every tab and screen. */
export function TrainingProvider({ children }: { children: ReactNode }) {
  const world = useWorld(true);
  return (
    <Provided.Provider value>
      <Context.Provider value={world}>{children}</Context.Provider>
    </Provided.Provider>
  );
}

/** The shared world, or (a screen tested on its own) one loaded here. */
export function useTraining(): World | undefined {
  const provided = useContext(Provided);
  const shared = useContext(Context);
  const own = useWorld(!provided);
  return provided ? shared : own;
}
