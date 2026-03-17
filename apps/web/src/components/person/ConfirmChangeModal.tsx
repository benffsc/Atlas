"use client";

import { useState } from "react";

export interface ConfirmChangeAction {
  field: string;
  label: string;
  currentValue: string;
  newValue: string;
  currentLabel: string;
  newLabel: string;
  isDangerous: boolean;
  /** Person ID and name for context */
  personId?: string;
  personName?: string;
}

interface ConfirmChangeModalProps {
  action: ConfirmChangeAction;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  confirming?: boolean;
  /** Whether reason is required (defaults to true for dangerous changes) */
  requireReason?: boolean;
}

/**
 * Confirmation modal for trapper status/type/availability changes.
 * Supports dangerous change highlighting and optional reason field.
 *
 * Used in both trapper detail page and trapper roster page.
 */
export function ConfirmChangeModal({
  action,
  onConfirm,
  onCancel,
  confirming = false,
  requireReason,
}: ConfirmChangeModalProps) {
  const [reason, setReason] = useState("");
  const reasonRequired = requireReason ?? action.isDangerous;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={() => !confirming && onCancel()}
    >
      <div
        style={{
          background: "var(--background)",
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "420px",
          width: "90%",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{
          margin: "0 0 1rem 0",
          color: action.isDangerous ? "#b91c1c" : "inherit",
        }}>
          {action.isDangerous ? "Confirm Dangerous Change" : `Change ${action.label}`}
        </h3>

        <div style={{
          padding: "0.75rem",
          background: action.isDangerous ? "#fef2f2" : "#f8f9fa",
          borderRadius: "8px",
          marginBottom: "1rem",
          border: action.isDangerous ? "1px solid #fecaca" : "none",
        }}>
          {action.personName && (
            <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              <strong>{action.personName}</strong>
            </div>
          )}
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
            {action.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{
              padding: "0.2rem 0.5rem",
              background: "#e2e8f0",
              borderRadius: "4px",
              fontSize: "0.85rem",
            }}>
              {action.currentLabel}
            </span>
            <span style={{ color: "var(--muted)" }}>&rarr;</span>
            <span style={{
              padding: "0.2rem 0.5rem",
              background: action.isDangerous ? "#fee2e2" : "#dcfce7",
              color: action.isDangerous ? "#b91c1c" : "#166534",
              borderRadius: "4px",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}>
              {action.newLabel}
            </span>
          </div>
        </div>

        {action.isDangerous && (
          <p
            style={{
              margin: "0 0 1rem",
              padding: "0.5rem 0.75rem",
              background: "#fef2f2",
              borderRadius: "6px",
              fontSize: "0.85rem",
              color: "#991b1b",
            }}
          >
            This action has significant implications for trapper permissions and attribution.
          </p>
        )}

        <div style={{ marginBottom: "1rem" }}>
          <label style={{
            display: "block",
            fontSize: "0.8rem",
            fontWeight: 500,
            marginBottom: "0.25rem",
          }}>
            Reason {reasonRequired ? "(required)" : "(optional)"}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this change being made?"
            rows={2}
            style={{ width: "100%", padding: "0.5rem", fontSize: "0.85rem" }}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            disabled={confirming}
            style={{
              padding: "0.4rem 1rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={confirming || (reasonRequired && !reason.trim())}
            style={{
              padding: "0.4rem 1rem",
              background: action.isDangerous ? "#dc2626" : "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 500,
              opacity: confirming || (reasonRequired && !reason.trim()) ? 0.5 : 1,
            }}
          >
            {confirming ? "Saving..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
