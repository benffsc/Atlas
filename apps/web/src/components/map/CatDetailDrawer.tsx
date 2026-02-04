"use client";

import { useState, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Type definitions matching the GET /api/cats/:id response shape     */
/* ------------------------------------------------------------------ */

interface CatTestResult {
  test_id: string;
  test_type: string;
  test_date: string;
  result: string;
  result_detail: string | null;
}

interface CatAppointmentSummary {
  appointment_id: string;
  appointment_date: string;
  appointment_category: string;
  service_types: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  vet_name: string | null;
  vaccines: string[];
  treatments: string[];
}

interface CatStakeholder {
  person_id: string;
  person_name: string;
  person_email: string | null;
  relationship_type: string;
  confidence: string;
  context_notes: string | null;
  effective_date: string | null;
  appointment_date: string | null;
  appointment_number: string | null;
  source_system: string;
  created_at: string;
}

interface CatMovement {
  movement_id: string;
  from_place_id: string | null;
  from_place_name: string | null;
  from_address: string | null;
  to_place_id: string;
  to_place_name: string;
  to_address: string;
  event_date: string;
  days_since_previous: number | null;
  distance_meters: number | null;
  movement_type: string;
  source_type: string;
  notes: string | null;
}

interface CatPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  relationship_type?: string;
}

interface CatDetails {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  is_deceased: boolean | null;
  total_appointments: number;
  first_appointment_date: string | null;

  tests: CatTestResult[];
  appointments: CatAppointmentSummary[];
  stakeholders: CatStakeholder[];
  movements: CatMovement[];
  places: CatPlace[];

  primary_origin_place: CatPlace | null;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface CatDetailDrawerProps {
  catId: string | null;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CatDetailDrawer({ catId, onClose }: CatDetailDrawerProps) {
  const [cat, setCat] = useState<CatDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllAppts, setShowAllAppts] = useState(false);

  // Fetch cat details when catId changes
  useEffect(() => {
    if (!catId) {
      setCat(null);
      return;
    }

    setCat(null);
    setLoading(true);
    setError(null);
    setShowAllAppts(false);

    fetch(`/api/cats/${catId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load cat details");
        return res.json();
      })
      .then((data) => {
        setCat(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [catId]);

  if (!catId) return null;

  // Derive stakeholder + place counts for the stats grid
  const stakeholderCount = cat?.stakeholders?.length ?? 0;
  const placeCount = derivePlaceCount(cat);

  // Determine which appointments to show
  const allAppts = cat?.appointments ?? [];
  const maxCollapsed = 5;
  const visibleAppts = showAllAppts ? allAppts : allAppts.slice(0, maxCollapsed);

  return (
    <div className="cat-detail-drawer">
      {/* Header */}
      <div className="drawer-header">
        <div className="drawer-title">
          <h2>{cat?.display_name || "Loading..."}</h2>
          {cat?.microchip && (
            <span className="drawer-subtitle" style={{ fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", monospace', fontSize: "12px" }}>
              {cat.microchip}
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

        {cat && !loading && (
          <>
            {/* Deceased banner */}
            {cat.is_deceased && (
              <div className="flag-banner" style={{ background: "rgba(220, 38, 38, 0.08)", border: "1px solid rgba(220, 38, 38, 0.2)", marginBottom: "16px" }}>
                <div className="flag-icon" style={{ fontSize: "16px" }}>&#x1F3F3;&#xFE0F;</div>
                <div className="flag-content">
                  <strong style={{ color: "#dc2626" }}>Deceased</strong>
                </div>
              </div>
            )}

            {/* Info badges row */}
            <div className="cat-drawer-badges">
              <SexBadge sex={cat.sex} />
              <AlteredBadge alteredStatus={cat.altered_status} sex={cat.sex} />
              {cat.breed && (
                <span className="cat-drawer-breed">{cat.breed}</span>
              )}
              {cat.color && !cat.breed && (
                <span className="cat-drawer-breed">{cat.color}</span>
              )}
            </div>

            {/* Stats grid (3 columns) */}
            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div className="stat-card">
                <div className="stat-value">{cat.total_appointments ?? 0}</div>
                <div className="stat-label">Appointments</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stakeholderCount}</div>
                <div className="stat-label">Stakeholders</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{placeCount}</div>
                <div className="stat-label">Places</div>
              </div>
            </div>

            {/* Disease / Test Results */}
            {cat.tests && cat.tests.length > 0 && (
              <div className="section">
                <h3>Test Results</h3>
                <div className="cat-drawer-tests">
                  {cat.tests.map((t) => (
                    <div key={t.test_id} className="cat-drawer-test-row">
                      <span className="cat-drawer-test-name">{formatTestType(t.test_type)}</span>
                      <TestResultBadge result={t.result} />
                      <span className="cat-drawer-test-date">
                        {t.test_date ? new Date(t.test_date).toLocaleDateString() : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinic Appointment History */}
            {allAppts.length > 0 && (
              <div className="section">
                <h3>Clinic Appointments</h3>
                <div className="cat-drawer-visits">
                  {visibleAppts.map((v) => (
                    <div key={v.appointment_id} className="cat-drawer-visit-row">
                      <div className="cat-drawer-visit-header">
                        <span className="cat-drawer-visit-date">
                          {v.appointment_date ? new Date(v.appointment_date).toLocaleDateString() : "Unknown"}
                        </span>
                        <span className="cat-drawer-visit-category">
                          {v.appointment_category}
                        </span>
                      </div>
                      {v.service_types && (
                        <div className="cat-drawer-visit-services">
                          {formatServiceTypes(v.service_types)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {allAppts.length > maxCollapsed && (
                  <button
                    className="cat-drawer-show-all"
                    onClick={() => setShowAllAppts(!showAllAppts)}
                  >
                    {showAllAppts
                      ? "Show fewer"
                      : `Show all ${allAppts.length} appointments`}
                  </button>
                )}
              </div>
            )}

            {/* Stakeholders */}
            {cat.stakeholders && cat.stakeholders.length > 0 && (
              <div className="section">
                <h3>Stakeholders</h3>
                <div className="cat-drawer-stakeholders">
                  {cat.stakeholders.map((s, i) => (
                    <a
                      key={`${s.person_id}-${s.relationship_type}-${i}`}
                      href={`/people/${s.person_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cat-drawer-stakeholder-row"
                    >
                      <span className="cat-drawer-stakeholder-name">{s.person_name}</span>
                      <span className={`cat-drawer-relationship-badge cat-drawer-rel-${s.relationship_type}`}>
                        {formatRelationshipType(s.relationship_type)}
                      </span>
                      {s.appointment_date && (
                        <span className="cat-drawer-stakeholder-date">
                          {new Date(s.appointment_date).toLocaleDateString()}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Linked Places */}
            {placeCount > 0 && (
              <div className="section">
                <h3>Linked Places</h3>
                <div className="cat-drawer-places">
                  {/* Primary origin place */}
                  {cat.primary_origin_place && (
                    <a
                      href={`/places/${cat.primary_origin_place.place_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cat-drawer-place-row"
                    >
                      <span className="cat-drawer-place-address">
                        {cat.primary_origin_place.display_name || cat.primary_origin_place.formatted_address}
                      </span>
                      <span className="cat-drawer-place-type">Origin</span>
                    </a>
                  )}
                  {/* Places from the places array */}
                  {(cat.places ?? [])
                    .filter((p) => p.place_id !== cat.primary_origin_place?.place_id)
                    .map((p) => (
                      <a
                        key={p.place_id}
                        href={`/places/${p.place_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cat-drawer-place-row"
                      >
                        <span className="cat-drawer-place-address">
                          {p.display_name || p.formatted_address}
                        </span>
                        {p.relationship_type && (
                          <span className="cat-drawer-place-type">
                            {p.relationship_type.replace(/_/g, " ")}
                          </span>
                        )}
                      </a>
                    ))}
                  {/* Movement-derived places (deduplicated against above) */}
                  {deriveMovementPlaces(cat).map((p) => (
                    <a
                      key={p.place_id}
                      href={`/places/${p.place_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cat-drawer-place-row"
                    >
                      <span className="cat-drawer-place-address">
                        {p.display_name || p.formatted_address}
                      </span>
                      <span className="cat-drawer-place-type">{p.relationship_type}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Footer: View Full Profile link */}
            <div className="drawer-footer" style={{ border: "none", padding: "16px 0 0 0", marginTop: "8px" }}>
              <a
                href={`/cats/${cat.cat_id}`}
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

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SexBadge({ sex }: { sex: string | null }) {
  let symbol = "?";
  let bgColor = "#e5e7eb";
  let textColor = "#6b7280";

  if (sex === "Male") {
    symbol = "\u2642";
    bgColor = "#dbeafe";
    textColor = "#2563eb";
  } else if (sex === "Female") {
    symbol = "\u2640";
    bgColor = "#fce7f3";
    textColor = "#db2777";
  }

  return (
    <span
      className="cat-drawer-info-badge"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {symbol} {sex || "Unknown"}
    </span>
  );
}

function AlteredBadge({ alteredStatus, sex }: { alteredStatus: string | null; sex: string | null }) {
  let label = "?";
  let bgColor = "#e5e7eb";
  let textColor = "#6b7280";

  if (alteredStatus === "spayed") {
    label = "S";
    bgColor = "#dcfce7";
    textColor = "#16a34a";
  } else if (alteredStatus === "neutered") {
    label = "N";
    bgColor = "#dcfce7";
    textColor = "#16a34a";
  } else if (alteredStatus === "intact") {
    label = "Intact";
    bgColor = "#fef9c3";
    textColor = "#a16207";
  }

  const alteredLabel = alteredStatus
    ? alteredStatus.charAt(0).toUpperCase() + alteredStatus.slice(1)
    : "Unknown";

  return (
    <span
      className="cat-drawer-info-badge"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {label !== "Intact" && label !== "?" ? label + " \u2013 " : ""}{alteredLabel}
    </span>
  );
}

function TestResultBadge({ result }: { result: string }) {
  const isPositive = result.toLowerCase() === "positive";
  const isNegative = result.toLowerCase() === "negative";

  let bgColor = "#e5e7eb";
  let textColor = "#6b7280";

  if (isPositive) {
    bgColor = "rgba(220, 38, 38, 0.1)";
    textColor = "#dc2626";
  } else if (isNegative) {
    bgColor = "rgba(22, 163, 74, 0.1)";
    textColor = "#16a34a";
  }

  return (
    <span
      className="cat-drawer-test-result"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {result}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTestType(type: string): string {
  const labels: Record<string, string> = {
    felv: "FeLV",
    fiv: "FIV",
    felv_fiv: "FeLV/FIV Combo",
    heartworm: "Heartworm",
    fecal: "Fecal",
  };
  return labels[type.toLowerCase()] || type.replace(/_/g, " ");
}

function formatServiceTypes(serviceType: string): string {
  const services = serviceType
    .split(/;\s*/)
    .map((s) => s.replace(/\s*\/\s*\/?\s*/g, "").trim())
    .filter((s) => s.length > 0 && s !== "/");
  if (services.length === 0) return "";
  if (services.length <= 2) return services.join(", ");
  return services.slice(0, 2).join(", ") + ` +${services.length - 2} more`;
}

function formatRelationshipType(type: string): string {
  const labels: Record<string, string> = {
    owner: "Owner",
    adopter: "Adopter",
    fostering: "Foster",
    caretaker: "Caretaker",
    brought_in_by: "Brought In By",
    returned_by: "Returned By",
    vet: "Vet",
  };
  return labels[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Count unique places across all sources (places array, origin place, movements). */
function derivePlaceCount(cat: CatDetails | null): number {
  if (!cat) return 0;
  const ids = new Set<string>();
  if (cat.primary_origin_place) ids.add(cat.primary_origin_place.place_id);
  (cat.places ?? []).forEach((p) => ids.add(p.place_id));
  (cat.movements ?? []).forEach((m) => {
    ids.add(m.to_place_id);
    if (m.from_place_id) ids.add(m.from_place_id);
  });
  return ids.size;
}

/** Return movement-derived places that aren't already in the places array or origin. */
function deriveMovementPlaces(cat: CatDetails): Array<{ place_id: string; display_name: string | null; formatted_address: string; relationship_type: string }> {
  const seen = new Set<string>();
  if (cat.primary_origin_place) seen.add(cat.primary_origin_place.place_id);
  (cat.places ?? []).forEach((p) => seen.add(p.place_id));

  const result: Array<{ place_id: string; display_name: string | null; formatted_address: string; relationship_type: string }> = [];
  const movementSeen = new Set<string>();

  for (const m of cat.movements ?? []) {
    if (!movementSeen.has(m.to_place_id) && !seen.has(m.to_place_id)) {
      movementSeen.add(m.to_place_id);
      result.push({
        place_id: m.to_place_id,
        display_name: m.to_place_name,
        formatted_address: m.to_address,
        relationship_type: m.movement_type || "movement",
      });
    }
    if (m.from_place_id && !movementSeen.has(m.from_place_id) && !seen.has(m.from_place_id)) {
      movementSeen.add(m.from_place_id);
      result.push({
        place_id: m.from_place_id,
        display_name: m.from_place_name,
        formatted_address: m.from_address || "",
        relationship_type: "movement origin",
      });
    }
  }

  return result;
}
