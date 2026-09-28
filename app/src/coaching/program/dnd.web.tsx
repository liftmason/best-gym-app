/**
 * Drag and drop on the web (dnd-kit): drag a card to another place on the board, or an
 * exercise from the rail onto a day. A small movement threshold keeps clicks as clicks.
 * The wrappers are <div>s, since dnd-kit needs DOM nodes; they are flex columns so the board's
 * buttons inside them stretch as they would in a View.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { colors } from "@/ui";

import type { Dragged, Target } from "./dnd";

export type { Dragged, Target } from "./dnd";

export function BoardDnd({
  children,
  onDrop,
}: {
  children: ReactNode;
  onDrop: (what: Dragged, where: Target) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [dragging, setDragging] = useState<{ label: string } | null>(null);
  const start = (event: DragStartEvent) =>
    setDragging({ label: String(event.active.data.current?.label ?? "") });
  const end = (event: DragEndEvent) => {
    setDragging(null);
    const what = event.active.data.current?.dragged as Dragged | undefined;
    const where = event.over?.data.current as Target | undefined;
    if (what && where) onDrop(what, where);
  };
  return (
    <DndContext
      sensors={sensors}
      onDragStart={start}
      onDragEnd={end}
      onDragCancel={() => setDragging(null)}
    >
      {children}
      {/* In a portal: a transformed ancestor (the navigator's screens) would offset a fixed overlay, and the drop would miss. */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div
              style={{
                background: colors.surface,
                border: `1.5px solid ${colors.brand}`,
                borderRadius: 10,
                padding: "8px 12px",
                font: "600 13px Inter_600SemiBold, Inter, system-ui, sans-serif",
                color: colors.ink,
                boxShadow: "0 12px 32px rgba(20,24,31,.18)",
                cursor: "grabbing",
                whiteSpace: "nowrap",
              }}
            >
              {dragging.label}
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

export function Draggable({
  id,
  data,
  children,
  disabled,
}: {
  id: string;
  data: Dragged;
  children: ReactNode;
  disabled?: boolean;
}) {
  const label = data.kind === "exercise" ? data.exercise.name : data.name;
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id,
    data: { dragged: data, label },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role={undefined}
      tabIndex={undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        opacity: isDragging ? 0.35 : 1,
        touchAction: "none",
      }}
    >
      {children}
    </div>
  );
}

export function DropZone({
  id,
  data,
  children,
}: {
  id: string;
  data: Target;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        outline: isOver ? `2px dashed ${colors.brand}` : "none",
        outlineOffset: 2,
      }}
    >
      {children}
    </div>
  );
}

export const dragAvailable = true;
