/**
 * Form videos waiting to be uploaded (docs/EXPO_MIGRATION.md: "uploaded through their own
 * retry queue using a presigned URL; video.attach links the upload to the session").
 *
 * - Adding keeps the file (videoFiles) and a row in `uploads`, so a video taken offline goes
 *   when the phone is back online.
 * - A row waits until its session has reached the server (its session.start has left the
 *   outbox). Then: the server starts the upload (POST /me/sessions/{log}/videos, with the
 *   limits, plan and size checks), the file is PUT to the signed URL, video.attach is queued,
 *   and the local file goes. The server's row arrives with the next pull.
 * - No connection or a server error: tried again after the next sync. A refusal (too big,
 *   three already, not in the gym's plan): the row keeps the reason for the athlete.
 * - A session another device started first: the rows follow the server's ids (onAliases).
 */
import { ApiError, ok } from '@/api/errors';
import type { Api } from '@/api/client';
import type { Database } from '@/db/database';
import { uuid7 } from '@/domain/ids';
import { videoAttach } from '@/sync/actions';
import type { SyncEngine } from '@/sync/engine';

import type { VideoFiles } from './files';

export type Upload = {
  id: string;
  session_log_id: string;
  session_exercise_id: string;
  uri: string;
  size: number;
  content_type: string;
  note: string;
  state: 'waiting' | 'uploading' | 'refused';
  video_id: string | null;
  error: string | null;
  created_at: string;
};

const COLUMNS = ['id', 'session_log_id', 'session_exercise_id', 'uri', 'size', 'content_type', 'note', 'state', 'video_id', 'error', 'created_at'] as const;

export function makeVideoQueue({ database, engine, api, files }: { database: Database; engine: SyncEngine; api: Pick<Api, 'client'>; files: VideoFiles }) {
  let running: Promise<void> | null = null;

  async function all(): Promise<Upload[]> {
    const rows = await database.query(`SELECT ${COLUMNS.join(', ')} FROM uploads ORDER BY created_at`);
    return rows.map((r) => Object.fromEntries(COLUMNS.map((c, i) => [c, r[i]])) as unknown as Upload);
  }

  async function update(id: string, fields: Partial<Upload>) {
    const keys = Object.keys(fields);
    await database.write((tx) =>
      tx.run(`UPDATE uploads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
        ...keys.map((k) => (fields as Record<string, string | number | null>)[k]),
        id,
      ]),
    );
  }

  /** Whether the session is on the server yet (its start isn't waiting in the outbox). */
  async function sessionSent(logId: string): Promise<boolean> {
    const waiting = await database.query("SELECT payload FROM outbox WHERE name = 'session.start'");
    return !waiting.some(([p]) => JSON.parse(p as string).session_log_id === logId);
  }

  async function send(u: Upload) {
    if (!(await sessionSent(u.session_log_id))) return;
    await update(u.id, { state: 'uploading', error: null });
    let started: { video_id: string; upload_url: string; content_type: string };
    try {
      started = (await ok(
        api.client.POST('/api/v1/me/sessions/{log_id}/videos', {
          params: { path: { log_id: u.session_log_id } },
          body: { session_exercise_id: u.session_exercise_id, size: u.size, content_type: u.content_type },
        }),
      )) as typeof started;
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 401) {
        await update(u.id, { state: 'refused', error: error.message });
      } else {
        await update(u.id, { state: 'waiting' }); // offline or a server error: next time
      }
      return;
    }
    let status: number;
    try {
      status = await files.put(u.uri, started.upload_url, started.content_type);
    } catch {
      status = 0;
    }
    if (status === 410) {
      await update(u.id, { state: 'refused', error: 'The video was lost when the page reloaded. Add it again.' });
      return;
    }
    if (status < 200 || status >= 300) {
      await update(u.id, { state: 'waiting' }); // a fresh signed URL next time
      return;
    }
    await engine.enqueue(videoAttach, { video_id: started.video_id });
    if (u.note.trim()) {
      await ok(api.client.PATCH('/api/v1/me/videos/{video_id}', { params: { path: { video_id: started.video_id } }, body: { note: u.note } })).catch(() => {});
    }
    files.drop(u.uri);
    await database.write((tx) => tx.run('DELETE FROM uploads WHERE id = ?', [u.id]));
  }

  const queue = {
    lasting: files.lasting,
    all,

    /** A picked or recorded video, for one exercise of a session. */
    async add(logId: string, seId: string, uri: string, contentType: string, note = ''): Promise<string> {
      const id = uuid7();
      const kept = await files.keep(uri, id, contentType);
      await database.write((tx) =>
        tx.run(
          'INSERT INTO uploads (id, session_log_id, session_exercise_id, uri, size, content_type, note, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, logId, seId, kept.uri, kept.size, contentType, note, 'waiting', new Date().toISOString()],
        ),
      );
      void queue.process();
      return id;
    },

    async setNote(id: string, note: string) {
      await update(id, { note });
    },

    /** Not uploaded after all: the row and the file go. */
    async remove(id: string) {
      const u = (await all()).find((x) => x.id === id);
      if (u) files.drop(u.uri);
      await database.write((tx) => tx.run('DELETE FROM uploads WHERE id = ?', [id]));
    },

    /** Uploads what can go now, one at a time. */
    process(): Promise<void> {
      running ??= (async () => {
        for (const u of await all()) if (u.state !== 'refused') await send(u);
      })().finally(() => {
        running = null;
      });
      return running;
    },

    /** Signing out: every waiting video and its file goes. */
    async forget() {
      for (const u of await all()) files.drop(u.uri);
      await database.write((tx) => tx.run('DELETE FROM uploads'));
    },

    start(): () => void {
      const stopAliases = engine.onAliases(async (aliases) => {
        await database.write(async (tx) => {
          for (const [phone, server] of Object.entries(aliases)) {
            await tx.run('UPDATE uploads SET session_log_id = ? WHERE session_log_id = ?', [server, phone]);
            await tx.run('UPDATE uploads SET session_exercise_id = ? WHERE session_exercise_id = ?', [server, phone]);
          }
        });
      });
      let wasRunning = false;
      const stopStatus = engine.subscribe(() => {
        const { running: now, offline } = engine.status;
        if (wasRunning && !now && !offline) void queue.process(); // after each sync that reached the server
        wasRunning = now;
      });
      return () => {
        stopAliases();
        stopStatus();
      };
    },
  };
  return queue;
}

export type VideoQueue = ReturnType<typeof makeVideoQueue>;
