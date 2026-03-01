"use client";

import { useState } from "react";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { formatDateLocal } from "@/lib/formatters";

// MIG_2530: Simplified 4-state status system
const KANBAN_COLUMNS = [
  {
    status: "new",
    label: "New",
    color: "#3b82f6",
    bgColor: "#dbeafe",
    description: "Awaiting initial review"
  },
  {
    status: "working",
    label: "Working",
    color: "#f59e0b",
    bgColor: "#fef3c7",
    description: "Actively being handled"
  },
  {
    status: "paused",
    label: "Paused",
    color: "#ec4899",
    bgColor: "#fce7f3",
    description: "On hold"
  },
  {
    status: "completed",
    label: "Completed",
    color: "#10b981",
    bgColor: "#d1fae5",
    description: "Finished"
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
  isUpdating?: boolean;
}

function KanbanCard({
  request,
  onStatusChange,
  isUpdating
}: {
  request: Request;
  onStatusChange?: (requestId: string, newStatus: string) => Promise<void>;
  isUpdating?: boolean;
}) {
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const hasKittens = request.has_kittens;
  const isPriority = request.priority === "urgent" || request.priority === "high";

  const handleStatusClick = async (newStatus: string) => {
    setShowStatusMenu(false);
    if (onStatusChange && newStatus !== request.status) {
      await onStatusChange(request.request_id, newStatus);
    }
  };

  return (
    <div
      style={{
        background: "var(--card-bg, white)",
        border: `1px solid ${isPriority ? "#f59e0b" : "var(--card-border, #e5e7eb)"}`,
        borderRadius: "8px",
        padding: "0.75rem",
        marginBottom: "0.5rem",
        cursor: "pointer",
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
      {/* Header: Priority + Status Dropdown */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <PriorityBadge priority={request.priority} />

        {/* Status change dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowStatusMenu(!showStatusMenu);
            }}
            disabled={isUpdating}
            style={{
              padding: "2px 6px",
              fontSize: "0.65rem",
              background: "var(--bg-secondary, #f3f4f6)",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: "4px",
              cursor: isUpdating ? "wait" : "pointer",
              color: "var(--text-muted)",
            }}
          >
            {isUpdating ? "..." : "Move"}
          </button>

          {showStatusMenu && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 99 }}
                onClick={(e) => { e.stopPropagation(); setShowStatusMenu(false); }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "4px",
                  background: "var(--card-bg, white)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  zIndex: 100,
                  minWidth: "120px",
                }}
              >
                {KANBAN_COLUMNS.map((col) => (
                  <button
                    key={col.status}
                    onClick={(e) => { e.stopPropagation(); handleStatusClick(col.status); }}
                    disabled={STATUS_TO_COLUMN[request.status] === col.status}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px 12px",
                      border: "none",
                      background: STATUS_TO_COLUMN[request.status] === col.status ? col.bgColor : "transparent",
                      textAlign: "left",
                      cursor: STATUS_TO_COLUMN[request.status] === col.status ? "default" : "pointer",
                      fontSize: "0.8rem",
                      color: STATUS_TO_COLUMN[request.status] === col.status ? col.color : "inherit",
                      fontWeight: STATUS_TO_COLUMN[request.status] === col.status ? 600 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (STATUS_TO_COLUMN[request.status] !== col.status) {
                        e.currentTarget.style.background = col.bgColor;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (STATUS_TO_COLUMN[request.status] !== col.status) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {col.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
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

      {/* Footer: Cat count, Kittens, Date */}
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
        <span title={formatDateLocal(request.source_created_at || request.created_at, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric" })}>
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

export function KanbanBoard({ requests, onStatusChange, isUpdating }: KanbanBoardProps) {
  // Group requests by column
  const columns = KANBAN_COLUMNS.map((col) => {
    const columnRequests = requests.filter(
      (req) => STATUS_TO_COLUMN[req.status] === col.status
    );
    return {
      ...col,
      requests: columnRequests,
    };
  });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "1rem",
        minHeight: "400px",
      }}
    >
      {columns.map((column) => (
        <div
          key={column.status}
          style={{
            background: "var(--bg-secondary, #f9fafb)",
            borderRadius: "10px",
            padding: "0.75rem",
            minHeight: "300px",
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
              borderBottom: `2px solid ${column.color}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: column.color,
                }}
              />
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                {column.label}
              </span>
            </div>
            <span
              style={{
                background: column.bgColor,
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

          {/* Column Description */}
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              marginBottom: "0.75rem",
            }}
          >
            {column.description}
          </div>

          {/* Cards */}
          <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 350px)" }}>
            {column.requests.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "2rem 1rem",
                  color: "var(--text-muted)",
                  fontSize: "0.8rem",
                  fontStyle: "italic",
                }}
              >
                No requests
              </div>
            ) : (
              column.requests.map((request) => (
                <KanbanCard
                  key={request.request_id}
                  request={request}
                  onStatusChange={onStatusChange}
                  isUpdating={isUpdating}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Mobile-friendly stacked view
export function KanbanBoardMobile({ requests, onStatusChange, isUpdating }: KanbanBoardProps) {
  const [expandedColumn, setExpandedColumn] = useState<string | null>("new");

  const columns = KANBAN_COLUMNS.map((col) => {
    const columnRequests = requests.filter(
      (req) => STATUS_TO_COLUMN[req.status] === col.status
    );
    return {
      ...col,
      requests: columnRequests,
    };
  });

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
          {/* Collapsible Header */}
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
                  background: "white",
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
              {expandedColumn === column.status ? "▼" : "▶"}
            </span>
          </button>

          {/* Expandable Content */}
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
                  <KanbanCard
                    key={request.request_id}
                    request={request}
                    onStatusChange={onStatusChange}
                    isUpdating={isUpdating}
                  />
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
