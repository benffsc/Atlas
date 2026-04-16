"use client";

/**
 * FilterTag — Removable pill showing an active filter value.
 * ActiveFilterTags — Container that renders tags for all non-default filters.
 *
 * FFS-1259 / Dom Design: Shows active filters inline between controls and table.
 * Spec: 36px height, 16px gap, removable via × button.
 *
 * Usage:
 *   <ActiveFilterTags
 *     filters={filters}
 *     defaults={FILTER_DEFAULTS}
 *     labels={{ sex: "Sex", altered: "Altered Status" }}
 *     valueLabels={{ sex: { Male: "Male", Female: "Female" } }}
 *     exclude={["q", "page", "pageSize", "sort", "sortDir", "selected"]}
 *     onRemove={(key) => setFilter(key, defaults[key])}
 *     onClearAll={clearFilters}
 *   />
 */

import { Icon } from "@/components/ui/Icon";

// ── Single Filter Tag ───────────────────────────────────────────────────────

interface FilterTagProps {
  /** Display label for the filter category (e.g., "Sex") */
  label: string;
  /** Display value (e.g., "Male") */
  value: string;
  /** Called when user clicks × to remove this filter */
  onRemove: () => void;
}

export function FilterTag({ label, value, onRemove }: FilterTagProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        height: "28px",
        padding: "0 8px 0 10px",
        fontSize: "0.75rem",
        fontWeight: 500,
        color: "var(--text-secondary, #374151)",
        background: "var(--bg-tertiary, #f3f4f6)",
        border: "1px solid var(--border-light, #e5e7eb)",
        borderRadius: "14px",
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      <span style={{ color: "var(--text-muted, #6b7280)", fontWeight: 400 }}>{label}:</span>
      <span>{value}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label={`Remove ${label} filter`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "16px",
          height: "16px",
          padding: 0,
          border: "none",
          borderRadius: "50%",
          background: "transparent",
          color: "var(--text-muted, #9ca3af)",
          cursor: "pointer",
          flexShrink: 0,
          transition: "background 100ms, color 100ms",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = "var(--danger-bg, #fef2f2)";
          e.currentTarget.style.color = "var(--danger, #dc2626)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-muted, #9ca3af)";
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

// ── Active Filter Tags Container ────────────────────────────────────────────

interface ActiveFilterTagsProps {
  /** Current filter values */
  filters: Record<string, string>;
  /** Default values — only non-default filters are shown */
  defaults: Record<string, string>;
  /** Human-readable labels for filter keys (e.g., { sex: "Sex" }) */
  labels?: Record<string, string>;
  /** Human-readable labels for filter values (e.g., { sex: { Male: "Male" } }) */
  valueLabels?: Record<string, Record<string, string>>;
  /** Filter keys to exclude from rendering (e.g., pagination, sort, search) */
  exclude?: string[];
  /** Called to remove a single filter — typically resets it to default */
  onRemove: (key: string) => void;
  /** Called to clear all filters at once */
  onClearAll?: () => void;
}

/**
 * Renders a row of removable filter chips for all active (non-default) filters.
 * Returns null if no filters are active — no empty space consumed.
 */
export function ActiveFilterTags({
  filters,
  defaults,
  labels = {},
  valueLabels = {},
  exclude = [],
  onRemove,
  onClearAll,
}: ActiveFilterTagsProps) {
  const excludeSet = new Set(exclude);

  const activeTags = Object.entries(filters)
    .filter(([key, value]) => {
      if (excludeSet.has(key)) return false;
      if (!value) return false;
      if (value === defaults[key]) return false;
      return true;
    })
    .map(([key, value]) => ({
      key,
      label: labels[key] || formatKeyLabel(key),
      value: valueLabels[key]?.[value] || formatValueLabel(value),
    }));

  if (activeTags.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px",
        marginBottom: "0.75rem",
      }}
    >
      {activeTags.map((tag) => (
        <FilterTag
          key={tag.key}
          label={tag.label}
          value={tag.value}
          onRemove={() => onRemove(tag.key)}
        />
      ))}
      {onClearAll && activeTags.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          style={{
            fontSize: "0.7rem",
            color: "var(--text-muted, #6b7280)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 4px",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert "has_place" → "Has Place" */
function formatKeyLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convert "true" → "Yes", "false" → "No", keep others as title case */
function formatValueLabel(value: string): string {
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
