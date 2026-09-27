/**
 * Live queries for screens: `useLive(() => db.select().from(setLog)…, [setLog])` re-runs when
 * a committed write changes one of the tables. Writes in quick succession (a sync page, a
 * burst of taps) are gathered into one re-run after ~50 ms.
 */
import { getTableName, type Table } from 'drizzle-orm';
import { useEffect, useEffectEvent, useState } from 'react';

import type { Database } from './database';

export const GATHER_MS = 50;

/** Calls `onChange` at most once per GATHER_MS while any of `tables` keeps changing. */
export function watch(database: Database, tables: readonly string[], onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = database.subscribe((changed) => {
    if (timer || !tables.some((t) => changed.has(t))) return;
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, GATHER_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

export function useLive<T>(database: Database | null, run: () => Promise<T>, tables: readonly Table[]): T | undefined {
  const [value, setValue] = useState<T>();
  const latest = useEffectEvent(run); // the latest query, without re-subscribing on each render
  const names = tables.map(getTableName);
  const key = names.join();

  useEffect(() => {
    if (!database) return;
    let alive = true;
    const refresh = () => {
      latest().then((v) => alive && setValue(() => v));
    };
    refresh();
    const stop = watch(database, key.split(','), refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [database, key]);

  return value;
}
