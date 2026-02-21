"use client";

import { CSSProperties } from "react";

// Flexible person type that accommodates different data shapes from various pages
interface LinkedPerson {
  person_id: string;
  display_name: string | null;
  // Relationship info
  relationship_type?: string | null;
  confidence?: number | string | null;
  // Role info
  is_trapper?: boolean;
  is_volunteer?: boolean;
  is_organization?: boolean;
  // Contact info
  email?: string | null;
  phone?: string | null;
  // Source tracking
  source_system?: string | null;
  data_source?: string | null;
}

interface LinkedPeopleSectionProps {
  people: LinkedPerson[] | null | undefined;
  /** Which context we're displaying in - affects badge styling */
  context: "request" | "place" | "cat";
  /** Empty state message */
  emptyMessage?: string;
  /** Show a count badge in the title */
  showCount?: boolean;
  /** Title to display (default: "Linked People") */
  title?: string;
}

// Source badge for data provenance
function SourceBadge({ source }: { source: string }) {
  const sourceLabels: Record<string, { label: string; bg: string; color: string }> = {
    clinichq: { label: "ClinicHQ", bg: "#198754", color: "#fff" },
    shelterluv: { label: "ShelterLuv", bg: "#9333ea", color: "#fff" },
    volunteerhub: { label: "VolunteerHub", bg: "#0891b2", color: "#fff" },
    airtable: { label: "Airtable", bg: "#fcb400", color: "#000" },
    web_intake: { label: "Web", bg: "#0d6efd", color: "#fff" },
    atlas_ui: { label: "Atlas", bg: "#6366f1", color: "#fff" },
  };

  const info = sourceLabels[source] || {
    label: source,
    bg: "#6c757d",
    color: "#fff",
  };

  return (
    <span
      className="badge"
      style={{ background: info.bg, color: info.color, fontSize: "0.65rem" }}
      title={`Source: ${source}`}
    >
      {info.label}
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
    caretaker: "#6366f1",
    colony_caretaker: "#7c3aed",
    // Person-cat relationships
    adopter: "#198754",
    foster: "#f59e0b",
    brought_by: "#6c757d",
    contact: "#64748b",
  };

  return typeColors[type] || "#6c757d";
}

// Format relationship for display
function formatRelationship(type: string | null | undefined): string {
  if (!type) return "";
  return type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

// Role badge for trappers/volunteers
function RoleBadge({ person }: { person: LinkedPerson }) {
  if (person.is_trapper) {
    return (
      <span
        className="badge"
        style={{ background: "#dc2626", color: "#fff", fontSize: "0.65rem" }}
      >
        Trapper
      </span>
    );
  }
  if (person.is_volunteer) {
    return (
      <span
        className="badge"
        style={{ background: "#0891b2", color: "#fff", fontSize: "0.65rem" }}
      >
        Volunteer
      </span>
    );
  }
  if (person.is_organization) {
    return (
      <span
        className="badge"
        style={{ background: "#6b7280", color: "#fff", fontSize: "0.65rem" }}
      >
        Org
      </span>
    );
  }
  return null;
}

/**
 * Standardized section for displaying linked people across all detail pages.
 * Handles different data shapes from requests, places, and cats.
 */
export function LinkedPeopleSection({
  people,
  context,
  emptyMessage = "No people linked",
  showCount = true,
  title = "Linked People",
}: LinkedPeopleSectionProps) {
  const hasPeople = people && people.length > 0;

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
          {showCount && hasPeople && (
            <span className="badge" style={{ marginLeft: "0.5rem", background: "#0d6efd", color: "#fff" }}>
              {people.length}
            </span>
          )}
        </h2>
      </div>

      {hasPeople ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {people.map((person) => (
            <a
              key={person.person_id}
              href={`/people/${person.person_id}`}
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
                  <span style={{ fontWeight: 500 }}>
                    {person.display_name || "Unknown person"}
                  </span>
                </div>
                {(person.email || person.phone) && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted, #6c757d)", marginTop: "0.15rem" }}>
                    {person.email || person.phone}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {/* Role badge */}
                <RoleBadge person={person} />

                {/* Source badge */}
                {(person.source_system || person.data_source) && (
                  <SourceBadge source={person.source_system || person.data_source || ""} />
                )}

                {/* Relationship badge */}
                {person.relationship_type && (
                  <span
                    className="badge"
                    style={{
                      background: getRelationshipColor(person.relationship_type),
                      color: "#fff",
                      fontSize: "0.7rem",
                    }}
                  >
                    {formatRelationship(person.relationship_type)}
                  </span>
                )}

                {/* Confidence badge */}
                {person.confidence && typeof person.confidence === "number" && person.confidence < 0.8 && (
                  <span
                    className="badge"
                    style={{
                      background: person.confidence >= 0.5 ? "#ffc107" : "#dc3545",
                      color: person.confidence >= 0.5 ? "#000" : "#fff",
                      fontSize: "0.65rem",
                    }}
                  >
                    {Math.round(person.confidence * 100)}%
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
export function LinkedPeopleInline({
  people,
  context,
  emptyMessage = "No people linked",
}: Omit<LinkedPeopleSectionProps, "showCount" | "title">) {
  const hasPeople = people && people.length > 0;

  if (!hasPeople) {
    return <p className="text-muted">{emptyMessage}</p>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
      {people.map((person) => (
        <a
          key={person.person_id}
          href={`/people/${person.person_id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: "var(--card-bg, #f8f9fa)",
            borderRadius: "8px",
            textDecoration: "none",
            color: "var(--foreground, #212529)",
            border: "1px solid var(--border, #dee2e6)",
            transition: "border-color 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = "#adb5bd";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = "var(--border, #dee2e6)";
          }}
        >
          <span>{person.display_name || "Unknown"}</span>
          {person.relationship_type && (
            <span
              className="badge"
              style={{
                background: getRelationshipColor(person.relationship_type),
                color: "#fff",
                fontSize: "0.7rem",
              }}
            >
              {formatRelationship(person.relationship_type)}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}
