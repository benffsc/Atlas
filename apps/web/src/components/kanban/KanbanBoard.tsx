"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KanbanColumn {
  status: string;
  label: string;
  color: string;
  bgColor: string;
  description?: string;
}

export interface KanbanBoardProps<TItem> {
  /** Column definitions (status, label, color, bgColor) */
  columns: KanbanColumn[];
  /** All items — board groups them into columns via getItemStatus */
  items: TItem[];
  /** Extract unique ID from an item */
  getItemId: (item: TItem) => string;
  /** Extract the current status string used to bucket into columns */
  getItemStatus: (item: TItem) => string;
  /** Render a single card. Receives the item — wrap in your own component. */
  renderCard: (item: TItem) => ReactNode;
  /** Render the drag overlay ghost (optional, defaults to renderCard at 90% opacity) */
  renderDragOverlay?: (item: TItem) => ReactNode;
  /** Called when a card is dropped into a new column. Must persist to server. */
  onStatusChange?: (itemId: string, newStatus: string) => Promise<void>;
  /** Called before the optimistic move. Return false to cancel the drop. */
  onBeforeDrop?: (itemId: string, fromStatus: string, toStatus: string) => Promise<boolean> | boolean;
  /** Called on drag/API error */
  onError?: (message: string) => void;
  /** Map a raw status to a column status (e.g. legacy status normalization) */
  statusToColumn?: (status: string) => string;
}

// ---------------------------------------------------------------------------
// Internal: Draggable card wrapper
// ---------------------------------------------------------------------------

function DraggableCard<TItem>({
  item,
  itemId,
  renderCard,
  isRecentlyMoved,
}: {
  item: TItem;
  itemId: string;
  renderCard: (item: TItem) => ReactNode;
  isRecentlyMoved: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: itemId,
    data: { item },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        marginBottom: "0.5rem",
        opacity: isDragging ? 0.4 : 1,
        touchAction: "none",
        borderLeft: isRecentlyMoved ? "3px solid #3b82f6" : undefined,
        background: isRecentlyMoved ? "#eff6ff" : undefined,
        borderRadius: isRecentlyMoved ? "8px" : undefined,
        transition: "background-color 0.5s ease, border-color 0.5s ease, opacity 0.15s",
        cursor: isDragging ? "grabbing" : "grab",
      }}
    >
      {renderCard(item)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: Droppable column
// ---------------------------------------------------------------------------

function DroppableColumn({
  status,
  label,
  color,
  bgColor,
  description,
  count,
  children,
}: {
  status: string;
  label: string;
  color: string;
  bgColor: string;
  description?: string;
  count: number;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? bgColor : "var(--bg-secondary, #f9fafb)",
        borderRadius: "10px",
        padding: "0.75rem",
        minHeight: "300px",
        outline: isOver ? `2px dashed ${color}` : "none",
        outlineOffset: "-2px",
        transition: "outline 0.15s, background 0.15s",
      }}
    >
      {/* Column Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
          paddingBottom: "0.5rem",
          borderBottom: `2px solid ${color}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: color,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
            {label}
          </span>
        </div>
        <span
          style={{
            background: bgColor,
            color: color,
            padding: "2px 8px",
            borderRadius: "10px",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}
        >
          {count}
        </span>
      </div>

      {/* Column Description */}
      {description && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            marginBottom: "0.75rem",
          }}
        >
          {description}
        </div>
      )}

      {/* Cards */}
      <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 350px)" }}>
        {children}
        {count === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "2rem 1rem",
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              fontStyle: "italic",
            }}
          >
            {isOver ? "Drop here" : "No items"}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main: KanbanBoard
// ---------------------------------------------------------------------------

export function KanbanBoard<TItem>({
  columns,
  items,
  getItemId,
  getItemStatus,
  renderCard,
  renderDragOverlay,
  onStatusChange,
  onBeforeDrop,
  onError,
  statusToColumn,
}: KanbanBoardProps<TItem>) {
  const [activeItem, setActiveItem] = useState<TItem | null>(null);
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, string>>({});
  const [recentlyMoved, setRecentlyMoved] = useState<Set<string>>(new Set());
  const isDragPending = useRef(false);

  // Clear optimistic moves when items refresh from server
  const prevItemsRef = useRef(items);
  useEffect(() => {
    if (items !== prevItemsRef.current) {
      prevItemsRef.current = items;
      setOptimisticMoves({});
    }
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const resolveColumn = (status: string) =>
    statusToColumn ? statusToColumn(status) : status;

  const getEffectiveColumn = (item: TItem): string => {
    const id = getItemId(item);
    if (optimisticMoves[id]) return optimisticMoves[id];
    return resolveColumn(getItemStatus(item));
  };

  const columnData = columns.map((col) => ({
    ...col,
    items: items.filter((item) => getEffectiveColumn(item) === col.status),
  }));

  const handleDragStart = (event: DragStartEvent) => {
    const item = event.active.data.current?.item as TItem | undefined;
    setActiveItem(item ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;
    if (isDragPending.current) return;

    const itemId = active.id as string;
    const newStatus = over.id as string;
    const item = items.find((i) => getItemId(i) === itemId);
    if (!item) return;

    const currentColumn = resolveColumn(getItemStatus(item));
    if (currentColumn === newStatus) return;

    // Allow consumer to cancel the drop (e.g. show confirmation modal)
    if (onBeforeDrop) {
      const proceed = await onBeforeDrop(itemId, currentColumn, newStatus);
      if (!proceed) return;
    }

    // Optimistic update — card moves immediately
    setOptimisticMoves((prev) => ({ ...prev, [itemId]: newStatus }));
    isDragPending.current = true;

    if (onStatusChange) {
      try {
        await onStatusChange(itemId, newStatus);
        // Briefly highlight the moved card
        setRecentlyMoved((prev) => new Set(prev).add(itemId));
        setTimeout(() => {
          setRecentlyMoved((prev) => {
            const next = new Set(prev);
            next.delete(itemId);
            return next;
          });
        }, 3000);
      } catch (err) {
        // Revert on failure — card snaps back
        setOptimisticMoves((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        const message = err instanceof Error ? err.message : "Failed to move — please try again";
        onError?.(message);
      } finally {
        isDragPending.current = false;
      }
    } else {
      isDragPending.current = false;
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns.length}, minmax(0, var(--kanban-col-max-width, 380px)))`,
          gap: "1rem",
          minHeight: "400px",
          justifyContent: "center",
        }}
      >
        {columnData.map((col) => (
          <DroppableColumn
            key={col.status}
            status={col.status}
            label={col.label}
            color={col.color}
            bgColor={col.bgColor}
            description={col.description}
            count={col.items.length}
          >
            {col.items.map((item) => (
              <DraggableCard
                key={getItemId(item)}
                item={item}
                itemId={getItemId(item)}
                renderCard={renderCard}
                isRecentlyMoved={recentlyMoved.has(getItemId(item))}
              />
            ))}
          </DroppableColumn>
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem && (
          <div style={{ width: "280px", opacity: 0.9 }}>
            {renderDragOverlay ? renderDragOverlay(activeItem) : renderCard(activeItem)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
