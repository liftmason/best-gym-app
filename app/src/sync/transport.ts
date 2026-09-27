/**
 * The sync endpoints (backend apps/sync/api.py), with the local schema's version on every
 * call. Failures are ApiErrors: offline (0), 410 (too long away: bootstrap again), 426 (the
 * app is too old for the server).
 */
import type { Api } from '@/api/client';
import type { components } from '@/api/schema';
import { ok } from '@/api/errors';
import { SCHEMA_VERSION } from '@/db/schema.generated';

import type { ServerRow } from './rows';

export type Change = { table: string; id: string; op: string; row: ServerRow | null };
export type PullPage = {
  changes: Change[];
  cursor: string;
  more: boolean;
  library_reset: boolean;
  library: Change[] | null;
};
export type Snapshot = {
  tables: Record<string, ServerRow[]>;
  cursor: string;
  history_from: string;
  /** Each lift's best from before history_from (backend sync.bootstrap.baselines). */
  baselines?: Record<string, unknown>;
};
export type Outgoing = { id: string; name: string; at: string; payload: Record<string, unknown> };
export type Outcome = components['schemas']['Outcome'];

export type Transport = {
  bootstrap(): Promise<Snapshot>;
  pull(cursor: string): Promise<PullPage>;
  push(actions: Outgoing[]): Promise<Outcome[]>;
};

export function apiTransport(api: Api): Transport {
  const headers = { 'X-Schema-Version': String(SCHEMA_VERSION) };
  return {
    bootstrap: async () => (await ok(api.client.GET('/api/v1/sync/bootstrap', { headers }))) as Snapshot,
    pull: async (cursor) =>
      (await ok(api.client.GET('/api/v1/sync/pull', { params: { query: { cursor } }, headers }))) as PullPage,
    push: async (actions) => (await ok(api.client.POST('/api/v1/sync/push', { body: { actions }, headers }))).results,
  };
}
