/** `message.send`: a message to the athlete's current coach, with the id the phone chose. */
import { Refused, type Action } from './types';

export type MessageSend = { message_id: string; body: string };

export const MAX_BODY = 4000; // backend messaging Message.body

export const messageSend: Action<MessageSend> = {
  name: 'message.send',
  async apply(local, { message_id, body }, { id, at, athleteId, userId }) {
    const text = body.trim();
    if (!text) throw new Refused('Write a message first.');
    if (text.length > MAX_BODY) throw new Refused(`Messages are at most ${MAX_BODY} characters.`);
    const [link] = await local.find('accounts_coaching', { athlete_id: athleteId, status: 'active' });
    if (!link) throw new Refused("You don't have a coach to message.");
    // The thread is made on the server with the first message; until then, a stand-in.
    let [thread] = await local.find('messaging_thread', { coaching_id: link.id as string });
    if (!thread) {
      thread = { id, coaching_id: link.id, athlete_id: athleteId, created_at: at };
      await local.put('messaging_thread', thread);
    }
    await local.put('messaging_message', {
      id: message_id,
      thread_id: thread.id,
      athlete_id: athleteId,
      sender_id: userId,
      body: text,
      sent_at: at,
      read_at: null,
    });
  },
};
