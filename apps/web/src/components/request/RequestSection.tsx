"use client";

import { useState } from "react";
import type { RequestDetail } from "@/app/requests/[id]/types";
import type { RequestSectionConfig, SectionCompletion } from "./types";
import { useRequestSectionEdit } from "./useRequestSectionEdit";
import { getLabel } from "@/lib/form-options";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";

// ─── Style Constants ────────────────────────────────────────────────────────

const SECTION_WRAPPER: React.CSSProperties = {
  marginBottom: "1rem",
  background: "var(--card-bg, #fff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "12px",
  overflow: "hidden",
};

const SECTION_HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.75rem 1rem",
  cursor: "pointer",
  userSelect: "none",
};

const SECTION_BODY: React.CSSProperties = {
  padding: "1rem",
};

const FIELD_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "1rem",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  marginBottom: "0.25rem",
  fontWeight: 500,
  fontSize: TYPOGRAPHY.size.sm,
  color: "var(--foreground)",
};

const HELP_TEXT_STYLE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: COLORS.gray500,
  marginTop: "0.125rem",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  border: `1px solid ${COLORS.gray300}`,
  borderRadius: BORDERS.radius.md,
  fontSize: TYPOGRAPHY.size.sm,
};

const VALUE_STYLE: React.CSSProperties = {
  fontSize: "0.95rem",
  color: "var(--foreground)",
};

const EMPTY_VALUE_STYLE: React.CSSProperties = {
  ...VALUE_STYLE,
  color: COLORS.gray400,
  fontStyle: "italic",
};

const BADGE_BASE: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: BORDERS.radius.full,
  lineHeight: 1.4,
};

const GUIDANCE_CALLOUT: React.CSSProperties = {
  padding: "0.625rem 0.75rem",
  marginBottom: "1rem",
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "6px",
  fontSize: "0.8rem",
  color: "#1e40af",
  lineHeight: 1.4,
};

// ─── Completion Badge ───────────────────────────────────────────────────────

function CompletionBadge({ completion }: { completion: SectionCompletion }) {
  if (completion.total === 0) return null;

  let bg: string;
  let color: string;
  let border: string;
  if (completion.filled === completion.total) {
    bg = "#d1fae5"; color = "#065f46"; border = "#6ee7b7"; // green
  } else if (completion.filled > 0) {
    bg = "#fef3c7"; color = "#92400e"; border = "#fcd34d"; // yellow
  } else {
    bg = "#f3f4f6"; color = "#6b7280"; border = "#d1d5db"; // gray
  }

  return (
    <span style={{ ...BADGE_BASE, background: bg, color, border: `1px solid ${border}` }}>
      {completion.filled}/{completion.total}
    </span>
  );
}

// ─── Field Renderers ────────────────────────────────────────────────────────

function ViewFieldValue({ value, field }: { value: unknown; field: { type: string; options?: readonly { value: string; label: string }[] } }) {
  const isEmpty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

  if (isEmpty) {
    return <div style={EMPTY_VALUE_STYLE}>&mdash;</div>;
  }

  if (field.type === "boolean") {
    const display = value === true ? "Yes" : value === false ? "No" : "Unknown";
    const c = value === true ? COLORS.successDark : value === false ? COLORS.errorDark : COLORS.gray500;
    return <div style={{ fontWeight: 600, color: c }}>{display}</div>;
  }

  if (field.type === "checkbox-group" && Array.isArray(value)) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
        {value.map((v: string) => (
          <span key={v} style={{ ...BADGE_BASE, background: "#e0e7ff", color: "#3730a3", border: "1px solid #c7d2fe" }}>
            {field.options ? getLabel(field.options as { value: string; label: string }[], v) : v.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    );
  }

  if (field.type === "select" && field.options && typeof value === "string") {
    return <div style={VALUE_STYLE}>{getLabel(field.options as { value: string; label: string }[], value)}</div>;
  }

  return <div style={{ ...VALUE_STYLE, whiteSpace: "pre-wrap" }}>{String(value)}</div>;
}

function EditField({
  field,
  value,
  onChange,
}: {
  field: { key: string; label: string; type: string; options?: readonly { value: string; label: string }[]; helpText?: string; fullWidth?: boolean };
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const { key, type, options, helpText } = field;

  if (type === "boolean") {
    return (
      <div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(key, e.target.checked ? true : null)}
          />
          <span style={{ fontWeight: 500, fontSize: TYPOGRAPHY.size.sm }}>{field.label}</span>
        </label>
        {helpText && <div style={HELP_TEXT_STYLE}>{helpText}</div>}
      </div>
    );
  }

  if (type === "select" && options) {
    return (
      <div>
        <label style={LABEL_STYLE}>{field.label}</label>
        <select
          value={(value as string) || ""}
          onChange={(e) => onChange(key, e.target.value)}
          style={INPUT_STYLE}
        >
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {helpText && <div style={HELP_TEXT_STYLE}>{helpText}</div>}
      </div>
    );
  }

  if (type === "number") {
    return (
      <div>
        <label style={LABEL_STYLE}>{field.label}</label>
        <input
          type="number"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(key, e.target.value === "" ? "" : Number(e.target.value))}
          min="0"
          style={INPUT_STYLE}
        />
        {helpText && <div style={HELP_TEXT_STYLE}>{helpText}</div>}
      </div>
    );
  }

  if (type === "textarea") {
    return (
      <div>
        <label style={LABEL_STYLE}>{field.label}</label>
        <textarea
          value={(value as string) || ""}
          onChange={(e) => onChange(key, e.target.value)}
          rows={3}
          style={{ ...INPUT_STYLE, resize: "vertical" }}
        />
        {helpText && <div style={HELP_TEXT_STYLE}>{helpText}</div>}
      </div>
    );
  }

  if (type === "checkbox-group" && options) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <label style={LABEL_STYLE}>{field.label}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {options.map((o) => (
            <label key={o.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer", fontSize: TYPOGRAPHY.size.sm }}>
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, o.value]
                    : selected.filter((v) => v !== o.value);
                  onChange(key, next);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
        {helpText && <div style={HELP_TEXT_STYLE}>{helpText}</div>}
      </div>
    );
  }

  // Default: text input
  return (
    <div>
      <label style={LABEL_STYLE}>{field.label}</label>
      <input
        type="text"
        value={(value as string) || ""}
        onChange={(e) => onChange(key, e.target.value)}
        style={INPUT_STYLE}
      />
      {helpText && <div style={HELP_TEXT_STYLE}>{helpText}</div>}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface RequestSectionProps {
  config: RequestSectionConfig;
  request: RequestDetail;
  onSaved: () => Promise<void>;
  /** Override: render custom children in view mode instead of auto-generated fields */
  children?: React.ReactNode;
  /** Start collapsed */
  defaultCollapsed?: boolean;
}

export function RequestSection({
  config,
  request,
  onSaved,
  children,
  defaultCollapsed = false,
}: RequestSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const {
    isEditing,
    startEdit,
    cancelEdit,
    saveEdit,
    fieldValues,
    updateField,
    isDirty,
    isSaving,
    error,
    completion,
  } = useRequestSectionEdit({
    sectionId: config.id,
    request,
    fields: config.fields,
    onSaved,
  });

  // Status visibility check
  if (config.statusVisibility && !config.statusVisibility.includes(request.status)) {
    return null;
  }

  // Filter visible fields based on conditionals
  const visibleFields = config.fields.filter((f) => {
    if (!f.conditional) return true;
    const condVal = isEditing
      ? fieldValues[f.conditional.field]
      : (request as unknown as Record<string, unknown>)[f.conditional.field];
    return condVal === f.conditional.value;
  });

  const headerBg = `linear-gradient(135deg, ${config.color} 0%, ${config.color}cc 100%)`;

  return (
    <div style={SECTION_WRAPPER}>
      {/* Header */}
      <div
        style={{ ...SECTION_HEADER, background: headerBg, color: "#fff" }}
        onClick={() => !isEditing && setCollapsed(!collapsed)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1rem" }}>{collapsed && !isEditing ? "▶" : "▼"}</span>
          <span style={{ fontSize: "1rem" }}>{config.icon}</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>{config.title}</h3>
          <CompletionBadge completion={completion} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
          {isEditing ? (
            <>
              <button
                onClick={cancelEdit}
                disabled={isSaving}
                style={{
                  padding: "0.25rem 0.75rem",
                  fontSize: "0.8rem",
                  background: "rgba(255,255,255,0.2)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.4)",
                  borderRadius: BORDERS.radius.md,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={isSaving || !isDirty}
                style={{
                  padding: "0.25rem 0.75rem",
                  fontSize: "0.8rem",
                  background: "#fff",
                  color: config.color,
                  border: "none",
                  borderRadius: BORDERS.radius.md,
                  cursor: isDirty && !isSaving ? "pointer" : "not-allowed",
                  fontWeight: 600,
                  opacity: isDirty && !isSaving ? 1 : 0.6,
                }}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <button
              onClick={startEdit}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.75rem",
                background: "rgba(255,255,255,0.2)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.4)",
                borderRadius: BORDERS.radius.md,
                cursor: "pointer",
              }}
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!collapsed || isEditing ? (
        <div style={SECTION_BODY}>
          {error && (
            <div style={{ padding: "0.5rem 0.75rem", marginBottom: "0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", fontSize: "0.85rem", color: "#991b1b" }}>
              {error}
            </div>
          )}

          {isEditing && config.guidanceText && (
            <div style={GUIDANCE_CALLOUT}>
              {config.guidanceText}
            </div>
          )}

          {isEditing ? (
            <div style={FIELD_GRID}>
              {visibleFields.map((field) => (
                <div key={field.key} style={{ gridColumn: field.fullWidth ? "1 / -1" : undefined }}>
                  <EditField
                    field={field}
                    value={fieldValues[field.key]}
                    onChange={updateField}
                  />
                </div>
              ))}
            </div>
          ) : children ? (
            children
          ) : (
            <div style={FIELD_GRID}>
              {visibleFields.map((field) => {
                if (field.type === "boolean") {
                  return (
                    <div key={field.key}>
                      <div style={{ ...LABEL_STYLE, marginBottom: "0.25rem" }}>{field.label}</div>
                      <ViewFieldValue value={fieldValues[field.key]} field={field} />
                    </div>
                  );
                }
                return (
                  <div key={field.key} style={{ gridColumn: field.fullWidth ? "1 / -1" : undefined }}>
                    <div style={{ ...LABEL_STYLE, marginBottom: "0.25rem" }}>{field.label}</div>
                    <ViewFieldValue value={fieldValues[field.key]} field={field} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
