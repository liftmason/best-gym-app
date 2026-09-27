/**
 * The sync engine (docs/EXPO_MIGRATION.md, "Sync protocol"; backend apps/sync).
 *
 * - An action's local effect and its outbox entry are written in one transaction, so the
 *   screen changes at once and nothing done offline is lost.
 * - A sync bootstraps when there's no cursor, pushes the outbox in order, then pulls.
 * - Each pulled page is laid down in one transaction: the local effects are undone
 *   (local.ts), the server's rows written, the cursor saved, and the actions still waiting
 *   applied again on top.
 * - Pushed actions leave the outbox whether done or refused; a refused one's effect goes at
 *   the next page, and the athlete gets a short notice. A "retry" answer (a server error)
 *   stops the push; the rest go next time, in order.
 * - The athlete whose data this is is recorded: anyone else's sync starts from nothing.
 */
import { ApiError } from '@/api/errors';
import type { Database, Tx } from '@/db/database';
import { COLUMNS, SCOPE, type SyncedTable } from '@/db/schema.generated';
import { getState, setState, STATE } from '@/db/setup';
import { uuid7 } from '@/domain/ids';

import { ACTIONS, type Action } from './actions';
import { recorder, undoLocal } from './local';
import { isSynced, remove, upsert } from './rows';
import type { Change, Outgoing, Transport } from './transport';

export const PUSH_BATCH = 200; // backend apps/sync/push.py MAX_BATCH

export type Who = { athleteId: string; userId: string };

export type SyncStatus = {
  running: boolean;
  /** Actions waiting to be sent. */
  pending: number;
  offline: boolean;
  /** The server needs a newer app (426). */
  needsUpdate: boolean;
  lastSynced: string | null;
  error: string | null;
};

/** An action the server refused; its effect is gone. */
export type Notice = { action: string; message: string };

type Options = {
  database: Database;
  transport: Transport;
  who: () => Who;
  now?: () => Date;
  newId?: () => string;
};

const SYNCED = Object.keys(COLUMNS) as SyncedTable[];
const LIBRARY = SYNCED.filter((table) => SCOPE[table] === 'library');

export function makeSyncEngine({ database, transport, who, now = () => new Date(), newId = () => uuid7() }: Options) {
  let status: SyncStatus = {
    running: false,
    pending: 0,
    offline: false,
    needsUpdate: false,
    lastSynced: null,
    error: null,
  };
  const statusListeners = new Set<() => void>();
  const noticeListeners = new Set<(notice: Notice) => void>();
  const queuedListeners = new Set<() => void>();
  let running: Promise<void> | null = null;
  let again = false;

  function update(next: Partial<SyncStatus>) {
    status = { ...status, ...next };
    statusListeners.forEach((listener) => listener());
  }

  async function countPending() {
    const [[n]] = await database.query('SELECT count(*) FROM outbox');
    update({ pending: Number(n) });
  }

  /** Applies every waiting action's effect again, in order. One that no longer fits is skipped here; the server decides. */
  async function reapply(tx: Tx) {
    const { athleteId, userId } = who();
    const waiting = await tx.query('SELECT id, name, payload, at FROM outbox ORDER BY seq');
    for (const [id, name, payload, at] of waiting) {
      const action = ACTIONS[name as string];
      if (!action) continue;
      await tx.exec('SAVEPOINT reapply');
      try {
        await action.apply(recorder(tx, id as string), JSON.parse(payload as string), {
          id: id as string,
          at: at as string,
          athleteId,
          userId,
        });
        await tx.exec('RELEASE reapply');
      } catch {
        await tx.exec('ROLLBACK TO reapply; RELEASE reapply');
      }
    }
  }

  async function clearSynced(tx: Tx, tables: readonly SyncedTable[]) {
    for (const table of tables) await tx.run(`DELETE FROM "${table}"`);
  }

  async function write(tx: Tx, change: Change) {
    if (!isSynced(change.table)) return; // a table this app version doesn't know
    if (change.op === 'delete' || !change.row) await remove(tx, change.table, change.id);
    else await upsert(tx, change.table, change.row);
  }

  /** Someone else's data (another athlete signed in on this device) is dropped first. */
  async function ensureOwner() {
    const { athleteId } = who();
    await database.write(async (tx) => {
      const owner = await getState(tx, STATE.owner);
      if (owner === athleteId) return;
      if (owner !== null) {
        await tx.run('DELETE FROM outbox');
        await tx.run('DELETE FROM local_changes');
        await clearSynced(tx, SYNCED);
        await setState(tx, STATE.cursor, null);
        await setState(tx, STATE.historyFrom, null);
      }
      await setState(tx, STATE.owner, athleteId);
    });
  }

  async function bootstrap() {
    const snapshot = await transport.bootstrap();
    await database.write(async (tx) => {
      await tx.run('DELETE FROM local_changes');
      await clearSynced(tx, SYNCED);
      for (const [table, rows] of Object.entries(snapshot.tables)) {
        if (!isSynced(table)) continue;
        for (const row of rows) await upsert(tx, table, row);
      }
      await setState(tx, STATE.cursor, snapshot.cursor);
      await setState(tx, STATE.historyFrom, snapshot.history_from);
      await reapply(tx);
    });
  }

  async function push() {
    for (;;) {
      const rows = await database.query('SELECT id, name, payload, at FROM outbox ORDER BY seq LIMIT ?', [PUSH_BATCH]);
      if (!rows.length) return;
      const outgoing: Outgoing[] = rows.map(([id, name, payload, at]) => ({
        id: id as string,
        name: name as string,
        at: at as string,
        payload: JSON.parse(payload as string),
      }));
      const results = await transport.push(outgoing);
      const settled: string[] = [];
      for (const [i, result] of results.entries()) {
        if (result.status === 'retry') break;
        settled.push(result.id);
        if (result.status === 'rejected') {
          const message = (result.error as { message?: string } | null)?.message ?? "This couldn't be saved.";
          noticeListeners.forEach((listener) => listener({ action: outgoing[i].name, message }));
        }
      }
      if (settled.length) {
        await database.write(async (tx) => {
          for (const id of settled) await tx.run('DELETE FROM outbox WHERE id = ?', [id]);
        });
      }
      await countPending();
      if (settled.length < rows.length) return; // a retry: the rest wait, in order
    }
  }

  async function pull() {
    let bootstrapped = false;
    for (;;) {
      const cursor = await database.write((tx) => getState(tx, STATE.cursor));
      let page;
      try {
        page = await transport.pull(cursor ?? '');
      } catch (error) {
        if (error instanceof ApiError && error.status === 410 && !bootstrapped) {
          bootstrapped = true; // away too long: start again from a fresh copy
          await bootstrap();
          continue;
        }
        throw error;
      }
      await database.write(async (tx) => {
        await undoLocal(tx);
        if (page.library_reset) {
          await clearSynced(tx, LIBRARY);
          for (const change of page.library ?? []) await write(tx, change);
        }
        for (const change of page.changes) await write(tx, change);
        await setState(tx, STATE.cursor, page.cursor);
        await reapply(tx);
      });
      if (!page.more) return;
    }
  }

  async function run() {
    update({ running: true });
    try {
      await ensureOwner();
      if (!(await database.write((tx) => getState(tx, STATE.cursor)))) await bootstrap();
      await push();
      await pull();
      update({ offline: false, needsUpdate: false, error: null, lastSynced: now().toISOString() });
    } catch (error) {
      if (error instanceof ApiError && error.offline) update({ offline: true });
      else if (error instanceof ApiError && error.status === 426) update({ needsUpdate: true, offline: false });
      else update({ offline: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      await countPending().catch(() => {});
      update({ running: false });
    }
  }

  return {
    get status() {
      return status;
    },

    subscribe(listener: () => void) {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },

    onNotice(listener: (notice: Notice) => void) {
      noticeListeners.add(listener);
      return () => void noticeListeners.delete(listener);
    },

    /** After each action is queued (the scheduler syncs a few seconds later). */
    onQueued(listener: () => void) {
      queuedListeners.add(listener);
      return () => void queuedListeners.delete(listener);
    },

    /**
     * Does an action: its local effect and its outbox entry together. Throws Refused (with
     * the athlete's message) when the effect refuses; then nothing is queued.
     */
    async enqueue<P>(action: Action<P>, payload: P): Promise<string> {
      const id = newId();
      const at = now().toISOString();
      const { athleteId, userId } = who();
      await database.write(async (tx) => {
        await action.apply(recorder(tx, id), payload, { id, at, athleteId, userId });
        await tx.run('INSERT INTO outbox (id, name, payload, at) VALUES (?, ?, ?, ?)', [
          id,
          action.name,
          JSON.stringify(payload),
          at,
        ]);
      });
      await countPending();
      queuedListeners.forEach((listener) => listener());
      return id;
    },

    /** One sync; a call while one runs makes it run once more afterwards. */
    sync(): Promise<void> {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        do {
          again = false;
          await run();
        } while (again);
      })().finally(() => {
        running = null;
      });
      return running;
    },

    /** For signing out: everything local goes, including actions not yet sent. */
    async forget() {
      await running?.catch(() => {});
      await database.write(async (tx) => {
        await tx.run('DELETE FROM outbox');
        await tx.run('DELETE FROM local_changes');
        await clearSynced(tx, SYNCED);
        for (const key of [STATE.cursor, STATE.historyFrom, STATE.owner]) await setState(tx, key, null);
      });
      await countPending();
    },

    countPending,
  };
}

export type SyncEngine = ReturnType<typeof makeSyncEngine>;
