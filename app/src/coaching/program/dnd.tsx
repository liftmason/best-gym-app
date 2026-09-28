/**
 * Drag and drop on the board. It is web-only (dnd-kit, in dnd.web.tsx); on phones these
 * render their children, and every move is in a card's menu instead ("Move to…"), which
 * calls the same commands.
 */
import type { ReactNode } from 'react';

/** What is being dragged: a card on the board, or an exercise from the library rail. */
export type Dragged = { kind: 'item'; itemId: string; name: string } | { kind: 'exercise'; exercise: { id: string; name: string } };
/** Where it was dropped: before an item of a session, at the end of a session, or onto a day. */
export type Target = { dayId: string; sessionId: string | null; beforeItemId: string | null };

export function BoardDnd({ children }: { children: ReactNode; onDrop: (what: Dragged, where: Target) => void }) {
  return <>{children}</>;
}

export function Draggable({ children }: { id: string; data: Dragged; children: ReactNode; disabled?: boolean }) {
  return <>{children}</>;
}

export function DropZone({ children }: { id: string; data: Target; children: ReactNode }) {
  return <>{children}</>;
}

export const dragAvailable = false;
