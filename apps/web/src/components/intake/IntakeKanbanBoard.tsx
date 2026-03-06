"use client";

import { useState } from "react";
import type { IntakeSubmission } from "@/lib/intake-types";
import { SubmissionStatusBadge, formatDate, normalizeName } from "./IntakeBadges";
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

interface IntakeKanbanBoardProps {
  submissions: IntakeSubmission[];
  onOpenDetail?: (submission: IntakeSubmission) => void;
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

  return (
    <div
      onClick={() => onOpenDetail?.(submission)}
      style={{
        background: "var(--card-bg, white)",
        border: `1px solid ${isUrgent ? COLORS.error : isOverdue ? COLORS.warning : "var(--card-border, #e5e7eb)"}`,
        borderRadius: "8px",
        padding: "0.75rem",
        marginBottom: "0.5rem",
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

      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--text-muted, #9ca3af)",
          marginBottom: "0.35rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {submission.geo_formatted_address || submission.cats_address || "No address"}
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          fontSize: "0.7rem",
          color: "var(--text-muted, #9ca3af)",
          alignItems: "center",
        }}
      >
        <span>{submission.cat_count_estimate ?? "?"} cats</span>
        <span>{formatDate(submission.submitted_at)}</span>
        {submission.triage_category && (
          <span
            style={{
              padding: "0.1rem 0.35rem",
              borderRadius: "4px",
              background: "#f3f4f6",
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

export function IntakeKanbanBoard({ submissions, onOpenDetail }: IntakeKanbanBoardProps) {
  const columnData = INTAKE_COLUMNS.map((col) => ({
    ...col,
    items: submissions.filter((s) => (s.submission_status || "new") === col.status),
  }));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${INTAKE_COLUMNS.length}, 1fr)`,
        gap: "0.75rem",
        minHeight: "400px",
      }}
    >
      {columnData.map((col) => (
        <div
          key={col.status}
          style={{
            background: col.bgColor,
            borderRadius: "8px",
            padding: "0.75rem",
            minHeight: "200px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem",
              paddingBottom: "0.5rem",
              borderBottom: `2px solid ${col.color}`,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.85rem", color: col.color }}>
              {col.label}
            </span>
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
          </div>

          <div>
            {col.items.map((sub) => (
              <IntakeKanbanCard
                key={sub.submission_id}
                submission={sub}
                onOpenDetail={onOpenDetail}
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
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Mobile-friendly collapsible kanban for intake submissions.
 * Each column is a collapsible section.
 */
export function IntakeKanbanBoardMobile({ submissions, onOpenDetail }: IntakeKanbanBoardProps) {
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set(["new", "in_progress"]));

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
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>
            </button>

            {isExpanded && (
              <div style={{ padding: "0.5rem" }}>
                {col.items.map((sub) => (
                  <IntakeKanbanCard
                    key={sub.submission_id}
                    submission={sub}
                    onOpenDetail={onOpenDetail}
                  />
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
