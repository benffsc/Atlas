"use client";

import { CSSProperties, ReactNode } from "react";

// Data source badge for provenance display
function SourceBadge({ dataSource }: { dataSource: string }) {
  const sourceLabels: Record<string, { label: string; bg: string; color: string; title: string }> = {
    clinichq: { label: "ClinicHQ", bg: "#198754", color: "#fff", title: "Verified clinic patient" },
    petlink: { label: "PetLink", bg: "#6c757d", color: "#fff", title: "Microchip registry only" },
    airtable: { label: "Airtable", bg: "#fcb400", color: "#000", title: "Imported from Airtable" },
    web_intake: { label: "Web", bg: "#0d6efd", color: "#fff", title: "Web intake form" },
    manual: { label: "Manual", bg: "#6c757d", color: "#fff", title: "Manually entered" },
  };

  const info = sourceLabels[dataSource] || {
    label: dataSource,
    bg: "#6c757d",
    color: "#fff",
    title: `Data source: ${dataSource}`,
  };

  return (
    <span
      className="badge"
      style={{ background: info.bg, color: info.color, fontSize: "0.65rem" }}
      title={info.title}
    >
      {info.label}
    </span>
  );
}

interface EntityLinkProps {
  href: string;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeColor?: string;
  /** Data source for provenance display (clinichq, petlink, etc.) */
  dataSource?: string;
  /** Highlight the left border for special sources like ClinicHQ */
  highlighted?: boolean;
  highlightColor?: string;
  /** Additional content to render below the label */
  children?: ReactNode;
}

/**
 * Clickable pill link for related entities (people, places, cats, requests).
 * Provides consistent styling across all detail pages.
 */
export function EntityLink({
  href,
  label,
  sublabel,
  badge,
  badgeColor = "#6c757d",
  dataSource,
  highlighted,
  highlightColor = "#198754",
  children,
}: EntityLinkProps) {
  // Auto-highlight for clinichq sources if not explicitly set
  const isHighlighted = highlighted ?? (dataSource === "clinichq");
  const hasMultilineContent = Boolean(sublabel || children);

  const baseStyle: CSSProperties = {
    display: "inline-flex",
    flexDirection: hasMultilineContent ? "column" : "row",
    alignItems: hasMultilineContent ? "stretch" : "center",
    gap: "0.25rem",
    padding: hasMultilineContent ? "0.75rem 1rem" : "0.5rem 1rem",
    background: "var(--card-bg, #f8f9fa)",
    borderRadius: "8px",
    textDecoration: "none",
    color: "var(--foreground, #212529)",
    border: `1px solid ${isHighlighted ? highlightColor : "var(--border, #dee2e6)"}`,
    borderLeftWidth: isHighlighted ? "3px" : "1px",
    transition: "border-color 0.15s",
    minWidth: hasMultilineContent ? "150px" : undefined,
  };

  return (
    <a
      href={href}
      style={baseStyle}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "#adb5bd";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = isHighlighted ? highlightColor : "var(--border, #dee2e6)";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ fontWeight: hasMultilineContent ? 500 : 400 }}>{label}</span>
        {dataSource && <SourceBadge dataSource={dataSource} />}
        {badge && (
          <span
            className="badge"
            style={{ background: badgeColor, color: "#fff", fontSize: "0.7rem" }}
          >
            {badge}
          </span>
        )}
      </div>
      {sublabel && (
        <span className="text-muted text-sm" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
          {sublabel}
        </span>
      )}
      {children}
    </a>
  );
}
