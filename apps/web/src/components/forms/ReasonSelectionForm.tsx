import type { ReactNode } from "react";

export interface ReasonOption {
  value: string;
  label: string;
  description?: string;
  requiresNotes?: boolean;
}

interface ReasonSelectionFormProps {
  reasons: ReasonOption[];
  selectedReason: string;
  onReasonChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  /** Override notes required. If undefined, derived from selected reason's requiresNotes. */
  notesRequired?: boolean;
  notesLabel?: string;
  notesPlaceholder?: string;
  /** "radio" = card list, "select" = dropdown. Default: "radio" */
  variant?: "select" | "radio";
  /** Accent color for radio card borders when selected. Default: "#6b7280" */
  accentColor?: string;
  /** Show "Loading..." instead of options */
  loading?: boolean;
  /** Extra fields rendered between reason picker and notes (e.g. referral org) */
  children?: ReactNode;
}

export function ReasonSelectionForm({
  reasons,
  selectedReason,
  onReasonChange,
  notes,
  onNotesChange,
  notesRequired: notesRequiredProp,
  notesLabel = "Notes",
  notesPlaceholder,
  variant = "radio",
  accentColor = "#6b7280",
  loading,
  children,
}: ReasonSelectionFormProps) {
  const selectedObj = reasons.find((r) => r.value === selectedReason);
  const notesRequired = notesRequiredProp ?? selectedObj?.requiresNotes ?? false;

  return (
    <>
      {/* Reason picker */}
      {loading ? (
        <div style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>
          Loading reasons...
        </div>
      ) : variant === "select" ? (
        <div style={{ marginBottom: "1rem" }}>
          <select
            value={selectedReason}
            onChange={(e) => onReasonChange(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              fontSize: "0.9rem",
              background: "var(--input-bg, #fff)",
            }}
          >
            <option value="">Select a reason...</option>
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {selectedObj?.description && (
            <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
              {selectedObj.description}
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1.5rem" }}>
          {reasons.map((r) => (
            <label
              key={r.value}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
                padding: "0.75rem",
                border: `2px solid ${selectedReason === r.value ? accentColor : "var(--border)"}`,
                borderRadius: "8px",
                cursor: "pointer",
                background:
                  selectedReason === r.value ? `${accentColor}0d` : "transparent",
              }}
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={selectedReason === r.value}
                onChange={(e) => onReasonChange(e.target.value)}
                style={{ marginTop: "0.2rem" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {r.label}
                  {r.requiresNotes && (
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 400 }}>
                      (notes required)
                    </span>
                  )}
                </div>
                {r.description && (
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    {r.description}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {/* Extra fields slot */}
      {children}

      {/* Notes textarea */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.9rem" }}>
          {notesLabel} {notesRequired ? "(required)" : "(optional)"}
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder={
            notesPlaceholder ??
            (notesRequired ? "Please provide details..." : "Additional details...")
          }
          rows={3}
          style={{
            width: "100%",
            padding: "0.5rem",
            borderRadius: "6px",
            border: `1px solid ${notesRequired && !notes.trim() && selectedReason ? "#dc3545" : "var(--border)"}`,
            resize: "vertical",
            boxSizing: "border-box",
            fontSize: "0.9rem",
            background: "var(--input-bg, #fff)",
          }}
        />
      </div>
    </>
  );
}
