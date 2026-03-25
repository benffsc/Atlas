"use client";

import { useState, useEffect, useRef } from "react";
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
import type { IntakeSubmission } from "@/lib/intake-types";
import { SubmissionStatusBadge, formatDate, normalizeName } from "./IntakeBadges";
import { formatPhone } from "@/lib/formatters";
import { COLORS } from "@/lib/design-tokens";

const INTAKE_COLUMNS = [
  {
    status: "new",
    label: "New",
    color: "#3b82f6",
    bgColor: "#dbeafe",
  },
  {
    status: "in_progress",
    label: "In Progress",
    color: "#f59e0b",
    bgColor: "#fef3c7",
  },
  {
    status: "scheduled",
    label: "Scheduled",
    color: "#10b981",
    bgColor: "#d1fae5",
  },
  {
    status: "complete",
    label: "Complete",
    color: "#6b7280",
    bgColor: "#f3f4f6",
  },
] as const;

function truncateEmail(email: string | null | undefined, max = 24): string {
  if (!email) return "";
  return email.length > max ? email.slice(0, max - 1) + "\u2026" : email;
}

interface IntakeKanbanBoardProps {
  submissions: IntakeSubmission[];
  onOpenDetail?: (submission: IntakeSubmission) => void;
  onStatusChange?: (submissionId: string, newStatus: string) => Promise<void>;
  onError?: (message: string) => void;
}

function IntakeKanbanCard({
  submission,
  onOpenDetail,
}: {
  submission: IntakeSubmission;
  onOpenDetail?: (submission: IntakeSubmission) => void;
}) {
  const isUrgent = submission.is_emergency;
  const isOverdue = submission.overdue;
  const phone = formatPhone(submission.phone);
  const email = truncateEmail(submission.email);
  const contactParts = [phone, email].filter(Boolean);

  return (
    <div
      onClick={() => onOpenDetail?.(submission)}
      style={{
        background: "var(--card-bg, white)",
        border: `1px solid ${isUrgent ? COLORS.error : isOverdue ? COLORS.warning : "var(--card-border, #e5e7eb)"}`,
        borderRadius: "8px",
        padding: "0.75rem",
        cursor: "pointer",
        transition: "box-shadow 0.15s, transform 0.15s",
        borderLeft: isUrgent
          ? `3px solid ${COLORS.error}`
          : isOverdue
            ? `3px solid ${COLORS.warning}`
            : undefined,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Name + urgent badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.35rem",
        }}
      >
        <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>
          {normalizeName(submission.submitter_name)}
        </span>
        {isUrgent && (
          <span style={{ color: COLORS.error, fontSize: "0.7rem", fontWeight: 600 }}>
            URGENT
          </span>
        )}
      </div>

      {/* Address */}
      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--text-muted, #9ca3af)",
          marginBottom: "0.25rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {submission.geo_formatted_address || submission.cats_address || "No address"}
      </div>

      {/* Contact info */}
      {contactParts.length > 0 && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--text-muted, #9ca3af)",
            marginBottom: "0.35rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {contactParts.join(" | ")}
        </div>
      )}

      {/* Metadata row */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          fontSize: "0.7rem",
          color: "var(--text-muted, #9ca3af)",
          alignItems: "center",
        }}
      >
        <span
          style={{
            padding: "0.1rem 0.4rem",
            borderRadius: "999px",
            background: "var(--info-bg, #dbeafe)",
            color: "var(--primary, #2563eb)",
            fontSize: "0.7rem",
            fontWeight: 600,
          }}
        >
          {submission.cat_count_estimate ?? "?"} cats
        </span>
        <span>{formatDate(submission.submitted_at)}</span>
        {submission.triage_category && (
          <span
            style={{
              padding: "0.1rem 0.35rem",
              borderRadius: "4px",
              background: "var(--bg-secondary)",
              fontSize: "0.65rem",
            }}
          >
            {submission.triage_category}
          </span>
        )}
      </div>

      {isOverdue && (
        <div style={{ fontSize: "0.65rem", color: COLORS.warning, fontWeight: 500, marginTop: "0.25rem" }}>
          STALE
        </div>
      )}
    </div>
  );
}

function DraggableKanbanCard({
  submission,
  onOpenDetail,
  isRecentlyMoved,
}: {
  submission: IntakeSubmission;
  onOpenDetail?: (submission: IntakeSubmission) => void;
  isRecentlyMoved?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: submission.submission_id,
    data: { submission },
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
        borderLeft: isRecentlyMoved ? "3px solid var(--primary, #3b82f6)" : undefined,
        background: isRecentlyMoved ? "var(--info-bg, #eff6ff)" : undefined,
        borderRadius: isRecentlyMoved ? "8px" : undefined,
        transition: "background-color 0.5s ease, border-color 0.5s ease",
      }}
    >
      <IntakeKanbanCard submission={submission} onOpenDetail={onOpenDetail} />
    </div>
  );
}

function DroppableColumn({
  status,
  label,
  color,
  bgColor,
  count,
  children,
}: {
  status: string;
  label: string;
  color: string;
  bgColor: string;
  count: number;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      style={{
        background: bgColor,
        borderRadius: "8px",
        padding: "0.75rem",
        minHeight: "200px",
        outline: isOver ? `2px dashed ${color}` : "none",
        outlineOffset: "-2px",
        transition: "outline 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
          paddingBottom: "0.5rem",
          borderBottom: `2px solid ${color}`,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.85rem", color }}>
          {label}
        </span>
        <span
          style={{
            background: color,
            color: "#fff",
            padding: "0.1rem 0.4rem",
            borderRadius: "999px",
            fontSize: "0.75rem",
            fontWeight: 500,
          }}
        >
          {count}
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}

export function IntakeKanbanBoard({
  submissions,
  onOpenDetail,
  onStatusChange,
  onError,
}: IntakeKanbanBoardProps) {
  const [activeCard, setActiveCard] = useState<IntakeSubmission | null>(null);
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, string>>({});
  const [recentlyMoved, setRecentlyMoved] = useState<Set<string>>(new Set());
  const isDragPending = useRef(false);

  // Clear optimistic moves once the submissions prop refreshes with updated data
  const prevSubmissionsRef = useRef(submissions);
  useEffect(() => {
    if (submissions !== prevSubmissionsRef.current) {
      prevSubmissionsRef.current = submissions;
      setOptimisticMoves({});
    }
  }, [submissions]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  );

  const getEffectiveStatus = (sub: IntakeSubmission): string =>
    optimisticMoves[sub.submission_id] ?? sub.submission_status ?? "new";

  const columnData = INTAKE_COLUMNS.map((col) => ({
    ...col,
    items: submissions.filter((s) => getEffectiveStatus(s) === col.status),
  }));

  const handleDragStart = (event: DragStartEvent) => {
    const sub = event.active.data.current?.submission as IntakeSubmission | undefined;
    setActiveCard(sub ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    // Guard against rapid multi-drags
    if (isDragPending.current) return;

    const submissionId = active.id as string;
    const newStatus = over.id as string;
    const sub = submissions.find((s) => s.submission_id === submissionId);
    if (!sub) return;

    const currentStatus = sub.submission_status || "new";
    if (currentStatus === newStatus) return;

    // Optimistic update
    setOptimisticMoves((prev) => ({ ...prev, [submissionId]: newStatus }));
    isDragPending.current = true;

    if (onStatusChange) {
      try {
        await onStatusChange(submissionId, newStatus);
        // Mark as recently moved for highlight
        setRecentlyMoved((prev) => new Set(prev).add(submissionId));
        setTimeout(() => {
          setRecentlyMoved((prev) => {
            const next = new Set(prev);
            next.delete(submissionId);
            return next;
          });
        }, 3000);
      } catch (err) {
        console.error("Kanban drag failed:", err);
        // Revert on failure
        setOptimisticMoves((prev) => {
          const next = { ...prev };
          delete next[submissionId];
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
          gridTemplateColumns: `repeat(${INTAKE_COLUMNS.length}, 1fr)`,
          gap: "0.75rem",
          minHeight: "400px",
        }}
      >
        {columnData.map((col) => (
          <DroppableColumn
            key={col.status}
            status={col.status}
            label={col.label}
            color={col.color}
            bgColor={col.bgColor}
            count={col.items.length}
          >
            {col.items.map((sub) => (
              <DraggableKanbanCard
                key={sub.submission_id}
                submission={sub}
                onOpenDetail={onOpenDetail}
                isRecentlyMoved={recentlyMoved.has(sub.submission_id)}
              />
            ))}
            {col.items.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "2rem 1rem",
                  color: "var(--text-muted, #9ca3af)",
                  fontSize: "0.8rem",
                }}
              >
                No submissions
              </div>
            )}
          </DroppableColumn>
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard && (
          <div style={{ width: "260px", opacity: 0.9 }}>
            <IntakeKanbanCard submission={activeCard} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Mobile-friendly collapsible kanban for intake submissions.
 * Each column is a collapsible section.
 */
export function IntakeKanbanBoardMobile({ submissions, onOpenDetail, onStatusChange, onError }: IntakeKanbanBoardProps) {
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set(["new", "in_progress"]));
  const [movingId, setMovingId] = useState<string | null>(null);

  const toggleColumn = (status: string) => {
    setExpandedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const handleMobileStatusChange = async (submissionId: string, newStatus: string) => {
    if (!onStatusChange) return;
    setMovingId(submissionId);
    try {
      await onStatusChange(submissionId, newStatus);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to move");
    } finally {
      setMovingId(null);
    }
  };

  const columnData = INTAKE_COLUMNS.map((col) => ({
    ...col,
    items: submissions.filter((s) => (s.submission_status || "new") === col.status),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {columnData.map((col) => {
        const isExpanded = expandedColumns.has(col.status);
        return (
          <div
            key={col.status}
            style={{
              border: `1px solid ${col.color}`,
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => toggleColumn(col.status)}
              style={{
                width: "100%",
                padding: "0.75rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: col.bgColor,
                border: "none",
                cursor: "pointer",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: "0.85rem", color: col.color }}>
                {col.label}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span
                  style={{
                    background: col.color,
                    color: "#fff",
                    padding: "0.1rem 0.4rem",
                    borderRadius: "999px",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                  }}
                >
                  {col.items.length}
                </span>
                <span style={{ color: col.color, fontSize: "0.8rem" }}>
                  {isExpanded ? "\u25B2" : "\u25BC"}
                </span>
              </div>
            </button>

            {isExpanded && (
              <div style={{ padding: "0.5rem" }}>
                {col.items.map((sub) => (
                  <div key={sub.submission_id} style={{ marginBottom: "0.5rem" }}>
                    <IntakeKanbanCard
                      submission={sub}
                      onOpenDetail={onOpenDetail}
                    />
                    {onStatusChange && (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.25rem" }}>
                        <select
                          value={col.status}
                          disabled={movingId === sub.submission_id}
                          onChange={(e) => handleMobileStatusChange(sub.submission_id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.2rem 0.4rem",
                            borderRadius: "4px",
                            border: "1px solid var(--card-border, #e5e7eb)",
                            background: "var(--card-bg, white)",
                            color: "var(--text-muted, #6b7280)",
                            cursor: movingId === sub.submission_id ? "wait" : "pointer",
                            opacity: movingId === sub.submission_id ? 0.5 : 1,
                          }}
                        >
                          {INTAKE_COLUMNS.map((c) => (
                            <option key={c.status} value={c.status}>
                              {c.status === col.status ? `${c.label}` : `Move to ${c.label}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
                {col.items.length === 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "1rem",
                      color: "var(--text-muted, #9ca3af)",
                      fontSize: "0.8rem",
                    }}
                  >
                    No submissions
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
