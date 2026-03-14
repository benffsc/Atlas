"use client";

import { useCallback } from "react";
import { PERMISSION_STATUS_OPTIONS } from "@/lib/form-options";

// --- Types ---

export interface PropertyAccessValue {
  permissionStatus: string;
  hasPropertyAccess: boolean | null;
  trapsOvernightSafe: boolean | null;
  accessWithoutContact: boolean | null;
  accessNotes: string;
}

export interface PropertyAccessSectionProps {
  value: PropertyAccessValue;
  onChange: (data: PropertyAccessValue) => void;
  compact?: boolean;
}

// --- Constants ---

export const EMPTY_PROPERTY_ACCESS: PropertyAccessValue = {
  permissionStatus: "unknown",
  hasPropertyAccess: null,
  trapsOvernightSafe: null,
  accessWithoutContact: null,
  accessNotes: "",
};

// --- Helpers ---

interface TriStateRadioProps {
  name: string;
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  compact?: boolean;
}

function TriStateRadio({
  name,
  label,
  value,
  onChange,
  compact,
}: TriStateRadioProps) {
  const radioLabelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    cursor: "pointer",
    fontSize: compact ? "0.8rem" : "0.9rem",
  };

  return (
    <div>
      <label
        style={{
          display: "block",
          marginBottom: "0.5rem",
          fontWeight: 500,
          fontSize: compact ? "0.8rem" : "0.9rem",
        }}
      >
        {label}
      </label>
      <div style={{ display: "flex", gap: "1rem" }}>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name={name}
            checked={value === true}
            onChange={() => onChange(true)}
          />
          Yes
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name={name}
            checked={value === false}
            onChange={() => onChange(false)}
          />
          No
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name={name}
            checked={value === null}
            onChange={() => onChange(null)}
          />
          Unknown
        </label>
      </div>
    </div>
  );
}

// --- Component ---

export function PropertyAccessSection({
  value,
  onChange,
  compact = false,
}: PropertyAccessSectionProps) {
  const update = useCallback(
    (partial: Partial<PropertyAccessValue>) => {
      onChange({ ...value, ...partial });
    },
    [value, onChange]
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

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>Permission & Access</div>

      {/* Permission Status dropdown */}
      <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
        <label
          style={{
            display: "block",
            marginBottom: "0.25rem",
            fontWeight: 500,
            fontSize: compact ? "0.8rem" : "0.9rem",
          }}
        >
          Permission Status
        </label>
        <select
          value={value.permissionStatus}
          onChange={(e) => update({ permissionStatus: e.target.value })}
          style={{ width: "100%", maxWidth: "300px" }}
        >
          {PERMISSION_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Three yes/no/unknown radio groups */}
      <div
        style={{
          display: "flex",
          gap: compact ? "1rem" : "2rem",
          flexWrap: "wrap",
          marginBottom: compact ? "8px" : "1rem",
        }}
      >
        <TriStateRadio
          name="hasPropertyAccess"
          label="Does the requester have property access?"
          value={value.hasPropertyAccess}
          onChange={(v) => update({ hasPropertyAccess: v })}
          compact={compact}
        />
        <TriStateRadio
          name="trapsOvernight"
          label="Can traps be left overnight?"
          value={value.trapsOvernightSafe}
          onChange={(v) => update({ trapsOvernightSafe: v })}
          compact={compact}
        />
        <TriStateRadio
          name="accessWithout"
          label="Can trapper access without requester?"
          value={value.accessWithoutContact}
          onChange={(v) => update({ accessWithoutContact: v })}
          compact={compact}
        />
      </div>

      {/* Access Notes */}
      <div>
        <label
          style={{
            display: "block",
            marginBottom: "0.25rem",
            fontWeight: 500,
            fontSize: compact ? "0.8rem" : "0.9rem",
          }}
        >
          Access Notes
        </label>
        <textarea
          value={value.accessNotes}
          onChange={(e) => update({ accessNotes: e.target.value })}
          placeholder="Gate codes, dogs on property, parking instructions, hazards..."
          rows={2}
          style={{ width: "100%", resize: "vertical" }}
        />
      </div>
    </div>
  );
}
