"use client";

import { useCallback } from "react";
import { URGENCY_REASON_OPTIONS } from "@/lib/form-options";

// --- Types ---

export interface UrgencyNotesValue {
  priority: string;
  urgencyReasons: string[];
  urgencyDeadline: string;
  urgencyNotes: string;
  summary: string;
  notes: string;
  internalNotes: string;
}

export interface UrgencyNotesSectionProps {
  value: UrgencyNotesValue;
  onChange: (data: UrgencyNotesValue) => void;
  /** Show Additional Details fields (summary, notes, internal notes). Default: true */
  showDetails?: boolean;
  compact?: boolean;
}

// --- Constants ---

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const EMPTY_URGENCY_NOTES: UrgencyNotesValue = {
  priority: "normal",
  urgencyReasons: [],
  urgencyDeadline: "",
  urgencyNotes: "",
  summary: "",
  notes: "",
  internalNotes: "",
};

// --- Component ---

export function UrgencyNotesSection({
  value,
  onChange,
  showDetails = true,
  compact = false,
}: UrgencyNotesSectionProps) {
  const update = useCallback(
    (partial: Partial<UrgencyNotesValue>) => {
      onChange({ ...value, ...partial });
    },
    [value, onChange]
  );

  const toggleReason = useCallback(
    (reason: string) => {
      const current = value.urgencyReasons;
      const updated = current.includes(reason)
        ? current.filter((r) => r !== reason)
        : [...current, reason];
      update({ urgencyReasons: updated });
    },
    [value.urgencyReasons, update]
  );

  // --- Styles ---

  const sectionStyle: React.CSSProperties = compact
    ? { marginBottom: "12px" }
    : {
        marginBottom: "20px",
        padding: "16px",
        border: "1px solid var(--card-border, #e5e7eb)",
        borderRadius: "10px",
        background: "var(--card-bg, #fff)",
      };

  const headerStyle: React.CSSProperties = {
    fontSize: compact ? "0.85rem" : "0.95rem",
    fontWeight: 600,
    marginBottom: compact ? "8px" : "12px",
    ...(compact
      ? {}
      : {
          paddingBottom: "8px",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
        }),
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "0.25rem",
    fontWeight: 500,
    fontSize: compact ? "0.8rem" : "0.9rem",
  };

  const mbStyle: React.CSSProperties = {
    marginBottom: compact ? "8px" : "1rem",
  };

  const inputStyle: React.CSSProperties = { width: "100%" };

  return (
    <>
      {/* Urgency Section */}
      <div style={sectionStyle}>
        <div style={headerStyle}>Urgency</div>

        {/* Priority Level */}
        <div style={mbStyle}>
          <label style={labelStyle}>Priority Level</label>
          <select
            value={value.priority}
            onChange={(e) => update({ priority: e.target.value })}
            style={{ ...inputStyle, maxWidth: "200px" }}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Urgency factors — toggle chips */}
        <div style={mbStyle}>
          <label
            style={{ ...labelStyle, marginBottom: "0.5rem" }}
          >
            Urgency factors (select all that apply)
          </label>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
          >
            {URGENCY_REASON_OPTIONS.map((reason) => (
              <label
                key={reason.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: value.urgencyReasons.includes(reason.value)
                    ? "var(--primary, #2563eb)"
                    : "transparent",
                  color: value.urgencyReasons.includes(reason.value)
                    ? "#fff"
                    : "inherit",
                  fontSize: compact ? "0.8rem" : "0.85rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={value.urgencyReasons.includes(reason.value)}
                  onChange={() => toggleReason(reason.value)}
                  style={{ display: "none" }}
                />
                {reason.label}
              </label>
            ))}
          </div>
        </div>

        {/* Deadline + Urgency notes */}
        <div
          style={{
            display: "flex",
            gap: compact ? "8px" : "1rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>Deadline (if any)</label>
            <input
              type="date"
              value={value.urgencyDeadline}
              onChange={(e) => update({ urgencyDeadline: e.target.value })}
              style={inputStyle}
            />
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.8rem",
                color: "var(--text-muted, #6b7280)",
              }}
            >
              Moving date, eviction, etc.
            </p>
          </div>
          <div style={{ flex: "2 1 300px" }}>
            <label style={labelStyle}>Urgency notes</label>
            <textarea
              value={value.urgencyNotes}
              onChange={(e) => update({ urgencyNotes: e.target.value })}
              placeholder="Additional context about urgency..."
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
        </div>
      </div>

      {/* Additional Details Section */}
      {showDetails && (
        <div style={sectionStyle}>
          <div style={headerStyle}>Additional Details</div>

          {/* Request Title */}
          <div style={mbStyle}>
            <label style={labelStyle}>Request Title</label>
            <input
              type="text"
              value={value.summary}
              onChange={(e) => update({ summary: e.target.value })}
              placeholder="e.g., '5 cats at Oak Street colony' or 'Rescue injured cat'"
              style={inputStyle}
            />
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.8rem",
                color: "var(--text-muted, #6b7280)",
              }}
            >
              This will be the display name for this request
            </p>
          </div>

          {/* Case Info */}
          <div style={mbStyle}>
            <label style={labelStyle}>Case Info</label>
            <textarea
              value={value.notes}
              onChange={(e) => update({ notes: e.target.value })}
              placeholder="Detailed situation description, history with these cats, special circumstances..."
              rows={4}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.8rem",
                color: "var(--text-muted, #6b7280)",
              }}
            >
              Case details that can be shared with volunteers or referenced
              later
            </p>
          </div>

          {/* Internal Notes */}
          <div>
            <label style={labelStyle}>Internal Notes</label>
            <textarea
              value={value.internalNotes}
              onChange={(e) => update({ internalNotes: e.target.value })}
              placeholder="Staff working notes, follow-up reminders, private observations..."
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.8rem",
                color: "var(--text-muted, #6b7280)",
              }}
            >
              Private notes for staff only — not shared with clients
            </p>
          </div>
        </div>
      )}
    </>
  );
}
