"use client";

import { CSSProperties, useState } from "react";
import { formatRole, NOTABLE_PLACEMENT_TYPES, formatPlacementType } from "@/lib/display-labels";
import { CatHealthBadges } from "@/components/badges";
import type { HealthFlag } from "@/components/badges/CatHealthBadges";
import EntityPreview from "@/components/search/EntityPreview";
import { CatPresenceBadge } from "@/components/ui/CatPresenceBadge";

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
  last_appointment_date?: string | null;
  // From people
  data_source?: string | null;
  // Health data (FFS-428)
  is_deceased?: boolean;
  health_flags?: HealthFlag[];
  // Adoption context (MIG_3005/MIG_3017)
  placement_type?: string | null;
  adoption_date?: string | null;
  source_system?: string | null;
  // Presence (FFS-1399)
  presence_status?: string | null;
  departure_reason?: string | null;
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
  /** Callback when an entity link is clicked (for preview modal). Cmd/Ctrl+Click bypasses. */
  onEntityClick?: (entityType: string, entityId: string) => void;
  /** Compact display mode: no outer card wrapper, tighter padding, subtle styling */
  compact?: boolean;
  /** Max items to show before "Show all" toggle (default: 10) */
  maxVisible?: number;
}

// Source badge for data provenance
function SourceBadge({ dataSource }: { dataSource: string }) {
  const sourceLabels: Record<string, { label: string; bg: string; color: string }> = {
    clinichq: { label: "ClinicHQ", bg: "#198754", color: "#fff" },
    shelterluv: { label: "ShelterLuv", bg: "#7c3aed", color: "#fff" },
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
    adopter: "#16a34a",
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

// Format relationship/purpose for display — delegates to centralized registry
function formatBadgeText(type: string | null | undefined): string {
  if (!type) return "";
  const label = formatRole(type);
  return label.replace(/tnr target/i, "TNR");
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
  onEntityClick,
  compact = false,
  maxVisible = 10,
}: LinkedCatsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null);
  const hasCats = cats && cats.length > 0;
  const totalCount = cats?.length || 0;
  const shouldCollapse = hasCats && totalCount > maxVisible && !expanded;
  const visibleCats = shouldCollapse ? cats!.slice(0, maxVisible) : cats;

  const cardStyle: CSSProperties = compact ? {
    padding: "0.5rem 0.75rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textDecoration: "none",
    color: "inherit",
    borderBottom: "1px solid var(--border, #dee2e6)",
    transition: "background-color 0.15s",
  } : {
    padding: "0.75rem",
    borderRadius: "6px",
    background: "var(--section-bg, #f8f9fa)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textDecoration: "none",
    color: "inherit",
    border: "1px solid var(--border, #dee2e6)",
    transition: "border-color 0.15s",
  };

  const wrapperProps = compact
    ? {}
    : { className: "card", style: { padding: "1.5rem", marginBottom: "1.5rem" } };

  return (
    <div {...wrapperProps}>
      {title && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: compact ? "0.5rem" : "1rem" }}>
          <h2 style={{ fontSize: compact ? "1rem" : "1.25rem", margin: 0 }}>
            {title}
            {showCount && hasCats && (
              <span className="badge" style={{ marginLeft: "0.5rem", background: "#198754", color: "#fff" }}>
                {cats.length}
              </span>
            )}
          </h2>
        </div>
      )}

      {hasCats ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {visibleCats!.map((cat) => (
            <div
              key={cat.cat_id}
              style={{ ...cardStyle, flexDirection: "column", alignItems: "stretch", cursor: "pointer" }}
              onClick={() => setExpandedCatId(expandedCatId === cat.cat_id ? null : cat.cat_id)}
              onMouseOver={(e) => {
                if (compact) {
                  e.currentTarget.style.backgroundColor = "var(--section-bg, #f8f9fa)";
                } else {
                  e.currentTarget.style.borderColor = "#adb5bd";
                }
              }}
              onMouseOut={(e) => {
                if (compact) {
                  e.currentTarget.style.backgroundColor = "transparent";
                } else {
                  e.currentTarget.style.borderColor = "var(--border, #dee2e6)";
                }
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <span style={{ fontSize: "10px", color: "var(--muted)", transition: "transform 0.15s", transform: expandedCatId === cat.cat_id ? "rotate(90deg)" : "rotate(0)" }}>&#9654;</span>
                  <EntityPreview entityType="cat" entityId={cat.cat_id}>
                    <span style={{ fontWeight: 500, textDecoration: cat.is_deceased ? "line-through" : "none", color: cat.is_deceased ? "var(--muted, #6c757d)" : "inherit" }}>{cat.cat_name || "Unnamed cat"}</span>
                  </EntityPreview>
                  {cat.presence_status && cat.presence_status !== "current" && (
                    <CatPresenceBadge
                      status={cat.presence_status as "current" | "departed" | "presumed_departed" | "unknown"}
                      departureReason={cat.departure_reason}
                      compact
                    />
                  )}
                </div>
                {(cat.health_flags?.length || cat.is_deceased) ? (
                  <div style={{ marginTop: "2px", marginLeft: "18px" }}>
                    <CatHealthBadges healthFlags={cat.health_flags} isDeceased={cat.is_deceased} maxInline={2} />
                  </div>
                ) : null}
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

                {/* Placement type pill for adopted cats */}
                {cat.placement_type && NOTABLE_PLACEMENT_TYPES.has(cat.placement_type) && (
                  <span
                    className="badge"
                    style={{
                      background: "var(--section-bg)",
                      color: "var(--muted)",
                      fontSize: "0.65rem",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {formatPlacementType(cat.placement_type)}
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
              </div>

              {/* Expanded metadata panel */}
              {expandedCatId === cat.cat_id && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.5rem 0.75rem",
                    background: "var(--section-bg, #f8f9fa)",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.25rem 1rem",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {cat.microchip && (
                    <div><span style={{ color: "var(--muted)", fontWeight: 500 }}>Microchip:</span> {cat.microchip}</div>
                  )}
                  {cat.altered_status && (
                    <div><span style={{ color: "var(--muted)", fontWeight: 500 }}>Altered:</span> {cat.altered_status}</div>
                  )}
                  {cat.presence_status && (
                    <div>
                      <span style={{ color: "var(--muted)", fontWeight: 500 }}>Presence:</span>{" "}
                      <CatPresenceBadge
                        status={cat.presence_status as "current" | "departed" | "presumed_departed" | "unknown"}
                        departureReason={cat.departure_reason}
                      />
                    </div>
                  )}
                  {(cat.relationship_type || cat.link_purpose) && (
                    <div><span style={{ color: "var(--muted)", fontWeight: 500 }}>Role:</span> {formatBadgeText(cat.relationship_type || cat.link_purpose)}</div>
                  )}
                  {cat.data_source && (
                    <div><span style={{ color: "var(--muted)", fontWeight: 500 }}>Source:</span> {cat.data_source}</div>
                  )}
                  {cat.last_appointment_date && (
                    <div><span style={{ color: "var(--muted)", fontWeight: 500 }}>Last appt:</span> {new Date(cat.last_appointment_date).toLocaleDateString()}</div>
                  )}
                  {cat.adoption_date && (
                    <div><span style={{ color: "#16a34a", fontWeight: 500 }}>Adopted:</span> {new Date(cat.adoption_date).toLocaleDateString()}</div>
                  )}
                  <div style={{ gridColumn: "1 / -1", marginTop: "0.25rem" }}>
                    <a
                      href={`/cats/${cat.cat_id}`}
                      style={{ fontSize: "0.75rem", color: "var(--primary, #3b82f6)", textDecoration: "none" }}
                      onClick={(e) => {
                        if (onEntityClick && !e.metaKey && !e.ctrlKey) {
                          e.preventDefault();
                          onEntityClick("cat", cat.cat_id);
                        }
                      }}
                    >
                      Open full profile →
                    </a>
                  </div>
                </div>
              )}
            </div>
          ))}
          {totalCount > maxVisible && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                padding: "0.5rem",
                background: "transparent",
                border: "1px dashed var(--border, #dee2e6)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.85rem",
                color: "var(--muted, #6c757d)",
                textAlign: "center",
              }}
            >
              {expanded ? "Show less" : `Show all ${totalCount} cats`}
            </button>
          )}
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
