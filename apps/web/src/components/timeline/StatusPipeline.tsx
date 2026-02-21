"use client";

/**
 * StatusPipeline - Visual request status pipeline
 *
 * Shows the request lifecycle stages with the current position highlighted.
 * Includes progress indicator and days elapsed.
 *
 * Request lifecycle:
 * new → triaged → scheduled → in_progress → completed
 *         ↓
 *      on_hold → cancelled
 */

interface StatusPipelineProps {
  currentStatus: string;
  createdAt: string;
  resolvedAt?: string | null;
}

const MAIN_STATUSES = ["new", "triaged", "scheduled", "in_progress", "completed"];
const BRANCH_STATUSES = ["on_hold", "cancelled", "redirected"];

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  on_hold: "On Hold",
  cancelled: "Cancelled",
  redirected: "Redirected",
};

const STATUS_COLORS: Record<string, string> = {
  new: "#94a3b8",
  triaged: "#3b82f6",
  scheduled: "#8b5cf6",
  in_progress: "#f59e0b",
  completed: "#22c55e",
  on_hold: "#f97316",
  cancelled: "#ef4444",
  redirected: "#6366f1",
};

function getDaysElapsed(createdAt: string, resolvedAt?: string | null): number {
  const start = new Date(createdAt);
  const end = resolvedAt ? new Date(resolvedAt) : new Date();
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getProgressPercentage(status: string): number {
  const mainIndex = MAIN_STATUSES.indexOf(status);
  if (mainIndex >= 0) {
    return ((mainIndex + 1) / MAIN_STATUSES.length) * 100;
  }
  // Branch statuses
  if (status === "on_hold") return 50;
  if (status === "cancelled" || status === "redirected") return 100;
  return 0;
}

export function StatusPipeline({
  currentStatus,
  createdAt,
  resolvedAt,
}: StatusPipelineProps) {
  const daysElapsed = getDaysElapsed(createdAt, resolvedAt);
  const progress = getProgressPercentage(currentStatus);
  const currentIndex = MAIN_STATUSES.indexOf(currentStatus);
  const isBranch = BRANCH_STATUSES.includes(currentStatus);
  const isTerminal = ["completed", "cancelled", "redirected"].includes(currentStatus);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Main pipeline */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          marginBottom: 16,
          position: "relative",
        }}
      >
        {MAIN_STATUSES.map((status, index) => {
          const isActive = status === currentStatus;
          const isPast = currentIndex > index || (isBranch && index <= 1);
          const isFuture = !isPast && !isActive;

          return (
            <div
              key={status}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                position: "relative",
              }}
            >
              {/* Connection line */}
              {index > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 0,
                    right: "50%",
                    height: 3,
                    background: isPast || isActive ? STATUS_COLORS[status] : "#e5e7eb",
                    zIndex: 0,
                  }}
                />
              )}
              {index < MAIN_STATUSES.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: "50%",
                    right: 0,
                    height: 3,
                    background: isPast ? STATUS_COLORS[MAIN_STATUSES[index + 1]] : "#e5e7eb",
                    zIndex: 0,
                  }}
                />
              )}

              {/* Status dot */}
              <div
                style={{
                  width: isActive ? 28 : 24,
                  height: isActive ? 28 : 24,
                  borderRadius: "50%",
                  background: isPast || isActive ? STATUS_COLORS[status] : "#e5e7eb",
                  border: isActive ? `3px solid ${STATUS_COLORS[status]}` : "3px solid white",
                  boxShadow: isActive ? `0 0 0 3px ${STATUS_COLORS[status]}40` : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 600,
                  zIndex: 1,
                  transition: "all 0.2s",
                }}
              >
                {isPast && "✓"}
              </div>

              {/* Label */}
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? STATUS_COLORS[status] : isPast ? "#374151" : "#9ca3af",
                  textAlign: "center",
                }}
              >
                {STATUS_LABELS[status]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Branch statuses indicator */}
      {isBranch && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: "20%",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 2,
              height: 24,
              background: STATUS_COLORS[currentStatus],
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: `${STATUS_COLORS[currentStatus]}15`,
              borderRadius: 6,
              border: `1px solid ${STATUS_COLORS[currentStatus]}40`,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: STATUS_COLORS[currentStatus],
              }}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: STATUS_COLORS[currentStatus],
              }}
            >
              {STATUS_LABELS[currentStatus]}
            </span>
          </div>
        </div>
      )}

      {/* Progress bar and stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 16px",
          background: "#f9fafb",
          borderRadius: 8,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              height: 8,
              background: "#e5e7eb",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: isTerminal
                  ? STATUS_COLORS[currentStatus]
                  : `linear-gradient(90deg, ${STATUS_COLORS.new} 0%, ${STATUS_COLORS[currentStatus]} 100%)`,
                borderRadius: 4,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#6b7280",
            whiteSpace: "nowrap",
          }}
        >
          {isTerminal ? (
            <span>
              {currentStatus === "completed" ? "✓ Completed" : currentStatus === "cancelled" ? "✗ Cancelled" : "→ Redirected"} in {daysElapsed} {daysElapsed === 1 ? "day" : "days"}
            </span>
          ) : (
            <span>
              Day {daysElapsed + 1} • {Math.round(progress)}% complete
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
