"use client";

import { CSSProperties } from "react";

// Flexible place type that accommodates different data shapes from various pages
interface LinkedPlace {
  place_id: string;
  display_name: string | null;
  formatted_address?: string | null;
  // Classification
  place_kind?: string | null;
  // Relationship info
  relationship_type?: string | null;
  confidence?: number | string | null;
  is_primary?: boolean;
  // Colony info
  cat_count?: number;
  estimated_colony_size?: number;
  // Geographic
  lat?: number | null;
  lng?: number | null;
  // Source tracking
  source_system?: string | null;
}

interface LinkedPlacesSectionProps {
  places: LinkedPlace[] | null | undefined;
  /** Which context we're displaying in - affects badge styling */
  context: "request" | "person" | "cat";
  /** Empty state message */
  emptyMessage?: string;
  /** Show a count badge in the title */
  showCount?: boolean;
  /** Title to display (default: "Linked Places") */
  title?: string;
}

// Place kind badge
function PlaceKindBadge({ kind }: { kind: string | null | undefined }) {
  if (!kind || kind === "unknown") return null;

  const kindConfig: Record<string, { label: string; bg: string; color: string }> = {
    single_family: { label: "House", bg: "#dcfce7", color: "#166534" },
    apartment_unit: { label: "Unit", bg: "#dbeafe", color: "#1d4ed8" },
    apartment_building: { label: "Apts", bg: "#e0e7ff", color: "#4338ca" },
    mobile_home: { label: "Mobile", bg: "#ede9fe", color: "#7c3aed" },
    business: { label: "Business", bg: "#fef3c7", color: "#b45309" },
    farm: { label: "Farm", bg: "#ecfccb", color: "#4d7c0f" },
    outdoor_site: { label: "Outdoor", bg: "#ccfbf1", color: "#0d9488" },
    clinic: { label: "Clinic", bg: "#fee2e2", color: "#dc2626" },
    shelter: { label: "Shelter", bg: "#f3e8ff", color: "#9333ea" },
  };

  const config = kindConfig[kind] || { label: kind, bg: "#f3f4f6", color: "#6b7280" };

  return (
    <span
      className="badge"
      style={{ background: config.bg, color: config.color, fontSize: "0.65rem" }}
    >
      {config.label}
    </span>
  );
}

// Get relationship badge color
function getRelationshipColor(type: string | null | undefined): string {
  if (!type) return "#6c757d";

  const typeColors: Record<string, string> = {
    // Person-place relationships
    resident: "#198754",
    owner: "#0d6efd",
    requester: "#0891b2",
    primary: "#7c3aed",
    // Cat-place relationships
    home: "#198754",
    residence: "#0d6efd",
    colony_member: "#7c3aed",
    found_at: "#6c757d",
    appointment_site: "#f59e0b",
    trapped_at: "#dc2626",
  };

  return typeColors[type] || "#6c757d";
}

// Format relationship for display
function formatRelationship(type: string | null | undefined): string {
  if (!type) return "";
  return type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Standardized section for displaying linked places across all detail pages.
 * Handles different data shapes from requests, people, and cats.
 */
export function LinkedPlacesSection({
  places,
  context,
  emptyMessage = "No places linked",
  showCount = true,
  title = "Linked Places",
}: LinkedPlacesSectionProps) {
  const hasPlaces = places && places.length > 0;

  const cardStyle: CSSProperties = {
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

  return (
    <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.25rem", margin: 0 }}>
          {title}
          {showCount && hasPlaces && (
            <span className="badge" style={{ marginLeft: "0.5rem", background: "#0891b2", color: "#fff" }}>
              {places.length}
            </span>
          )}
        </h2>
      </div>

      {hasPlaces ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {places.map((place) => (
            <a
              key={place.place_id}
              href={`/places/${place.place_id}`}
              style={{
                ...cardStyle,
                borderLeftWidth: place.is_primary ? "3px" : "1px",
                borderLeftColor: place.is_primary ? "#7c3aed" : "var(--border, #dee2e6)",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "#adb5bd";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = place.is_primary ? "#7c3aed" : "var(--border, #dee2e6)";
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 500 }}>
                    {place.display_name || place.formatted_address || "Unknown place"}
                  </span>
                  {place.is_primary && (
                    <span
                      className="badge"
                      style={{ background: "#7c3aed", color: "#fff", fontSize: "0.6rem" }}
                    >
                      Primary
                    </span>
                  )}
                </div>
                {place.formatted_address && place.display_name !== place.formatted_address && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted, #6c757d)", marginTop: "0.15rem" }}>
                    {place.formatted_address}
                  </div>
                )}
                {(place.cat_count !== undefined || place.estimated_colony_size !== undefined) && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted, #6c757d)", marginTop: "0.15rem" }}>
                    {place.cat_count !== undefined && `${place.cat_count} cats`}
                    {place.cat_count !== undefined && place.estimated_colony_size !== undefined && " • "}
                    {place.estimated_colony_size !== undefined && `Est. ${place.estimated_colony_size}`}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {/* Place kind badge */}
                <PlaceKindBadge kind={place.place_kind} />

                {/* Relationship badge */}
                {place.relationship_type && (
                  <span
                    className="badge"
                    style={{
                      background: getRelationshipColor(place.relationship_type),
                      color: "#fff",
                      fontSize: "0.7rem",
                    }}
                  >
                    {formatRelationship(place.relationship_type)}
                  </span>
                )}

                {/* Confidence badge */}
                {place.confidence && typeof place.confidence === "number" && place.confidence < 0.8 && (
                  <span
                    className="badge"
                    style={{
                      background: place.confidence >= 0.5 ? "#ffc107" : "#dc3545",
                      color: place.confidence >= 0.5 ? "#000" : "#fff",
                      fontSize: "0.65rem",
                    }}
                  >
                    {Math.round(place.confidence * 100)}%
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
 * Compact version for inline use
 */
export function LinkedPlacesInline({
  places,
  context,
  emptyMessage = "No places linked",
}: Omit<LinkedPlacesSectionProps, "showCount" | "title">) {
  const hasPlaces = places && places.length > 0;

  if (!hasPlaces) {
    return <p className="text-muted">{emptyMessage}</p>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
      {places.map((place) => (
        <a
          key={place.place_id}
          href={`/places/${place.place_id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: "var(--card-bg, #f8f9fa)",
            borderRadius: "8px",
            textDecoration: "none",
            color: "var(--foreground, #212529)",
            border: `1px solid ${place.is_primary ? "#7c3aed" : "var(--border, #dee2e6)"}`,
            borderLeftWidth: place.is_primary ? "3px" : "1px",
            transition: "border-color 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = "#adb5bd";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = place.is_primary ? "#7c3aed" : "var(--border, #dee2e6)";
          }}
        >
          <span>{place.display_name || place.formatted_address || "Unknown"}</span>
          {place.relationship_type && (
            <span
              className="badge"
              style={{
                background: getRelationshipColor(place.relationship_type),
                color: "#fff",
                fontSize: "0.7rem",
              }}
            >
              {formatRelationship(place.relationship_type)}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}
