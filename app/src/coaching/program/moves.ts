/**
 * Where things can go on a week, and what a drop means. The same answers serve drag and drop
 * on the web and the "Move to…" menu everywhere. The API places an exercise at `index`
 * among the target session's other exercises, so the one being moved never counts.
 */
import { shortDay } from '@/training/format';

import type { Dragged, Target } from './dnd';
import type { Item, Week } from './queries';

export type Placement =
  | { kind: 'move'; item: Item; dayId: string; sessionId: string | null; index: number }
  | { kind: 'add'; exercise: { id: string; name: string }; day: { id: string; date: string }; sessionId: string | null; index: number | null };

export function findItem(week: Week, itemId: string): { item: Item; dayId: string; sessionId: string } | null {
  for (const day of week.days) {
    for (const session of day.sessions) {
      const item = session.items.find((i) => i.id === itemId);
      if (item) return { item, dayId: day.id, sessionId: session.id };
    }
  }
  return null;
}

/** What dropping `what` at `where` does, or null when it would change nothing. */
export function placement(week: Week, what: Dragged, where: Target): Placement | null {
  const day = week.days.find((d) => d.id === where.dayId);
  if (!day) return null;
  const sessionId = where.sessionId ?? day.sessions[0]?.id ?? null;
  const session = day.sessions.find((s) => s.id === sessionId);
  if (what.kind === 'exercise') {
    const index = session && where.beforeItemId ? session.items.findIndex((i) => i.id === where.beforeItemId) : -1;
    return { kind: 'add', exercise: what.exercise, day: { id: day.id, date: day.date }, sessionId, index: index >= 0 ? index : null };
  }
  const found = findItem(week, what.itemId);
  if (!found) return null;
  const others = (session?.items ?? []).filter((i) => i.id !== what.itemId);
  const before = where.beforeItemId ? others.findIndex((i) => i.id === where.beforeItemId) : -1;
  const index = before >= 0 ? before : others.length;
  if (session && found.sessionId === session.id) {
    const now = session.items.findIndex((i) => i.id === what.itemId);
    if (now === index) return null; // dropped where it already is
  }
  return { kind: 'move', item: found.item, dayId: day.id, sessionId: session?.id ?? null, index };
}

/** The places "Move to…" offers for an item: the end of every other session, and empty days. */
export function moveTargets(week: Week, itemId: string): { label: string; target: Target }[] {
  const found = findItem(week, itemId);
  const out: { label: string; target: Target }[] = [];
  for (const day of week.days) {
    if (!day.sessions.length) {
      out.push({ label: `${shortDay(day.date)} (rest day)`, target: { dayId: day.id, sessionId: null, beforeItemId: null } });
      continue;
    }
    for (const session of day.sessions) {
      if (session.id === found?.sessionId && session.items.length === 1) continue;
      const name = day.sessions.length > 1 || session.name ? ` · ${session.name || 'Session'}` : '';
      const here = session.id === found?.sessionId ? ' (to the end)' : '';
      out.push({ label: `${shortDay(day.date)}${name}${here}`, target: { dayId: day.id, sessionId: session.id, beforeItemId: null } });
    }
  }
  return out;
}
