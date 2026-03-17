"use client";

import { useState } from "react";
import { PriorityBadge } from "@/components/badges";
import { formatDateLocal } from "@/lib/formatters";
import { REQUEST_STATUS_COLORS } from "@/lib/design-tokens";
import { KanbanBoard as SharedKanbanBoard } from "@/components/kanban";
import type { KanbanColumn } from "@/components/kanban";

// MIG_2530: Simplified 4-state status system
const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    status: "new",
    label: "New",
    color: REQUEST_STATUS_COLORS.new.border,
    bgColor: REQUEST_STATUS_COLORS.new.bg,
    description: "Awaiting initial review",
  },
  {
    status: "working",
    label: "Working",
    color: REQUEST_STATUS_COLORS.working.border,
    bgColor: REQUEST_STATUS_COLORS.working.bg,
    description: "Actively being handled",
  },
  {
    status: "paused",
    label: "Paused",
    color: REQUEST_STATUS_COLORS.paused.border,
    bgColor: REQUEST_STATUS_COLORS.paused.bg,
    description: "On hold",
  },
  {
    status: "completed",
    label: "Completed",
    color: REQUEST_STATUS_COLORS.completed.border,
    bgColor: REQUEST_STATUS_COLORS.completed.bg,
    description: "Finished",
  },
];

// Map legacy statuses to kanban columns
const STATUS_TO_COLUMN: Record<string, string> = {
  new: "new",
  triaged: "new",
  scheduled: "working",
  in_progress: "working",
  working: "working",
  on_hold: "paused",
  paused: "paused",
  completed: "completed",
  cancelled: "completed",
  partial: "completed",
  redirected: "completed",
  handed_off: "completed",
};

interface Request {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_name: string | null;
  created_at: string;
  source_created_at: string | null;
  primary_trapper_name: string | null;
  data_quality_flags: string[];
  requester_is_site_contact: boolean | null;
}

interface KanbanBoardProps {
  requests: Request[];
  onStatusChange?: (requestId: string, newStatus: string) => Promise<void>;
  onBeforeDrop?: (itemId: string, fromStatus: string, toStatus: string) => Promise<boolean> | boolean;
  isUpdating?: boolean;
}

function RequestKanbanCard({ request }: { request: Request }) {
  const hasKittens = request.has_kittens;
  const isPriority = request.priority === "urgent" || request.priority === "high";

  return (
    <div
      style={{
        background: "var(--card-bg, white)",
        border: `1px solid ${isPriority ? REQUEST_STATUS_COLORS.working.border : "var(--card-border, #e5e7eb)"}`,
        borderRadius: "8px",
        padding: "0.75rem",
        cursor: "grab",
        transition: "box-shadow 0.15s, transform 0.15s",
        boxShadow: isPriority ? "0 0 0 1px #fbbf24" : undefined,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = isPriority ? "0 0 0 1px #fbbf24" : "none";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <PriorityBadge priority={request.priority} />
      </div>

      {/* Title */}
      <a
        href={`/requests/${request.request_id}`}
        style={{
          display: "block",
          fontWeight: 500,
          fontSize: "0.85rem",
          color: "var(--foreground)",
          textDecoration: "none",
          marginBottom: "0.4rem",
          lineHeight: 1.3,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={request.summary || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {request.summary || <span style={{ color: "var(--text-muted)" }}>No summary</span>}
      </a>

      {/* Location */}
      {(request.place_name || request.place_city) && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            marginBottom: "0.4rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {request.place_name || request.place_city}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          marginTop: "0.5rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <span title="Cat count">
            {request.estimated_cat_count ?? "?"} cat{(request.estimated_cat_count ?? 0) !== 1 ? "s" : ""}
          </span>
          {hasKittens && (
            <span
              style={{
                background: "#fef3c7",
                color: "#92400e",
                padding: "1px 4px",
                borderRadius: "3px",
                fontWeight: 500,
              }}
            >
              Kittens
            </span>
          )}
        </div>
        <span>
          {formatDateLocal(request.source_created_at || request.created_at)}
        </span>
      </div>

      {/* Trapper / Requester */}
      {(request.primary_trapper_name || request.requester_name) && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            marginTop: "0.4rem",
            display: "flex",
            gap: "0.5rem",
          }}
        >
          {request.primary_trapper_name && (
            <span title="Assigned trapper">Trapper: {request.primary_trapper_name}</span>
          )}
          {request.requester_name && !request.primary_trapper_name && (
            <span title="Requester">From: {request.requester_name}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function KanbanBoard({ requests, onStatusChange, onBeforeDrop }: KanbanBoardProps) {
  return (
    <SharedKanbanBoard<Request>
      columns={KANBAN_COLUMNS}
      items={requests}
      getItemId={(r) => r.request_id}
      getItemStatus={(r) => r.status}
      statusToColumn={(status) => STATUS_TO_COLUMN[status] || status}
      renderCard={(r) => <RequestKanbanCard request={r} />}
      onStatusChange={onStatusChange}
      onBeforeDrop={onBeforeDrop}
    />
  );
}

// Mobile-friendly stacked view — uses dropdown instead of drag
export function KanbanBoardMobile({ requests, onStatusChange }: KanbanBoardProps) {
  const [expandedColumn, setExpandedColumn] = useState<string | null>("new");
  const [movingId, setMovingId] = useState<string | null>(null);

  const columns = KANBAN_COLUMNS.map((col) => ({
    ...col,
    requests: requests.filter(
      (req) => (STATUS_TO_COLUMN[req.status] || req.status) === col.status,
    ),
  }));

  const handleMobileStatusChange = async (requestId: string, newStatus: string) => {
    if (!onStatusChange) return;
    setMovingId(requestId);
    try {
      await onStatusChange(requestId, newStatus);
    } catch (err) {
      console.error("Mobile status change failed:", err);
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {columns.map((column) => (
        <div
          key={column.status}
          style={{
            background: "var(--bg-secondary, #f9fafb)",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <button
            onClick={() => setExpandedColumn(expandedColumn === column.status ? null : column.status)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.75rem 1rem",
              background: column.bgColor,
              border: "none",
              cursor: "pointer",
              borderLeft: `4px solid ${column.color}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.9rem", color: column.color }}>
                {column.label}
              </span>
              <span
                style={{
                  background: "var(--background)",
                  color: column.color,
                  padding: "2px 8px",
                  borderRadius: "10px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {column.requests.length}
              </span>
            </div>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {expandedColumn === column.status ? "\u25BC" : "\u25B6"}
            </span>
          </button>

          {expandedColumn === column.status && (
            <div style={{ padding: "0.75rem" }}>
              {column.requests.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "1rem",
                    color: "var(--text-muted)",
                    fontSize: "0.8rem",
                    fontStyle: "italic",
                  }}
                >
                  No requests
                </div>
              ) : (
                column.requests.map((request) => (
                  <div key={request.request_id} style={{ marginBottom: "0.5rem" }}>
                    <RequestKanbanCard request={request} />
                    {onStatusChange && (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.25rem" }}>
                        <select
                          value={column.status}
                          disabled={movingId === request.request_id}
                          onChange={(e) => handleMobileStatusChange(request.request_id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.2rem 0.4rem",
                            borderRadius: "4px",
                            border: "1px solid var(--card-border, #e5e7eb)",
                            background: "var(--card-bg, white)",
                            color: "var(--text-muted)",
                            cursor: movingId === request.request_id ? "wait" : "pointer",
                            opacity: movingId === request.request_id ? 0.5 : 1,
                          }}
                        >
                          {KANBAN_COLUMNS.map((c) => (
                            <option key={c.status} value={c.status}>
                              {c.status === column.status ? c.label : `Move to ${c.label}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
