/** `message.read`: the athlete has read their coach's messages, up to `until`. */
import { instant } from '@/domain/world';

import type { Action } from './types';

export type MessageRead = { until: string };

export const messageRead: Action<MessageRead> = {
  name: 'message.read',
  async apply(local, { until }, { at, athleteId, userId }) {
    const [link] = await local.find('accounts_coaching', { athlete_id: athleteId, status: 'active' });
    if (!link) return;
    const [thread] = await local.find('messaging_thread', { coaching_id: link.id as string });
    if (!thread) return;
    for (const m of await local.find('messaging_message', { thread_id: thread.id as string, read_at: null })) {
      if (m.sender_id !== userId && instant(m.sent_at as string) <= instant(until)) {
        await local.put('messaging_message', { ...m, read_at: at });
      }
    }
  },
};
