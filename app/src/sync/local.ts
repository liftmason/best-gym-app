/**
 * What pending actions did to the synced tables. An action's local effect writes through a
 * recorder, which notes each row's state before (local_changes). Before a pull lays the
 * server's rows down, those notes undo every local effect; afterwards the actions still
 * waiting are applied again. So the phone always shows the server's state with what hasn't
 * been sent yet on top, and a refused action simply disappears.
 */
import type { Tx } from '@/db/database';
import type { SyncedTable } from '@/db/schema.generated';

import { remove, select, upsert, type ServerRow } from './rows';

export type Local = {
  get(table: SyncedTable, id: string): Promise<ServerRow | null>;
  find(table: SyncedTable, where: Record<string, string | number | null>): Promise<ServerRow[]>;
  put(table: SyncedTable, row: ServerRow): Promise<void>;
  delete(table: SyncedTable, id: string): Promise<void>;
};

export function recorder(tx: Tx, actionId: string): Local {
  async function remember(table: SyncedTable, id: string) {
    const [before] = await select(tx, table, { id });
    await tx.run('INSERT INTO local_changes (action_id, tbl, row_id, before) VALUES (?, ?, ?, ?)', [
      actionId,
      table,
      id,
      before ? JSON.stringify(before) : null,
    ]);
  }
  return {
    get: async (table, id) => (await select(tx, table, { id }))[0] ?? null,
    find: (table, where) => select(tx, table, where),
    async put(table, row) {
      await remember(table, row.id as string);
      await upsert(tx, table, row);
    },
    async delete(table, id) {
      await remember(table, id);
      await remove(tx, table, id);
    },
  };
}

/** Puts every row a local effect touched back as it was, newest change first. */
export async function undoLocal(tx: Tx): Promise<void> {
  const changes = await tx.query('SELECT tbl, row_id, before FROM local_changes ORDER BY seq DESC');
  for (const [table, id, before] of changes) {
    if (before === null) await remove(tx, table as SyncedTable, id as string);
    else await upsert(tx, table as SyncedTable, JSON.parse(before as string));
  }
  await tx.run('DELETE FROM local_changes');
}
