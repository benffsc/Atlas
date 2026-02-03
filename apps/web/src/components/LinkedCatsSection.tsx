"use client";

import { CSSProperties } from "react";

// Flexible cat type that accommodates different data shapes from various pages
interface LinkedCat {
  cat_id: string;
  cat_name: string | null;
  microchip?: string | null;
  // From places
  relationship_type?: string | null;
  confidence?: string | null;
  // From requests
  link_purpose?: string | null;
  altered_status?: string | null;
  linked_at?: string | null;
  last_visit_date?: string | null;
  // From people
  data_source?: string | null;
}

interface LinkedCatsSectionProps {
  cats: LinkedCat[] | null | undefined;
  /** Which context we're displaying in - affects badge styling */
  context: "request" | "place" | "person";
  /** Empty state message */
  emptyMessage?: string;
  /** Show a count badge in the title */
  showCount?: boolean;
  /** Title to display (default: "Linked Cats") */
  title?: string;
}

// Source badge for data provenance
function SourceBadge({ dataSource }: { dataSource: string }) {
  const sourceLabels: Record<string, { label: string; bg: string; color: string }> = {
    clinichq: { label: "ClinicHQ", bg: "#198754", color: "#fff" },
    petlink: { label: "PetLink", bg: "#6c757d", color: "#fff" },
    airtable: { label: "Airtable", bg: "#fcb400", color: "#000" },
    web_intake: { label: "Web", bg: "#0d6efd", color: "#fff" },
    manual: { label: "Manual", bg: "#6c757d", color: "#fff" },
  };

  const info = sourceLabels[dataSource] || {
    label: dataSource,
    bg: "#6c757d",
    color: "#fff",
  };

  return (
    <span
      className="badge"
      style={{ background: info.bg, color: info.color, fontSize: "0.65rem" }}
      title={`Data source: ${dataSource}`}
    >
      {info.label}
    </span>
  );
}

// Get relationship/purpose badge color
function getBadgeColor(type: string | null | undefined, context: string): string {
  if (!type) return "#6c757d";

  const typeColors: Record<string, string> = {
    // Request link purposes
    tnr_target: "#0d6efd",
    caught: "#198754",
    observed: "#6c757d",
    // Place relationships
    residence: "#198754",
    found_at: "#6c757d",
    appointment_site: "#0d6efd",
    // Person relationships
    owner: "#0d6efd",
    caretaker: "#198754",
    brought_by: "#6c757d",
    contact: "#6c757d",
  };

  return typeColors[type] || "#6c757d";
}

// Get altered status badge color
function getAlteredColor(status: string | null | undefined): string {
  if (!status) return "#6c757d";
  if (status === "spayed" || status === "neutered" || status === "altered") {
    return "#198754";
  }
  if (status === "intact") return "#dc3545";
  return "#6c757d";
}

// Format relationship/purpose for display
function formatBadgeText(type: string | null | undefined): string {
  if (!type) return "";
  return type
    .replace(/_/g, " ")
    .replace(/tnr target/i, "TNR");
}

/**
 * Standardized section for displaying linked cats across all detail pages.
 * Handles different data shapes from requests, places, and people.
 */
export function LinkedCatsSection({
  cats,
  context,
  emptyMessage = "No cats linked",
  showCount = true,
  title = "Linked Cats",
}: LinkedCatsSectionProps) {
  const hasCats = cats && cats.length > 0;

  const cardStyle: CSSProperties = {
    padding: "0.75rem",
    borderRadius: "6px",
    background: "var(--bg-muted, #f8f9fa)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textDecoration: "none",
    color: "inherit",
    border: "1px solid var(--border, #dee2e6)",
    transition: "border-color 0.15s",
  };

  return (
    <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.25rem", margin: 0 }}>
          {title}
          {showCount && hasCats && (
            <span className="badge" style={{ marginLeft: "0.5rem", background: "#198754", color: "#fff" }}>
              {cats.length}
            </span>
          )}
        </h2>
      </div>

      {hasCats ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {cats.map((cat) => (
            <a
              key={cat.cat_id}
              href={`/cats/${cat.cat_id}`}
              style={cardStyle}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "#adb5bd";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "var(--border, #dee2e6)";
              }}
            >
              <div>
                <div>
                  <span style={{ fontWeight: 500 }}>{cat.cat_name || "Unnamed cat"}</span>
                  {cat.microchip && (
                    <span className="text-muted text-sm" style={{ marginLeft: "0.5rem" }}>
                      ({cat.microchip})
                    </span>
                  )}
                </div>
                {cat.last_visit_date && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted, #6c757d)", marginTop: "0.15rem" }}>
                    Last visit: {new Date(cat.last_visit_date).toLocaleDateString()}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {/* Data source badge for person context */}
                {context === "person" && cat.data_source && (
                  <SourceBadge dataSource={cat.data_source} />
                )}

                {/* Altered status badge for request context */}
                {context === "request" && cat.altered_status && (
                  <span
                    className="badge"
                    style={{
                      background: getAlteredColor(cat.altered_status),
                      color: "#fff",
                      fontSize: "0.7rem",
                    }}
                  >
                    {cat.altered_status}
                  </span>
                )}

                {/* Relationship/purpose badge */}
                {(cat.relationship_type || cat.link_purpose) && (
                  <span
                    className="badge"
                    style={{
                      background: getBadgeColor(cat.relationship_type || cat.link_purpose, context),
                      color: "#fff",
                      fontSize: "0.7rem",
                    }}
                  >
                    {formatBadgeText(cat.relationship_type || cat.link_purpose)}
                  </span>
                )}

                {/* Confidence badge for place context */}
                {context === "place" && cat.confidence && cat.confidence !== "medium" && (
                  <span
                    className="badge"
                    style={{
                      background: cat.confidence === "high" ? "#198754" : "#ffc107",
                      color: cat.confidence === "high" ? "#fff" : "#000",
                      fontSize: "0.65rem",
                    }}
                  >
                    {cat.confidence}
                  </span>
                )}
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-muted">{emptyMessage}</p>
      )}
    </div>
  );
}

/**
 * Compact version for inline use (wrapping flex layout)
 */
export function LinkedCatsInline({
  cats,
  context,
  emptyMessage = "No cats linked",
}: Omit<LinkedCatsSectionProps, "showCount" | "title">) {
  const hasCats = cats && cats.length > 0;

  if (!hasCats) {
    return <p className="text-muted">{emptyMessage}</p>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
      {cats.map((cat) => (
        <a
          key={cat.cat_id}
          href={`/cats/${cat.cat_id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: "var(--card-bg, #f8f9fa)",
            borderRadius: "8px",
            textDecoration: "none",
            color: "var(--foreground, #212529)",
            border: `1px solid ${context === "person" && cat.data_source === "clinichq" ? "#198754" : "var(--border, #dee2e6)"}`,
            borderLeftWidth: context === "person" && cat.data_source === "clinichq" ? "3px" : "1px",
            transition: "border-color 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = "#adb5bd";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = context === "person" && cat.data_source === "clinichq" ? "#198754" : "var(--border, #dee2e6)";
          }}
        >
          <span>{cat.cat_name || "Unnamed"}</span>
          {(cat.relationship_type || cat.link_purpose) && (
            <span
              className="badge"
              style={{
                background: getBadgeColor(cat.relationship_type || cat.link_purpose, context),
                color: "#fff",
                fontSize: "0.7rem",
              }}
            >
              {formatBadgeText(cat.relationship_type || cat.link_purpose)}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}
