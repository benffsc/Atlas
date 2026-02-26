"use client";

/**
 * StatusPipeline - Visual request status pipeline
 *
 * Shows the simplified 4-state request lifecycle with the current position highlighted.
 * Includes progress indicator and days elapsed.
 *
 * Request lifecycle (MIG_2530):
 *   new → working → completed
 *          ↓  ↑
 *        paused
 *
 * Special terminal statuses: redirected, handed_off
 *
 * Legacy statuses are automatically mapped to their primary equivalents
 * for display (e.g., "scheduled" displays in "working" column).
 */

import {
  PRIMARY_STATUSES,
  SPECIAL_STATUSES,
  mapToPrimaryStatus,
  getStatusLabel,
  getStatusColor,
  isTerminalStatus,
  isLegacyStatus,
  STATUS_LABELS_DETAILED,
  WORKFLOW_DIAGRAM,
  type RequestStatus,
  type PrimaryStatus,
} from "@/lib/request-status";

interface StatusPipelineProps {
  currentStatus: string;
  createdAt: string;
  resolvedAt?: string | null;
}

// Main workflow stages in display order
const MAIN_FLOW: PrimaryStatus[] = ["new", "working", "completed"];

// Paused is a branch that can return to workflow
const BRANCH_STATUS: PrimaryStatus = "paused";

function getDaysElapsed(createdAt: string, resolvedAt?: string | null): number {
  const start = new Date(createdAt);
  const end = resolvedAt ? new Date(resolvedAt) : new Date();
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getProgressPercentage(status: RequestStatus): number {
  const primary = mapToPrimaryStatus(status);
  const mainIndex = MAIN_FLOW.indexOf(primary);

  if (mainIndex >= 0) {
    // Main flow: new=33%, working=66%, completed=100%
    return ((mainIndex + 1) / MAIN_FLOW.length) * 100;
  }

  // Paused is between working and completed
  if (primary === "paused") return 50;

  // Special statuses are terminal
  if (SPECIAL_STATUSES.includes(status as typeof SPECIAL_STATUSES[number])) {
    return 100;
  }

  return 0;
}

/**
 * Get the main flow index, accounting for legacy status mapping.
 * Returns -1 if the status is not in the main flow.
 */
function getMainFlowIndex(status: RequestStatus): number {
  const primary = mapToPrimaryStatus(status);
  return MAIN_FLOW.indexOf(primary);
}

export function StatusPipeline({
  currentStatus,
  createdAt,
  resolvedAt,
}: StatusPipelineProps) {
  // Map to primary status for display logic
  const status = currentStatus as RequestStatus;
  const primaryStatus = mapToPrimaryStatus(status);
  const isLegacy = isLegacyStatus(status);

  const daysElapsed = getDaysElapsed(createdAt, resolvedAt);
  const progress = getProgressPercentage(status);
  const currentIndex = getMainFlowIndex(status);
  const isPaused = primaryStatus === "paused";
  const isSpecial = SPECIAL_STATUSES.includes(status as typeof SPECIAL_STATUSES[number]);
  const isTerminal = isTerminalStatus(status);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Legacy status indicator */}
      {isLegacy && (
        <div
          style={{
            marginBottom: 12,
            padding: "6px 12px",
            background: "#fef3c7",
            borderRadius: 6,
            fontSize: 11,
            color: "#92400e",
          }}
        >
          Legacy status: <strong>{STATUS_LABELS_DETAILED[status]}</strong> → displayed as <strong>{getStatusLabel(status)}</strong>
        </div>
      )}

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
        {MAIN_FLOW.map((flowStatus, index) => {
          const colors = getStatusColor(flowStatus);
          const isActive = primaryStatus === flowStatus && !isPaused && !isSpecial;
          const isPast = currentIndex > index || (isPaused && index < 1) || (isSpecial && index < MAIN_FLOW.length - 1);
          const isFuture = !isPast && !isActive;

          return (
            <div
              key={flowStatus}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                position: "relative",
              }}
            >
              {/* Connection line - left half */}
              {index > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 0,
                    right: "50%",
                    height: 3,
                    background: isPast || isActive ? colors.border : "#e5e7eb",
                    zIndex: 0,
                  }}
                />
              )}
              {/* Connection line - right half */}
              {index < MAIN_FLOW.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: "50%",
                    right: 0,
                    height: 3,
                    background: isPast ? getStatusColor(MAIN_FLOW[index + 1]).border : "#e5e7eb",
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
                  background: isPast || isActive ? colors.border : "#e5e7eb",
                  border: isActive ? `3px solid ${colors.border}` : "3px solid white",
                  boxShadow: isActive ? `0 0 0 3px ${colors.border}40` : "none",
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
                  color: isActive ? colors.color : isPast ? "#374151" : "#9ca3af",
                  textAlign: "center",
                }}
              >
                {getStatusLabel(flowStatus)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Branch indicator for paused status */}
      {isPaused && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: "33%",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 2,
              height: 24,
              background: getStatusColor("paused").border,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: getStatusColor("paused").bg,
              borderRadius: 6,
              border: `1px solid ${getStatusColor("paused").border}`,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: getStatusColor("paused").border,
              }}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: getStatusColor("paused").color,
              }}
            >
              {getStatusLabel("paused")}
            </span>
            <span
              style={{
                fontSize: 10,
                color: "#6b7280",
                marginLeft: 4,
              }}
            >
              (can resume)
            </span>
          </div>
        </div>
      )}

      {/* Special status indicator (redirected, handed_off) */}
      {isSpecial && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: "66%",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 2,
              height: 24,
              background: getStatusColor(status).border,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: getStatusColor(status).bg,
              borderRadius: 6,
              border: `1px solid ${getStatusColor(status).border}`,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: getStatusColor(status).border,
              }}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: getStatusColor(status).color,
              }}
            >
              {getStatusLabel(status)}
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
                  ? getStatusColor(status).border
                  : `linear-gradient(90deg, ${getStatusColor("new").border} 0%, ${getStatusColor(primaryStatus).border} 100%)`,
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
              {primaryStatus === "completed"
                ? "✓ Completed"
                : status === "redirected"
                  ? "→ Redirected"
                  : status === "handed_off"
                    ? "→ Handed Off"
                    : "✓ Done"
              } in {daysElapsed} {daysElapsed === 1 ? "day" : "days"}
            </span>
          ) : isPaused ? (
            <span>
              Paused • Day {daysElapsed + 1}
            </span>
          ) : (
            <span>
              Day {daysElapsed + 1} • {Math.round(progress)}% complete
            </span>
          )}
        </div>
      </div>

      {/* Workflow legend for non-terminal statuses */}
      {!isTerminal && (
        <div
          style={{
            marginTop: 12,
            fontSize: 10,
            color: "#9ca3af",
            textAlign: "center",
          }}
        >
          Workflow: New → Working → Completed (Paused can resume at any point)
        </div>
      )}
    </div>
  );
}
