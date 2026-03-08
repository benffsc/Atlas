"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMatchReason } from "@/lib/display-labels";
import { formatRelativeTime } from "@/lib/formatters";

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string | null;
  match_strength: string;
  match_reason: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface GroupedResult {
  display_name: string;
  entity_type: string;
  records: SearchResult[];
  record_count: number;
  best_score: number;
  best_match_reason: string;
  best_match_strength: string;
  subtitles: string[];
}

interface GroupedSearchResultProps {
  group: GroupedResult;
}

const entityIcons: Record<string, string> = {
  cat: "🐱",
  person: "👤",
  place: "📍",
};

const entityColors: Record<string, { bg: string; text: string }> = {
  cat: { bg: "#fef3c7", text: "#92400e" },
  person: { bg: "#dbeafe", text: "#1e40af" },
  place: { bg: "#dcfce7", text: "#166534" },
};

const matchBadgeStyles: Record<string, { bg: string; text: string }> = {
  strong: { bg: "#dcfce7", text: "#166534" },
  medium: { bg: "#fef3c7", text: "#92400e" },
  weak: { bg: "#f3f4f6", text: "#6b7280" },
};

function getEntityLink(result: SearchResult): string {
  switch (result.entity_type) {
    case "cat":
      return `/cats/${result.entity_id}`;
    case "person":
      return `/people/${result.entity_id}`;
    case "place":
      return `/places/${result.entity_id}`;
    default:
      return "#";
  }
}

function getRecordSubtitle(result: SearchResult): string {
  const meta = result.metadata;
  const parts: string[] = [];

  if (result.entity_type === "person") {
    if (meta.email) parts.push(String(meta.email));
    if (meta.phone) parts.push(String(meta.phone));
    if (meta.cat_count) parts.push(`${meta.cat_count} cats`);
    if (meta.place_count) parts.push(`${meta.place_count} places`);
  } else if (result.entity_type === "cat") {
    if (meta.microchip) parts.push(`Chip: ${String(meta.microchip).slice(-6)}`);
    if (meta.sex) parts.push(String(meta.sex));
    const apptCount = meta.appointment_count as number;
    if (apptCount) parts.push(`${apptCount} visit${apptCount !== 1 ? "s" : ""}`);
  } else if (result.entity_type === "place") {
    if (meta.locality) parts.push(String(meta.locality));
    if (meta.cat_count) parts.push(`${meta.cat_count} cats`);
    if (meta.person_count) parts.push(`${meta.person_count} people`);
  }

  // Append last seen for all types
  const rel = formatRelativeTime(meta.last_appointment_date as string);
  if (rel) parts.push(`Last: ${rel}`);

  if (parts.length === 0 && result.subtitle) return result.subtitle;
  return parts.join(" \u00B7 ") || "No additional details";
}

// formatMatchReason imported from @/lib/display-labels

export function GroupedSearchResult({ group }: GroupedSearchResultProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMultiple = group.record_count > 1;
  const primaryRecord = group.records[0];
  const additionalRecords = group.records.slice(1);

  const entityStyle = entityColors[group.entity_type] || { bg: "#f3f4f6", text: "#374151" };
  const matchStyle = matchBadgeStyles[group.best_match_strength] || matchBadgeStyles.weak;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "8px",
        overflow: "hidden",
        background: "var(--background)",
      }}
    >
      {/* Main row - clickable to expand if multiple, or navigate if single */}
      <div
        style={{
          padding: "0.75rem 1rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: hasMultiple ? "pointer" : "default",
          transition: "background 0.15s",
        }}
        onClick={() => hasMultiple && setExpanded(!expanded)}
        onMouseOver={(e) => {
          if (hasMultiple) {
            e.currentTarget.style.background = "var(--section-bg)";
          }
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = "var(--background)";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0 }}>
          {/* Entity type icon */}
          <span
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "6px",
              background: entityStyle.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1rem",
              flexShrink: 0,
            }}
          >
            {entityIcons[group.entity_type] || "?"}
          </span>

          {/* Name and subtitle */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {hasMultiple ? (
              <span
                style={{
                  fontWeight: 500,
                  color: "var(--foreground)",
                  fontSize: "0.95rem",
                }}
              >
                {group.display_name}
              </span>
            ) : (
              <Link
                href={getEntityLink(primaryRecord)}
                style={{
                  fontWeight: 500,
                  color: "var(--primary)",
                  fontSize: "0.95rem",
                  textDecoration: "none",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {group.display_name}
              </Link>
            )}

            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                marginTop: "2px",
              }}
            >
              {hasMultiple
                ? `${group.subtitles.slice(0, 2).join(" · ")}${group.subtitles.length > 2 ? " ..." : ""}`
                : getRecordSubtitle(primaryRecord)}
            </div>
          </div>
        </div>

        {/* Right side: count chips + badges */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          {/* Activity count chips */}
          {(() => {
            const meta = primaryRecord.metadata;
            const chips: Array<{ label: string }> = [];
            if (group.entity_type === "person" || group.entity_type === "place") {
              if (meta.cat_count) chips.push({ label: `${meta.cat_count} cats` });
            }
            if (group.entity_type === "place" && meta.request_count) {
              chips.push({ label: `${meta.request_count} req` });
            }
            if (group.entity_type === "person" && meta.place_count) {
              chips.push({ label: `${meta.place_count} places` });
            }
            if (group.entity_type === "cat") {
              const c = meta.appointment_count as number;
              if (c) chips.push({ label: `${c} visit${c !== 1 ? "s" : ""}` });
            }
            return chips.map((chip) => (
              <span
                key={chip.label}
                style={{
                  fontSize: "0.65rem",
                  padding: "0.1rem 0.35rem",
                  borderRadius: "3px",
                  background: "var(--section-bg)",
                  color: "var(--muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {chip.label}
              </span>
            ));
          })()}

          {/* Match badge */}
          <span
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              fontSize: "0.7rem",
              fontWeight: 500,
              background: matchStyle.bg,
              color: matchStyle.text,
            }}
          >
            {formatMatchReason(group.best_match_reason, true)}
          </span>

          {/* Record count badge (if multiple) */}
          {hasMultiple && (
            <span
              style={{
                padding: "0.2rem 0.6rem",
                borderRadius: "12px",
                fontSize: "0.75rem",
                fontWeight: 600,
                background: "var(--primary)",
                color: "white",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
              }}
            >
              {group.record_count} records
              <span style={{ fontSize: "0.65rem" }}>{expanded ? "▼" : "▶"}</span>
            </span>
          )}
        </div>
      </div>

      {/* Expanded records list */}
      {expanded && hasMultiple && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--section-bg)",
          }}
        >
          {group.records.map((record, idx) => (
            <Link
              key={record.entity_id}
              href={getEntityLink(record)}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0.6rem 1rem 0.6rem 3.5rem",
                borderBottom: idx < group.records.length - 1 ? "1px solid var(--border)" : undefined,
                textDecoration: "none",
                color: "inherit",
                transition: "background 0.15s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "var(--hover-bg, rgba(0,0,0,0.03))";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--primary)",
                    fontWeight: 500,
                  }}
                >
                  {record.display_name}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginTop: "2px",
                  }}
                >
                  {getRecordSubtitle(record)}
                </div>
              </div>

              <span
                style={{
                  padding: "0.15rem 0.4rem",
                  borderRadius: "4px",
                  fontSize: "0.65rem",
                  background: matchBadgeStyles[record.match_strength]?.bg || "#f3f4f6",
                  color: matchBadgeStyles[record.match_strength]?.text || "#6b7280",
                }}
              >
                {formatMatchReason(record.match_reason, true)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
