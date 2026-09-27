/** Starting a planned session from its card: the log and its exercises get their ids here. */
import { uuid7 } from '@/domain/ids';
import type { World } from '@/domain/world';
import type { SyncEngine } from '@/sync/engine';
import { sessionStart } from '@/sync/actions';

/** The log's id, once its start is queued (and shown locally). */
export async function startSession(engine: SyncEngine, world: World, sessionId: string): Promise<string> {
  const existing = world.logOfSession.get(sessionId);
  if (existing) return existing.id;
  const logId = uuid7();
  await engine.enqueue(sessionStart, {
    session_log_id: logId,
    program_session_id: sessionId,
    exercises: (world.prescriptionsOfSession.get(sessionId) ?? []).map((rx) => ({ id: uuid7(), prescription_id: rx.id })),
  });
  return logId;
}
