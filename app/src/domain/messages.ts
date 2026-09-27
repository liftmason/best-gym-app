/** The athlete's conversation with their current coach (backend messaging.services). */
import type { MessageRow, World } from './world';

/** Messages with the current coach, oldest first; none without a coach. */
export function conversation(world: World): MessageRow[] {
  const thread = world.coaching ? world.threads.find((t) => t.coaching_id === world.coaching!.id) : undefined;
  return thread ? world.messages.filter((m) => m.thread_id === thread.id) : [];
}

/** The coach's messages not read yet (the badge). */
export function unread(world: World, userId: string): number {
  return conversation(world).filter((m) => m.sender_id !== userId && m.read_at === null).length;
}
