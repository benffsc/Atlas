"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { RequestDetail } from "@/app/requests/[id]/types";
import {
  getValidTransitions,
  isTerminalStatus,
  mapToPrimaryStatus,
  STATUS_LABELS,
} from "@/lib/request-status";
import type { PrimaryStatus, SpecialStatus } from "@/lib/request-status";
import { REQUEST_STATUS_COLORS } from "@/lib/design-tokens";
import { Z_INDEX } from "@/lib/design-tokens";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

interface StatusDropdownProps {
  request: RequestDetail;
  saving: boolean;
  previousStatus: string | null;
  onStatusChange: (status: string) => void;
  onOpenModal: (modal: string) => void;
  onUndo: () => void;
}

// Which transitions open a modal instead of executing directly
const MODAL_TRANSITIONS: Record<string, string> = {
  paused: "hold",
  completed: "close",
  redirected: "redirect",
  handed_off: "handoff",
};

// Labels for direct transitions
const TRANSITION_LABELS: Record<string, string> = {
  working: "Start Working",
  new: "Reopen",
};

// Icons for transition items
const TRANSITION_ICONS: Record<string, string> = {
  working: "play",
  new: "rotate-ccw",
  paused: "pause",
  completed: "check-circle",
  redirected: "arrow-right",
  handed_off: "share-2",
};

function getTransitionLabel(target: string, currentPrimary: string): string {
  // Context-aware labels
  if (target === "working" && currentPrimary === "paused") return "Resume";
  if (target === "working") return "Start Working";
  if (target === "new") return "Reopen";
  if (target === "paused") return "Pause...";
  if (target === "completed") return "Close Case...";
  if (target === "redirected") return "Redirect...";
  if (target === "handed_off") return "Hand Off...";
  return STATUS_LABELS[target as keyof typeof STATUS_LABELS] || target;
}

export function StatusDropdown({
  request,
  saving,
  previousStatus,
  onStatusChange,
  onOpenModal,
  onUndo,
}: StatusDropdownProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, close]);

  const primary = mapToPrimaryStatus(request.status);
  const transitions = getValidTransitions(request.status);
  const terminal = isTerminalStatus(request.status);
  const statusColor = REQUEST_STATUS_COLORS[primary as keyof typeof REQUEST_STATUS_COLORS] || REQUEST_STATUS_COLORS.new;

  const showUndo = previousStatus && previousStatus !== request.status;

  const handleItemClick = (target: string) => {
    close();
    const modal = MODAL_TRANSITIONS[target];
    if (modal) {
      onOpenModal(modal);
    } else {
      onStatusChange(target);
    }
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <Button
        ref={buttonRef}
        variant="outline"
        size="sm"
        icon="chevron-down"
        onClick={() => setOpen(!open)}
        disabled={saving}
        style={{
          borderColor: statusColor.border,
          color: statusColor.text,
          background: statusColor.bg,
        }}
      >
        {saving ? "Saving..." : STATUS_LABELS[request.status as keyof typeof STATUS_LABELS] || request.status}
      </Button>

      {open && (
        <div
          ref={menuRef}
          style={{
            position: "absolute",
            left: 0,
            top: "100%",
            marginTop: "4px",
            background: "var(--background, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            minWidth: "200px",
            zIndex: Z_INDEX.dropdown,
            overflow: "hidden",
          }}
        >
          {/* Triage hint for new requests */}
          {primary === "new" && (
            <div style={{
              padding: "0.5rem 0.75rem",
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border, #e5e7eb)",
              fontStyle: "italic",
            }}>
              Triage: Review colony details and set priority
            </div>
          )}

          {/* Transition items */}
          {transitions.map((target, i) => {
            const isModal = !!MODAL_TRANSITIONS[target];
            return (
              <button
                key={target}
                onClick={() => handleItemClick(target)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  width: "100%",
                  textAlign: "left",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.825rem",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--foreground)",
                  borderTop: i === 0 ? "none" : undefined,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--section-bg, #f9fafb)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <Icon name={TRANSITION_ICONS[target] || "circle"} size={14} color="var(--text-muted)" />
                <span style={{ flex: 1 }}>{getTransitionLabel(target, primary)}</span>
              </button>
            );
          })}

          {/* Terminal state message */}
          {terminal && transitions.length === 0 && !showUndo && (
            <div style={{
              padding: "0.5rem 0.75rem",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              fontStyle: "italic",
            }}>
              No transitions available
            </div>
          )}

          {/* Undo */}
          {showUndo && (
            <>
              <div style={{ borderTop: "1px solid var(--border, #e5e7eb)", margin: "2px 0" }} />
              <button
                onClick={() => { close(); onUndo(); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  width: "100%",
                  textAlign: "left",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.825rem",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--section-bg, #f9fafb)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <Icon name="undo-2" size={14} color="var(--text-muted)" />
                <span>Undo → {STATUS_LABELS[previousStatus as keyof typeof STATUS_LABELS] || previousStatus}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
