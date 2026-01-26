"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ActiveRequest {
  request_id: string;
  summary: string;
  status: string;
  estimated_cat_count: number;
  created_at: string;
  assigned_trapper: string | null;
}

interface RecentCat {
  cat_id: string;
  name: string;
  altered_status: string;
  last_appointment: string;
}

interface ClinicActivity {
  total_cats_6mo: number;
  total_appointments_6mo: number;
  last_visit_date: string | null;
  recent_cats: RecentCat[];
}

interface GoogleContextEntry {
  entry_id: number;
  name: string;
  notes: string;
  ai_summary: string | null;
  signals: string[] | null;
  cat_count: number | null;
  distance_m: number;
}

interface NearbyRequest {
  request_id: string;
  summary: string;
  status: string;
  cat_count: number;
  address: string;
  distance_m: number;
}

interface ConditionHistory {
  condition_id: string;
  condition_type: string;
  display_label: string;
  severity: string;
  valid_from: string;
  valid_to: string | null;
  is_ongoing: boolean;
  peak_cat_count: number | null;
  ecological_impact: string | null;
  description: string | null;
  source_type: string;
}

interface ColonyTimeline {
  estimated_total: number;
  estimated_altered: number;
  alteration_rate: number;
  colony_status: string;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  confidence: number;
  source_type: string;
}

interface ZoneDemographics {
  zone_name: string;
  median_household_income: number | null;
  pct_below_poverty: number | null;
  pct_renter_occupied: number | null;
  pct_mobile_homes: number | null;
  pet_ownership_index: number | null;
  tnr_priority_score: number | null;
}

interface ContextFlags {
  // Operational
  has_active_request: boolean;
  has_recent_clinic: boolean;
  has_google_history: boolean;
  has_nearby_activity: boolean;
  // Ecological
  has_condition_history?: boolean;
  has_ongoing_condition?: boolean;
  has_disease_history?: boolean;
  was_significant_source?: boolean;
}

interface PlaceContext {
  place_id: string;
  address: string;
  service_zone?: string | null;
  location?: { lat: number; lng: number };
  // Operational
  active_requests: ActiveRequest[];
  clinic_activity: ClinicActivity;
  google_context: GoogleContextEntry[];
  nearby_requests: NearbyRequest[];
  // Ecological
  condition_history?: ConditionHistory[];
  colony_timeline?: ColonyTimeline[];
  zone_demographics?: ZoneDemographics | null;
  context_flags: ContextFlags;
  generated_at: string;
  error?: string;
}

interface PlaceContextPanelProps {
  placeId: string;
  address?: string;
  showFullContext?: boolean;
  compact?: boolean;
  onContextLoaded?: (context: PlaceContext) => void;
}

const STATUS_COLORS: Record<string, string> = {
  new: "#3b82f6",
  triaged: "#8b5cf6",
  scheduled: "#f59e0b",
  in_progress: "#10b981",
  on_hold: "#6b7280",
};

const SIGNAL_LABELS: Record<string, { label: string; color: string }> = {
  pregnant_nursing: { label: "Breeding", color: "#ec4899" },
  mortality: { label: "Mortality", color: "#1f2937" },
  relocated: { label: "Relocation", color: "#8b5cf6" },
  adopted: { label: "Adoption", color: "#10b981" },
  temperament: { label: "Behavior", color: "#f59e0b" },
  general: { label: "General", color: "#6366f1" },
};

const CONDITION_COLORS: Record<string, string> = {
  disease_outbreak: "#dc2626", // Red
  hoarding: "#ea580c", // Orange
  breeding_crisis: "#d97706", // Amber
  difficult_client: "#9333ea", // Purple
  feeding_station: "#2563eb", // Blue
  abandonment: "#6b7280", // Gray
  neglect: "#71717a", // Zinc
  resolved_colony: "#22c55e", // Green
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  severe: "#ea580c",
  moderate: "#d97706",
  minor: "#6b7280",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function PlaceContextPanel({
  placeId,
  address,
  showFullContext = false,
  compact = false,
  onContextLoaded,
}: PlaceContextPanelProps) {
  const [context, setContext] = useState<PlaceContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchContext() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/places/${placeId}/context`);
        const data = await response.json();

        if (data.error) {
          setError(data.error);
          return;
        }

        setContext(data);
        onContextLoaded?.(data);
      } catch (err) {
        setError("Failed to load context");
      } finally {
        setLoading(false);
      }
    }

    if (placeId) {
      fetchContext();
    }
  }, [placeId, onContextLoaded]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div
        style={{
          padding: compact ? "0.5rem" : "1rem",
          backgroundColor: "#f9fafb",
          borderRadius: "0.5rem",
          border: "1px solid #e5e7eb",
          fontSize: "0.875rem",
          color: "#6b7280",
        }}
      >
        Loading context...
      </div>
    );
  }

  if (error || !context) {
    return null; // Don't show anything if no context available
  }

  const { context_flags: flags } = context;
  const hasOperationalContext =
    flags.has_active_request ||
    flags.has_recent_clinic ||
    flags.has_google_history ||
    flags.has_nearby_activity;
  const hasEcologicalContext =
    flags.has_condition_history ||
    flags.has_disease_history ||
    flags.was_significant_source;
  const hasAnyContext = hasOperationalContext || hasEcologicalContext;

  if (!hasAnyContext && !showFullContext) {
    return null; // No context to show
  }

  // Compact mode: just show badges
  if (compact && !showFullContext) {
    return (
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {flags.has_active_request && (
          <span
            style={{
              padding: "0.125rem 0.5rem",
              fontSize: "0.7rem",
              fontWeight: 500,
              backgroundColor: "#fef2f2",
              color: "#b91c1c",
              borderRadius: "9999px",
              border: "1px solid #fecaca",
            }}
          >
            Active Request
          </span>
        )}
        {flags.has_recent_clinic && (
          <span
            style={{
              padding: "0.125rem 0.5rem",
              fontSize: "0.7rem",
              fontWeight: 500,
              backgroundColor: "#f0fdf4",
              color: "#166534",
              borderRadius: "9999px",
              border: "1px solid #bbf7d0",
            }}
          >
            Clinic Activity
          </span>
        )}
        {flags.has_google_history && (
          <span
            style={{
              padding: "0.125rem 0.5rem",
              fontSize: "0.7rem",
              fontWeight: 500,
              backgroundColor: "#eff6ff",
              color: "#1d4ed8",
              borderRadius: "9999px",
              border: "1px solid #bfdbfe",
            }}
          >
            Historical Notes
          </span>
        )}
        {flags.has_nearby_activity && (
          <span
            style={{
              padding: "0.125rem 0.5rem",
              fontSize: "0.7rem",
              fontWeight: 500,
              backgroundColor: "#fefce8",
              color: "#854d0e",
              borderRadius: "9999px",
              border: "1px solid #fef08a",
            }}
          >
            Nearby Activity
          </span>
        )}
        {flags.has_disease_history && (
          <span
            style={{
              padding: "0.125rem 0.5rem",
              fontSize: "0.7rem",
              fontWeight: 500,
              backgroundColor: "#fef2f2",
              color: "#dc2626",
              borderRadius: "9999px",
              border: "1px solid #fecaca",
            }}
          >
            Disease History
          </span>
        )}
        {flags.was_significant_source && !flags.has_disease_history && (
          <span
            style={{
              padding: "0.125rem 0.5rem",
              fontSize: "0.7rem",
              fontWeight: 500,
              backgroundColor: "#faf5ff",
              color: "#7c3aed",
              borderRadius: "9999px",
              border: "1px solid #e9d5ff",
            }}
          >
            Historical Source
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "0.5rem",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          backgroundColor: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span style={{ fontSize: "1rem" }}>Context</span>
        <span style={{ fontWeight: 500, fontSize: "0.875rem", color: "#374151" }}>
          {address || context.address}
        </span>
      </div>

      {/* Active Requests Section */}
      {context.active_requests.length > 0 && (
        <div style={{ borderBottom: "1px solid #e5e7eb" }}>
          <button
            onClick={() => toggleSection("active_requests")}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              background: "#fef2f2",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "#b91c1c", fontWeight: 600 }}>
                Active Request{context.active_requests.length > 1 ? "s" : ""}
              </span>
              <span
                style={{
                  backgroundColor: "#b91c1c",
                  color: "white",
                  padding: "0.125rem 0.5rem",
                  borderRadius: "9999px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {context.active_requests.length}
              </span>
            </div>
            <span style={{ color: "#6b7280" }}>
              {expandedSections.has("active_requests") ? "−" : "+"}
            </span>
          </button>

          {expandedSections.has("active_requests") && (
            <div style={{ padding: "0.75rem 1rem", backgroundColor: "#fff" }}>
              {context.active_requests.map((req) => (
                <div
                  key={req.request_id}
                  style={{
                    padding: "0.5rem",
                    marginBottom: "0.5rem",
                    backgroundColor: "#f9fafb",
                    borderRadius: "0.375rem",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div>
                      <Link
                        href={`/requests/${req.request_id}`}
                        style={{
                          color: "#2563eb",
                          fontWeight: 500,
                          fontSize: "0.875rem",
                          textDecoration: "none",
                        }}
                      >
                        {req.summary || "Untitled Request"}
                      </Link>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>
                        {req.estimated_cat_count ? `${req.estimated_cat_count} cats` : ""}
                        {req.assigned_trapper && ` • Assigned: ${req.assigned_trapper}`}
                      </div>
                    </div>
                    <span
                      style={{
                        padding: "0.125rem 0.5rem",
                        fontSize: "0.65rem",
                        fontWeight: 500,
                        backgroundColor: STATUS_COLORS[req.status] + "20",
                        color: STATUS_COLORS[req.status],
                        borderRadius: "0.25rem",
                        textTransform: "uppercase",
                      }}
                    >
                      {req.status.replace("_", " ")}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                    Created {formatRelativeTime(req.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clinic Activity Section */}
      {flags.has_recent_clinic && context.clinic_activity && (
        <div style={{ borderBottom: "1px solid #e5e7eb" }}>
          <button
            onClick={() => toggleSection("clinic")}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              background: "#f0fdf4",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "#166534", fontWeight: 600 }}>Recent Clinic Activity</span>
              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                {context.clinic_activity.total_cats_6mo} cats (6mo)
              </span>
            </div>
            <span style={{ color: "#6b7280" }}>
              {expandedSections.has("clinic") ? "−" : "+"}
            </span>
          </button>

          {expandedSections.has("clinic") && (
            <div style={{ padding: "0.75rem 1rem", backgroundColor: "#fff" }}>
              <div style={{ fontSize: "0.875rem", color: "#374151", marginBottom: "0.5rem" }}>
                <strong>{context.clinic_activity.total_appointments_6mo}</strong> appointments •
                Last visit: <strong>{formatDate(context.clinic_activity.last_visit_date)}</strong>
              </div>
              {context.clinic_activity.recent_cats.length > 0 && (
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  Recent cats:{" "}
                  {context.clinic_activity.recent_cats.slice(0, 5).map((cat, i) => (
                    <span key={cat.cat_id}>
                      {i > 0 && ", "}
                      <Link
                        href={`/cats/${cat.cat_id}`}
                        style={{ color: "#2563eb", textDecoration: "none" }}
                      >
                        {cat.name || "Unnamed"}
                      </Link>
                      <span style={{ color: "#9ca3af" }}>
                        {" "}
                        ({cat.altered_status === "spayed" || cat.altered_status === "neutered"
                          ? "altered"
                          : cat.altered_status})
                      </span>
                    </span>
                  ))}
                  {context.clinic_activity.recent_cats.length > 5 && (
                    <span> +{context.clinic_activity.recent_cats.length - 5} more</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Google Maps History Section */}
      {context.google_context.length > 0 && (
        <div style={{ borderBottom: "1px solid #e5e7eb" }}>
          <button
            onClick={() => toggleSection("google")}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              background: "#eff6ff",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "#1d4ed8", fontWeight: 600 }}>Historical Notes</span>
              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                {context.google_context.length} entries nearby
              </span>
            </div>
            <span style={{ color: "#6b7280" }}>
              {expandedSections.has("google") ? "−" : "+"}
            </span>
          </button>

          {expandedSections.has("google") && (
            <div style={{ padding: "0.75rem 1rem", backgroundColor: "#fff" }}>
              {context.google_context.slice(0, 3).map((entry) => (
                <div
                  key={entry.entry_id}
                  style={{
                    padding: "0.5rem",
                    marginBottom: "0.5rem",
                    backgroundColor: "#f9fafb",
                    borderRadius: "0.375rem",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <span style={{ fontWeight: 500, fontSize: "0.875rem", color: "#374151" }}>
                      {entry.name || "Unnamed Entry"}
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "#9ca3af" }}>
                      {entry.distance_m}m away
                    </span>
                  </div>
                  {entry.signals && entry.signals.length > 0 && (
                    <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
                      {entry.signals.map((signal) => {
                        const info = SIGNAL_LABELS[signal] || SIGNAL_LABELS.general;
                        return (
                          <span
                            key={signal}
                            style={{
                              padding: "0.0625rem 0.375rem",
                              fontSize: "0.625rem",
                              backgroundColor: info.color + "20",
                              color: info.color,
                              borderRadius: "0.25rem",
                            }}
                          >
                            {info.label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {entry.ai_summary ? (
                    <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.25rem 0 0", lineHeight: 1.4 }}>
                      {entry.ai_summary}
                    </p>
                  ) : entry.notes ? (
                    <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.25rem 0 0", lineHeight: 1.4 }}>
                      {entry.notes.length > 200 ? entry.notes.substring(0, 200) + "..." : entry.notes}
                    </p>
                  ) : null}
                  {entry.cat_count && (
                    <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                      Est. {entry.cat_count} cats mentioned
                    </div>
                  )}
                </div>
              ))}
              {context.google_context.length > 3 && (
                <div style={{ fontSize: "0.75rem", color: "#6b7280", textAlign: "center" }}>
                  +{context.google_context.length - 3} more entries
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Nearby Requests Section */}
      {context.nearby_requests.length > 0 && (
        <div style={{ borderBottom: "1px solid #e5e7eb" }}>
          <button
            onClick={() => toggleSection("nearby")}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              background: "#fefce8",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "#854d0e", fontWeight: 600 }}>Nearby Requests</span>
              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                {context.nearby_requests.length} within 200m
              </span>
            </div>
            <span style={{ color: "#6b7280" }}>
              {expandedSections.has("nearby") ? "−" : "+"}
            </span>
          </button>

          {expandedSections.has("nearby") && (
            <div style={{ padding: "0.75rem 1rem", backgroundColor: "#fff" }}>
              {context.nearby_requests.map((req) => (
                <div
                  key={req.request_id}
                  style={{
                    padding: "0.5rem",
                    marginBottom: "0.5rem",
                    backgroundColor: "#f9fafb",
                    borderRadius: "0.375rem",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div>
                      <Link
                        href={`/requests/${req.request_id}`}
                        style={{
                          color: "#2563eb",
                          fontWeight: 500,
                          fontSize: "0.875rem",
                          textDecoration: "none",
                        }}
                      >
                        {req.summary || "Untitled Request"}
                      </Link>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.125rem" }}>
                        {req.address}
                      </div>
                    </div>
                    <span style={{ fontSize: "0.65rem", color: "#9ca3af" }}>{req.distance_m}m</span>
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                    {req.cat_count ? `${req.cat_count} cats` : ""} •{" "}
                    <span
                      style={{
                        color: STATUS_COLORS[req.status],
                        fontWeight: 500,
                        textTransform: "uppercase",
                      }}
                    >
                      {req.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* ECOLOGICAL LAYER - Historical Context                        */}
      {/* ============================================================ */}

      {/* Condition History Section */}
      {context.condition_history && context.condition_history.length > 0 && (
        <div style={{ borderBottom: "1px solid #e5e7eb" }}>
          <button
            onClick={() => toggleSection("conditions")}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              background: flags.has_disease_history ? "#fef2f2" : "#faf5ff",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: flags.has_disease_history ? "#dc2626" : "#7c3aed", fontWeight: 600 }}>
                Historical Conditions
              </span>
              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                {context.condition_history.length} recorded
              </span>
              {flags.has_ongoing_condition && (
                <span
                  style={{
                    padding: "0.0625rem 0.375rem",
                    fontSize: "0.625rem",
                    backgroundColor: "#fef2f2",
                    color: "#dc2626",
                    borderRadius: "0.25rem",
                    fontWeight: 600,
                  }}
                >
                  ONGOING
                </span>
              )}
            </div>
            <span style={{ color: "#6b7280" }}>
              {expandedSections.has("conditions") ? "−" : "+"}
            </span>
          </button>

          {expandedSections.has("conditions") && (
            <div style={{ padding: "0.75rem 1rem", backgroundColor: "#fff" }}>
              {context.condition_history.map((condition) => (
                <div
                  key={condition.condition_id}
                  style={{
                    padding: "0.5rem",
                    marginBottom: "0.5rem",
                    backgroundColor: "#f9fafb",
                    borderRadius: "0.375rem",
                    border: `1px solid ${condition.is_ongoing ? "#fecaca" : "#e5e7eb"}`,
                    borderLeft: `3px solid ${CONDITION_COLORS[condition.condition_type] || "#6b7280"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem", color: "#374151" }}>
                        {condition.display_label || condition.condition_type.replace("_", " ")}
                      </span>
                      <span
                        style={{
                          marginLeft: "0.5rem",
                          padding: "0.0625rem 0.375rem",
                          fontSize: "0.625rem",
                          backgroundColor: SEVERITY_COLORS[condition.severity] + "20",
                          color: SEVERITY_COLORS[condition.severity],
                          borderRadius: "0.25rem",
                          textTransform: "uppercase",
                        }}
                      >
                        {condition.severity}
                      </span>
                    </div>
                    <span style={{ fontSize: "0.65rem", color: "#9ca3af" }}>
                      {condition.is_ongoing ? "ongoing" : `ended ${formatDate(condition.valid_to)}`}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>
                    {formatDate(condition.valid_from)} - {condition.valid_to ? formatDate(condition.valid_to) : "present"}
                  </div>
                  {condition.peak_cat_count && (
                    <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.125rem" }}>
                      Peak: {condition.peak_cat_count} cats
                      {condition.ecological_impact && (
                        <span style={{ marginLeft: "0.5rem", fontStyle: "italic" }}>
                          ({condition.ecological_impact} impact)
                        </span>
                      )}
                    </div>
                  )}
                  {condition.description && (
                    <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.25rem 0 0", lineHeight: 1.4 }}>
                      {condition.description.length > 150
                        ? condition.description.substring(0, 150) + "..."
                        : condition.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Zone Demographics Section */}
      {context.zone_demographics && (
        <div style={{ borderBottom: "1px solid #e5e7eb" }}>
          <button
            onClick={() => toggleSection("demographics")}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              background: "#f0f9ff",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "#0369a1", fontWeight: 600 }}>Zone Demographics</span>
              {context.zone_demographics.tnr_priority_score && (
                <span
                  style={{
                    padding: "0.0625rem 0.375rem",
                    fontSize: "0.625rem",
                    backgroundColor:
                      context.zone_demographics.tnr_priority_score >= 70
                        ? "#fef2f2"
                        : context.zone_demographics.tnr_priority_score >= 50
                        ? "#fefce8"
                        : "#f0fdf4",
                    color:
                      context.zone_demographics.tnr_priority_score >= 70
                        ? "#dc2626"
                        : context.zone_demographics.tnr_priority_score >= 50
                        ? "#854d0e"
                        : "#166534",
                    borderRadius: "0.25rem",
                    fontWeight: 600,
                  }}
                >
                  Priority: {Math.round(context.zone_demographics.tnr_priority_score)}
                </span>
              )}
            </div>
            <span style={{ color: "#6b7280" }}>
              {expandedSections.has("demographics") ? "−" : "+"}
            </span>
          </button>

          {expandedSections.has("demographics") && (
            <div style={{ padding: "0.75rem 1rem", backgroundColor: "#fff" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.75rem" }}>
                {context.zone_demographics.median_household_income && (
                  <div>
                    <span style={{ color: "#6b7280" }}>Median Income:</span>{" "}
                    <strong>${context.zone_demographics.median_household_income.toLocaleString()}</strong>
                  </div>
                )}
                {context.zone_demographics.pct_below_poverty !== null && (
                  <div>
                    <span style={{ color: "#6b7280" }}>Below Poverty:</span>{" "}
                    <strong>{context.zone_demographics.pct_below_poverty}%</strong>
                  </div>
                )}
                {context.zone_demographics.pct_renter_occupied !== null && (
                  <div>
                    <span style={{ color: "#6b7280" }}>Renters:</span>{" "}
                    <strong>{context.zone_demographics.pct_renter_occupied}%</strong>
                  </div>
                )}
                {context.zone_demographics.pct_mobile_homes !== null && (
                  <div>
                    <span style={{ color: "#6b7280" }}>Mobile Homes:</span>{" "}
                    <strong>{context.zone_demographics.pct_mobile_homes}%</strong>
                  </div>
                )}
              </div>
              {context.zone_demographics.pet_ownership_index && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "#6b7280" }}>
                  Pet Ownership Index: {Math.round(context.zone_demographics.pet_ownership_index)}/100
                  <span style={{ marginLeft: "0.25rem", fontStyle: "italic" }}>
                    (higher = more likely unaltered pets)
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* No context message */}
      {!hasAnyContext && showFullContext && (
        <div style={{ padding: "1rem", textAlign: "center", color: "#6b7280", fontSize: "0.875rem" }}>
          No additional context available for this location.
        </div>
      )}
    </div>
  );
}

/**
 * Compact context badges for use in list views
 */
export function PlaceContextBadges({ placeId }: { placeId: string }) {
  return <PlaceContextPanel placeId={placeId} compact={true} />;
}
