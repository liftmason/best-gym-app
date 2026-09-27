/**
 * The device's sync session: the local database and its engine, made once per app run and
 * shared by training mode and sign-out.
 */
import { Platform } from 'react-native';

import { api } from '@/api';
import { openDatabase, type Database } from '@/db';

import { makeSyncEngine, type SyncEngine, type Who } from './engine';
import { apiTransport } from './transport';

export type SyncSession = { database: Database; engine: SyncEngine };

let session: (SyncSession & { who: Who }) | null = null;

/** The session for this athlete (the engine drops another athlete's data on its next sync). */
export async function startSession(who: Who): Promise<SyncSession> {
  const { database } = await openDatabase();
  if (!session) {
    const current = { ...who };
    session = {
      database,
      who: current,
      engine: makeSyncEngine({ database, transport: apiTransport(api), who: () => current }),
    };
  }
  Object.assign(session.who, who);
  await session.engine.countPending();
  return session;
}

/**
 * The local engine when there may be data on this device: the one running, or on a phone
 * the database from an earlier run. (On the web the database is only opened by training
 * mode; a later sign-in by someone else drops what's left.)
 */
async function localEngine(): Promise<SyncEngine | null> {
  if (session) return session.engine;
  if (Platform.OS === 'web') return null;
  try {
    const { database } = await openDatabase();
    const nobody = { athleteId: '', userId: '' };
    return makeSyncEngine({ database, transport: apiTransport(api), who: () => nobody });
  } catch {
    return null;
  }
}

/** Sync now, if training mode has started one (a push asked for it). */
export function syncNow(): void {
  void session?.engine.sync();
}

/** Actions on this device not yet sent (for the sign-out warning). */
export async function unsentActions(): Promise<number> {
  const engine = await localEngine();
  if (!engine) return 0;
  await engine.countPending();
  return engine.status.pending;
}

/** Signing out: this device's copy goes, including anything not yet sent. */
export async function forgetDevice(): Promise<void> {
  const engine = await localEngine();
  await engine?.forget();
}
