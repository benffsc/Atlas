"use client";

import { useState, useEffect } from "react";
import { formatPhone, formatRelativeTime } from "@/lib/formatters";
import { unwrapApiResponse } from "@/lib/api-client";
import { getPersonRoleColor } from "@/lib/map-colors";
import { formatPlaceKind, formatEnum } from "@/lib/display-labels";
import { Skeleton } from "@/components/feedback/Skeleton";
import { CatPresenceBadge } from "@/components/ui/CatPresenceBadge";

interface PersonIdentifier {
  id_type: string;
  id_value: string;
  source_system: string | null;
  source_table: string | null;
}

interface AssociatedPlace {
  place_id: string;
  display_name: string;
  formatted_address: string;
  place_kind: string | null;
  locality: string | null;
  source_type: string;
}

interface PersonCat {
  cat_id: string;
  cat_name: string | null;
  relationship_type: string;
  confidence: number | null;
  source_system: string | null;
  data_source: string | null;
  microchip: string | null;
  presence_status?: string | null;
  departure_reason?: string | null;
}

interface PersonRole {
  role: string;
  trapper_type: string | null;
  role_status: string;
}

interface PersonDetails {
  person_id: string;
  display_name: string;
  entity_type: string | null;
  data_quality: string | null;
  merged_into_person_id: string | null;
  cat_count: number;
  place_count: number;
  identifiers: PersonIdentifier[] | null;
  associated_places: AssociatedPlace[] | null;
  cats: PersonCat[] | null;
  last_appointment_date: string | null;
  do_not_contact?: boolean;
  do_not_contact_reason?: string | null;
}

interface PersonDetailDrawerProps {
  personId: string | null;
  onClose: () => void;
  /** Navigate to cat detail in-map instead of opening external page */
  onNavigateCat?: (catId: string) => void;
}

function getRoleColor(role: string) {
  return getPersonRoleColor(role);
}

function formatEntityType(type: string | null): string {
  if (!type) return "Individual";
  const labels: Record<string, string> = {
    individual: "Individual",
    household: "Household",
    organization: "Organization",
    clinic: "Clinic",
    rescue: "Rescue",
  };
  return labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

// formatPlaceKind imported from @/lib/display-labels

function formatSourceType(source: string): string {
  const labels: Record<string, string> = {
    relationship: "Direct Link",
    request: "Request",
    intake: "Intake Form",
  };
  return labels[source] || source;
}

export function PersonDetailDrawer({ personId, onClose, onNavigateCat }: PersonDetailDrawerProps) {
  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [roles, setRoles] = useState<PersonRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllCats, setShowAllCats] = useState(false);

  // Fetch person details when personId changes
  useEffect(() => {
    if (!personId) {
      setPerson(null);
      setRoles([]);
      return;
    }

    setPerson(null);
    setRoles([]);
    setLoading(true);
    setError(null);
    setShowAllCats(false);

    // Fetch person detail and roles in parallel
    Promise.all([
      fetch(`/api/people/${personId}`).then(res => {
        if (!res.ok) throw new Error("Failed to load person details");
        return res.json();
      }),
      fetch(`/api/people/${personId}/roles`).then(res => {
        if (!res.ok) return { roles: [] };
        return res.json();
      }),
    ])
      .then(([personJson, rolesJson]) => {
        setPerson(unwrapApiResponse<PersonDetails>(personJson));
        const rolesData = unwrapApiResponse<{ roles: PersonRole[] }>(rolesJson);
        setRoles(
          (rolesData.roles || []).filter(
            (r: PersonRole) => r.role_status === "active"
          )
        );
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [personId]);

  // Derive identifier counts
  const emails = (person?.identifiers || []).filter(i => i.id_type === "email");
  const phones = (person?.identifiers || []).filter(i => i.id_type === "phone");
  const identifierCount = (person?.identifiers || []).length;

  // Cats to display (capped at 10 unless expanded)
  const allCats = person?.cats || [];
  const visibleCats = showAllCats ? allCats : allCats.slice(0, 10);
  const hasMoreCats = allCats.length > 10;

  const handlePlaceClick = (placeId: string) => {
    // Dispatch a custom event that the map can listen for
    window.dispatchEvent(
      new CustomEvent("atlas:navigate-place", { detail: { placeId } })
    );
  };

  if (!personId) return null;

  return (
    <div className="person-detail-drawer">
      {/* Header */}
      <div className="drawer-header">
        <div className="drawer-title">
          <h2>{person?.display_name || <Skeleton width="160px" height={20} />}</h2>
          {person && (
            <span className="person-entity-type-badge">
              {formatEntityType(person.entity_type)}
            </span>
          )}
        </div>
        <button className="drawer-close" onClick={onClose}>
          &times;
        </button>
      </div>

      {/* Content */}
      <div className="drawer-content">
        {loading && (
          <div className="drawer-loading">
            <div className="spinner" />
            Loading details...
          </div>
        )}

        {error && (
          <div className="drawer-error">
            {error}
          </div>
        )}

        {person && !loading && (
          <>
            {/* Role Badges */}
            {roles.length > 0 && (
              <div className="person-role-badges">
                {roles.map((r) => {
                  const color = getRoleColor(r.role);
                  return (
                    <span
                      key={r.role}
                      className="person-drawer-role-badge"
                      style={{ backgroundColor: color.bg, color: color.text }}
                    >
                      {r.role === "trapper" && r.trapper_type
                        ? formatEnum(r.trapper_type)
                        : formatEnum(r.role)}
                    </span>
                  );
                })}
              </div>
            )}

            {/* DNC Banner */}
            {person.do_not_contact && (
              <div style={{
                background: "var(--danger-bg)",
                color: "var(--danger-text)",
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: 600,
                marginBottom: "0.75rem",
                border: "1px solid var(--danger-border)",
              }}>
                Do Not Contact
                {person.do_not_contact_reason && (
                  <span style={{ fontWeight: 400, marginLeft: "0.5rem" }}>
                    — {person.do_not_contact_reason}
                  </span>
                )}
              </div>
            )}

            {/* Stats Grid */}
            <div className="person-stats-grid">
              <div className="stat-card">
                <div className="stat-value">{person.cat_count}</div>
                <div className="stat-label">Cats</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{person.place_count}</div>
                <div className="stat-label">Places</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{identifierCount}</div>
                <div className="stat-label">IDs</div>
              </div>
              {person.last_appointment_date && (
                <div className="stat-card">
                  <div className="stat-value" style={{ fontSize: "0.9rem" }}>{formatRelativeTime(person.last_appointment_date)}</div>
                  <div className="stat-label">Last Active</div>
                </div>
              )}
            </div>

            {/* Contact Identifiers */}
            {(emails.length > 0 || phones.length > 0) && (
              <div className="section">
                <h3>Contact Info</h3>
                <div className="person-identifiers-list">
                  {emails.map((id, i) => (
                    <div key={`email-${i}`} className="person-identifier-row">
                      <span className="person-identifier-icon">@</span>
                      <span className="person-identifier-value">{id.id_value}</span>
                    </div>
                  ))}
                  {phones.map((id, i) => (
                    <div key={`phone-${i}`} className="person-identifier-row">
                      <span className="person-identifier-icon">#</span>
                      <span className="person-identifier-value">{formatPhone(id.id_value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Linked Places */}
            {person.associated_places && person.associated_places.length > 0 && (
              <div className="section">
                <h3>Linked Places</h3>
                <div className="person-places-list">
                  {person.associated_places.map((place) => (
                    <button
                      key={place.place_id}
                      className="person-place-card"
                      onClick={() => handlePlaceClick(place.place_id)}
                    >
                      <div className="person-place-address">
                        {place.formatted_address || place.display_name}
                      </div>
                      <div className="person-place-meta">
                        {place.place_kind && (
                          <span className="person-place-kind-badge">
                            {formatPlaceKind(place.place_kind)}
                          </span>
                        )}
                        <span className="person-place-source">
                          {formatSourceType(place.source_type)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Linked Cats */}
            {allCats.length > 0 && (
              <div className="section">
                <h3>Linked Cats</h3>
                <div className="cats-list">
                  {visibleCats.map((cat) => (
                    <a
                      key={cat.cat_id}
                      href={`/cats/${cat.cat_id}`}
                      target={onNavigateCat ? undefined : "_blank"}
                      rel={onNavigateCat ? undefined : "noopener noreferrer"}
                      className="cat-card"
                      onClick={onNavigateCat ? (e) => { e.preventDefault(); onNavigateCat(cat.cat_id); } : undefined}
                    >
                      <div className="cat-card-header">
                        <span className="cat-name">{cat.cat_name || "Unknown"}</span>
                        <div className="cat-badges">
                          <CatPresenceBadge
                            status={(cat.presence_status as "current" | "departed" | "presumed_departed" | "unknown") || "unknown"}
                            departureReason={cat.departure_reason}
                            compact={cat.presence_status === "current"}
                          />
                          {cat.relationship_type && (
                            <span
                              className="person-cat-rel-badge"
                              title={cat.relationship_type}
                            >
                              {cat.relationship_type.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                      {(cat.data_source || cat.microchip) && (
                        <div className="cat-card-details">
                          {cat.data_source && <span>{cat.data_source}</span>}
                          {cat.microchip && (
                            <span className="cat-microchip">{cat.microchip}</span>
                          )}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
                {hasMoreCats && !showAllCats && (
                  <button
                    className="person-show-all-btn"
                    onClick={() => setShowAllCats(true)}
                  >
                    Show all {allCats.length} cats
                  </button>
                )}
              </div>
            )}

            {/* Footer Link */}
            <div className="drawer-footer">
              <a
                href={`/people/${person.person_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                View Full Profile &rarr;
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
