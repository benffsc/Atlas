"use client";

import type { RequestDetail } from "@/app/requests/[id]/types";
import { mapToPrimaryStatus } from "@/lib/request-status";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";
import { REQUEST_STATUS_COLORS } from "@/lib/design-tokens";
import { Icon } from "@/components/ui/Icon";

// ─── Style Constants ────────────────────────────────────────────────────────

const BAR_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: SPACING.md,
  padding: "0.75rem 1rem",
  borderRadius: "10px",
  marginBottom: "1rem",
  flexWrap: "wrap",
};

const GUIDANCE_TEXT: React.CSSProperties = {
  fontSize: TYPOGRAPHY.size.sm,
  flex: 1,
  minWidth: "200px",
};

const ACTION_BTN: React.CSSProperties = {
  padding: `0.35rem ${SPACING.md}`,
  fontSize: TYPOGRAPHY.size.sm,
  borderRadius: BORDERS.radius.md,
  cursor: "pointer",
  fontWeight: 500,
  border: "none",
  whiteSpace: "nowrap",
};

// ─── Status Guidance Configuration ──────────────────────────────────────────

interface StatusGuidance {
  message: string;
  bg: string;
  color: string;
  border: string;
  icon: string;
  actions: Array<{
    label: string;
    status?: string;
    modal?: "close" | "hold" | "observation" | "trip-report";
    color: string;
    textColor: string;
  }>;
}

function getStatusGuidance(request: RequestDetail): StatusGuidance {
  const primary = mapToPrimaryStatus(request.status);

  switch (primary) {
    case "new":
      return {
        message: "Triage this request: Review colony details and set priority.",
        bg: COLORS.primaryLight,
        color: COLORS.primaryDark,
        border: COLORS.primary,
        icon: "inbox",
        actions: [
          { label: "Start Working", status: "working", color: REQUEST_STATUS_COLORS.working.border, textColor: "#fff" },
          { label: "Pause", modal: "hold", color: REQUEST_STATUS_COLORS.paused.border, textColor: "#fff" },
          { label: "Close Case", modal: "close", color: REQUEST_STATUS_COLORS.completed.border, textColor: "#fff" },
        ],
      };
    case "working":
      return {
        message: "In progress: Update cat counts and log trapping sessions.",
        bg: COLORS.warningLight,
        color: COLORS.warningDark,
        border: COLORS.warning,
        icon: "wrench",
        actions: [
          { label: "Log Visit", modal: "observation", color: COLORS.successDark, textColor: "#fff" },
          { label: "Log Session", modal: "trip-report", color: COLORS.successDark, textColor: "#fff" },
          { label: "Close Case", modal: "close", color: REQUEST_STATUS_COLORS.completed.border, textColor: "#fff" },
          { label: "Pause", modal: "hold", color: REQUEST_STATUS_COLORS.paused.border, textColor: "#fff" },
        ],
      };
    case "paused":
      return {
        message: request.hold_reason
          ? `On hold: ${request.hold_reason.replace(/_/g, " ")}. Review when ready to resume.`
          : "On hold. Review when ready to resume.",
        bg: REQUEST_STATUS_COLORS.paused.bg,
        color: REQUEST_STATUS_COLORS.paused.text,
        border: REQUEST_STATUS_COLORS.paused.border,
        icon: "clock",
        actions: [
          { label: "Resume", status: "working", color: REQUEST_STATUS_COLORS.working.border, textColor: "#fff" },
          { label: "Close Case", modal: "close", color: REQUEST_STATUS_COLORS.completed.border, textColor: "#fff" },
        ],
      };
    case "completed":
      return {
        message: request.resolution_outcome
          ? `Closed: ${request.resolution_outcome.replace(/_/g, " ")}`
          : "Closed.",
        bg: COLORS.successLight,
        color: COLORS.successDark,
        border: COLORS.success,
        icon: "✓",
        actions: [
          { label: "Reopen", status: "new", color: REQUEST_STATUS_COLORS.new.border, textColor: "#fff" },
        ],
      };
    default:
      return {
        message: "",
        bg: COLORS.gray100,
        color: COLORS.gray500,
        border: COLORS.gray300,
        icon: "●",
        actions: [],
      };
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

interface GuidedActionBarProps {
  request: RequestDetail;
  saving: boolean;
  onStatusChange: (status: string) => void;
  onOpenModal: (modal: "close" | "hold" | "observation" | "trip-report") => void;
}

export function GuidedActionBar({
  request,
  saving,
  onStatusChange,
  onOpenModal,
}: GuidedActionBarProps) {
  const guidance = getStatusGuidance(request);

  // Don't render for terminal special statuses
  if (request.status === "redirected" || request.status === "handed_off") {
    return null;
  }

  return (
    <div style={{ ...BAR_STYLE, background: guidance.bg, border: `1px solid ${guidance.border}` }}>
      <div style={{ ...GUIDANCE_TEXT, color: guidance.color }}>
        <span style={{ marginRight: "0.375rem", display: "inline-flex", verticalAlign: "middle" }}><Icon name={guidance.icon} size={16} color={guidance.color} /></span>
        {guidance.message}
      </div>
      <div style={{ display: "flex", gap: SPACING.sm, flexWrap: "wrap" }}>
        {guidance.actions.map((action) => (
          <button
            key={action.label}
            disabled={saving}
            onClick={() => {
              if (action.modal) {
                onOpenModal(action.modal);
              } else if (action.status) {
                onStatusChange(action.status);
              }
            }}
            style={{
              ...ACTION_BTN,
              background: action.color,
              color: action.textColor,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
