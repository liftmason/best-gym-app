/**
 * A pretend sync server for the engine's tests: the protocol of backend apps/sync (bootstrap,
 * pull pages by cursor, push with stored results), with its own ids for what it creates, as
 * the real one does. Only tests import it.
 */
import { ApiError } from '@/api/errors';
import { SCOPE, type SyncedTable } from '@/db/schema.generated';

import type { ServerRow } from './rows';
import type { Change, Outcome, Outgoing, Transport } from './transport';

type Options = { athleteId: string; userId: string; pageSize?: number };

export function fakeServer({ athleteId, userId, pageSize = 3 }: Options) {
  const tables = new Map<string, Map<string, ServerRow>>();
  const log: { seq: number; table: string; id: string }[] = [];
  const results = new Map<string, Outcome>();
  let seq = 0;
  let made = 0;

  const state = {
    offline: false,
    /** Cursors older than this get 410. */
    purgedBelow: 0,
    /** Answer "retry" from this action name on. */
    failFrom: null as string | null,
    /** The next pull resends the whole library. */
    libraryReset: false,
    received: [] as Outgoing[],
    bootstraps: 0,
  };

  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, new Map());
    return tables.get(table)!;
  };
  const serverId = () => `server-${++made}`;

  function put(table: SyncedTable, row: ServerRow) {
    rows(table).set(row.id as string, { ...row });
    log.push({ seq: ++seq, table, id: row.id as string });
  }

  function drop(table: SyncedTable, id: string) {
    rows(table).delete(id);
    log.push({ seq: ++seq, table, id });
  }

  const find = (table: string, where: ServerRow) =>
    [...rows(table).values()].filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));

  function change(table: string, id: string): Change {
    const row = rows(table).get(id) ?? null;
    return { table, id, op: row ? 'upsert' : 'delete', row };
  }

  const notFound = { status: 'rejected', error: { code: 'not_found', message: 'Not found.' } };

  function perform(action: Outgoing): Omit<Outcome, 'id'> {
    const p = action.payload as Record<string, never>;
    if (action.name === 'habit.set') {
      const habit = rows('programs_habit').get(p.habit_id);
      if (!habit || habit.archived_at) return notFound;
      const logs = find('programs_habitlog', { habit_id: p.habit_id, date: p.date });
      if (p.done && !logs.length) {
        put('programs_habitlog', { id: serverId(), habit_id: p.habit_id, athlete_id: athleteId, date: p.date, created_at: action.at });
      }
      if (!p.done) for (const row of logs) drop('programs_habitlog', row.id as string);
      return { status: 'done', result: {} };
    }
    if (action.name === 'message.send') {
      const [link] = find('accounts_coaching', { athlete_id: athleteId, status: 'active' });
      if (!link) return { status: 'rejected', error: { code: 'not_in_thread', message: 'No coach.' } };
      let [thread] = find('messaging_thread', { coaching_id: link.id });
      if (!thread) {
        thread = { id: serverId(), coaching_id: link.id, athlete_id: athleteId, created_at: action.at };
        put('messaging_thread', thread);
      }
      put('messaging_message', {
        id: p.message_id,
        thread_id: thread.id,
        athlete_id: athleteId,
        sender_id: userId,
        body: (p.body as string).trim(),
        sent_at: action.at,
        read_at: null,
      });
      return { status: 'done', result: { message_id: p.message_id } };
    }
    return { status: 'rejected', error: { code: 'invalid', message: 'Unknown action.' } };
  }

  const offline = () => {
    if (state.offline) throw ApiError.offline();
  };

  const transport: Transport = {
    async bootstrap() {
      offline();
      state.bootstraps += 1;
      const out: Record<string, ServerRow[]> = {};
      for (const [table, byId] of tables) out[table] = [...byId.values()].map((row) => ({ ...row }));
      return { tables: out, cursor: String(seq), history_from: '2025-09-24' };
    },

    async pull(cursor) {
      offline();
      const after = Number(cursor);
      if (after < state.purgedBelow) throw new ApiError(410, 'gone', 'Download everything again.');
      const newer = log.filter((entry) => entry.seq > after);
      const page = newer.slice(0, pageSize);
      const keys = [...new Map(page.map((e) => [`${e.table}:${e.id}`, e])).values()];
      const reset = state.libraryReset;
      state.libraryReset = false;
      const library = reset
        ? [...tables.entries()]
            .filter(([table]) => SCOPE[table as SyncedTable] === 'library')
            .flatMap(([table, byId]) => [...byId.keys()].map((id) => change(table, id)))
        : null;
      return {
        changes: keys.map((e) => change(e.table, e.id)),
        cursor: String(page.at(-1)?.seq ?? after),
        more: newer.length > pageSize,
        library_reset: reset,
        library,
      };
    },

    async push(actions) {
      offline();
      const out: Outcome[] = [];
      let failing = false;
      for (const action of actions) {
        state.received.push(action);
        failing ||= action.name === state.failFrom;
        if (failing) {
          out.push({ id: action.id, status: 'retry' });
          continue;
        }
        if (!results.has(action.id)) results.set(action.id, { id: action.id, ...perform(action) });
        out.push(results.get(action.id)!);
      }
      return out;
    },
  };

  return { transport, state, put, drop, rows: (table: SyncedTable) => [...rows(table).values()], serverId };
}
