"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";

interface GoogleNote {
  entry_id: string;
  kml_name: string | null;
  original_content: string | null;
  original_redacted: string | null;
  ai_summary: string | null;
  ai_meaning: string | null;
  parsed_date: string | null;
  imported_at: string;
}

interface JournalEntry {
  id: string;
  entry_kind: string;
  title: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
}

interface PlaceContext {
  context_type: string;
  display_label: string;
}

interface DataSource {
  source_system: string;
  source_description: string;
}

interface DiseaseBadge {
  disease_key: string;
  short_code: string;
  color: string;
  status: string;
  last_positive_date: string | null;
  positive_cat_count: number;
}

interface CatLink {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  microchip: string | null;
  breed: string | null;
  primary_color: string | null;
  is_deceased: boolean;
  relationship_type: string;
  appointment_count: number;
  latest_appointment_date: string | null;
  latest_service_type: string | null;
}

interface PlaceDetails {
  place_id: string;
  address: string;
  display_name: string | null;
  service_zone: string | null;

  // Flags
  disease_risk: boolean;
  disease_risk_notes: string | null;
  watch_list: boolean;
  watch_list_reason: string | null;

  // Disease tracking
  disease_badges: DiseaseBadge[];

  // Stats
  cat_count: number;
  person_count: number;
  request_count: number;
  active_request_count: number;
  total_altered: number;

  // People
  people: Array<{ person_id: string; display_name: string; role?: string; is_home?: boolean; is_manual?: boolean }>;

  // Cats
  cats: CatLink[];

  // Notes
  google_notes: GoogleNote[];
  journal_entries: JournalEntry[];

  // Context & provenance
  contexts: PlaceContext[];
  data_sources: DataSource[];
}

interface PlaceDetailDrawerProps {
  placeId: string | null;
  onClose: () => void;
  onWatchlistChange?: () => void;
  coordinates?: { lat: number; lng: number };
  showQuickActions?: boolean;
}

type NotesTab = "original" | "ai" | "journal";

export function PlaceDetailDrawer({ placeId, onClose, onWatchlistChange, coordinates, showQuickActions }: PlaceDetailDrawerProps) {
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<NotesTab>("original");
  const [showStreetView, setShowStreetView] = useState(false);
  const [svHeading, setSvHeading] = useState(0);
  const svPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const svIframeRef = useRef<HTMLIFrameElement>(null);

  // Watchlist toggle state
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistReason, setWatchlistReason] = useState("");
  const [showWatchlistForm, setShowWatchlistForm] = useState(false);

  // Journal entry creation
  const [journalBody, setJournalBody] = useState("");
  const [journalSaving, setJournalSaving] = useState(false);

  // Manual people management
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [addPersonQuery, setAddPersonQuery] = useState("");
  const [addPersonResults, setAddPersonResults] = useState<Array<{ entity_id: string; display_name: string; subtitle: string | null }>>([]);
  const [addPersonRole, setAddPersonRole] = useState("resident");
  const [addPersonLoading, setAddPersonLoading] = useState(false);
  const [addPersonSelected, setAddPersonSelected] = useState<{ entity_id: string; display_name: string } | null>(null);

  // Fetch place details when placeId changes
  useEffect(() => {
    if (!placeId) {
      setPlace(null);
      return;
    }

    // Reset state immediately when placeId changes to show loading
    setPlace(null);
    setLoading(true);
    setError(null);
    setActiveTab("original");
    setShowStreetView(false);
    setSvHeading(0);
    svPositionRef.current = null;
    // Hide cone marker when switching places
    (window as unknown as { atlasMapHideStreetViewCone?: () => void }).atlasMapHideStreetViewCone?.();
    setShowWatchlistForm(false);
    setWatchlistReason("");

    fetch(`/api/places/${placeId}/map-details`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load place details");
        return res.json();
      })
      .then((data) => {
        setPlace(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [placeId]);

  // Listen for heading/position updates from interactive Street View iframe
  useEffect(() => {
    if (!showStreetView) return;
    const handler = (event: MessageEvent) => {
      if (!event.data?.type) return;
      if (event.data.type === "streetview-pov") {
        setSvHeading(event.data.heading);
      } else if (event.data.type === "streetview-position") {
        svPositionRef.current = { lat: event.data.lat, lng: event.data.lng };
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [showStreetView]);

  // Deduplicate people by person_id (safety net in case API returns duplicates)
  const uniquePeople = useMemo(() => {
    if (!place?.people) return [];
    const seen = new Set<string>();
    return place.people.filter((person) => {
      if (seen.has(person.person_id)) return false;
      seen.add(person.person_id);
      return true;
    });
  }, [place?.people]);

  // Handle watchlist toggle
  const handleWatchlistToggle = async () => {
    if (!place) return;

    // If adding to watchlist, show reason form
    if (!place.watch_list && !showWatchlistForm) {
      setShowWatchlistForm(true);
      return;
    }

    // If removing, confirm
    if (place.watch_list) {
      if (!confirm("Remove this place from the watch list?")) return;
    }

    // Validate reason when adding
    if (!place.watch_list && !watchlistReason.trim()) {
      alert("Please provide a reason for adding to watch list");
      return;
    }

    setWatchlistLoading(true);

    try {
      const res = await fetch(`/api/places/${place.place_id}/watchlist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watch_list: !place.watch_list,
          reason: watchlistReason.trim(),
        }),
      });

      if (!res.ok) throw new Error("Failed to update watchlist");

      // Update local state
      setPlace({
        ...place,
        watch_list: !place.watch_list,
        watch_list_reason: !place.watch_list ? watchlistReason.trim() : null,
      });

      setShowWatchlistForm(false);
      setWatchlistReason("");
      onWatchlistChange?.();
    } catch (err) {
      alert("Failed to update watch list");
    } finally {
      setWatchlistLoading(false);
    }
  };

  // Refetch place details (used after adding journal entries)
  const refetchPlace = () => {
    if (!placeId) return;
    fetch(`/api/places/${placeId}/map-details`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setPlace(data); });
  };

  // Handle journal entry creation
  const handleJournalSubmit = async () => {
    if (!place || !journalBody.trim()) return;
    setJournalSaving(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_place_id: place.place_id,
          body: journalBody.trim(),
          entry_kind: "note",
          created_by: "staff",
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setJournalBody("");
      refetchPlace();
    } catch {
      alert("Failed to save journal entry");
    } finally {
      setJournalSaving(false);
    }
  };

  // Debounced person search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePersonSearch = useCallback((query: string) => {
    setAddPersonQuery(query);
    setAddPersonSelected(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.trim().length < 2) {
      setAddPersonResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&type=person&suggestions=true&limit=5`);
        if (!res.ok) return;
        const data = await res.json();
        setAddPersonResults(data.results || data.suggestions || []);
      } catch {
        // silently fail
      }
    }, 300);
  }, []);

  // Add person to place
  const handleAddPerson = async () => {
    if (!place || !addPersonSelected) return;
    setAddPersonLoading(true);
    try {
      const res = await fetch(`/api/places/${place.place_id}/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: addPersonSelected.entity_id, role: addPersonRole }),
      });
      if (!res.ok) throw new Error("Failed to link person");
      // Reset form and refetch
      setShowAddPerson(false);
      setAddPersonQuery("");
      setAddPersonResults([]);
      setAddPersonSelected(null);
      setAddPersonRole("resident");
      refetchPlace();
    } catch {
      alert("Failed to link person to place");
    } finally {
      setAddPersonLoading(false);
    }
  };

  // Remove person from place
  const handleRemovePerson = async (personId: string, role: string) => {
    if (!place) return;
    if (!confirm("Remove this person link?")) return;
    try {
      const res = await fetch(
        `/api/places/${place.place_id}/people?person_id=${encodeURIComponent(personId)}&role=${encodeURIComponent(role || "")}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove person");
      refetchPlace();
    } catch {
      alert("Failed to remove person link");
    }
  };

  if (!placeId) return null;

  return (
    <div className="place-detail-drawer">
      {/* Header */}
      <div className="drawer-header">
        <div className="drawer-title">
          <h2>{place?.address || "Loading..."}</h2>
          {place?.display_name && (
            <span className="drawer-subtitle">{place.display_name}</span>
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

        {place && !loading && (
          <>
            {/* Quick Actions Section */}
            {showQuickActions && (
              <div style={{
                display: "flex",
                gap: "8px",
                marginBottom: "12px",
                padding: "0"
              }}>
                <a
                  href={`/intake/new?place_id=${place.place_id}&address=${encodeURIComponent(place.address)}`}
                  style={{
                    flex: 1,
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    backgroundColor: "#eff6ff",
                    borderRadius: "6px",
                    border: "1px solid #bfdbfe",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e40af",
                    textDecoration: "none",
                    transition: "background-color 0.15s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#dbeafe"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#eff6ff"}
                >
                  <span>+</span>
                  <span>Create Request</span>
                </a>
                <a
                  href={`/places/${place.place_id}#people`}
                  style={{
                    flex: 1,
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    backgroundColor: "#eff6ff",
                    borderRadius: "6px",
                    border: "1px solid #bfdbfe",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e40af",
                    textDecoration: "none",
                    transition: "background-color 0.15s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#dbeafe"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#eff6ff"}
                >
                  <span>👤</span>
                  <span>Link Person</span>
                </a>
                <a
                  href={`/places/${place.place_id}#notes`}
                  style={{
                    flex: 1,
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    backgroundColor: "#eff6ff",
                    borderRadius: "6px",
                    border: "1px solid #bfdbfe",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e40af",
                    textDecoration: "none",
                    transition: "background-color 0.15s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#dbeafe"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#eff6ff"}
                >
                  <span>📝</span>
                  <span>Add Note</span>
                </a>
              </div>
            )}

            {/* Disease Badges Section */}
            {place.disease_badges && place.disease_badges.length > 0 && (
              <div className="disease-badges-section">
                {place.disease_badges.map((badge) => (
                  <div
                    key={badge.disease_key}
                    className="disease-badge-item"
                    style={{ borderLeftColor: badge.color }}
                  >
                    <span
                      className="disease-badge-code"
                      style={{ backgroundColor: badge.color }}
                    >
                      {badge.short_code}
                    </span>
                    <div className="disease-badge-info">
                      <strong>{formatDiseaseStatus(badge.status)}</strong>
                      <span className="disease-badge-detail">
                        {badge.positive_cat_count} cat{badge.positive_cat_count !== 1 ? "s" : ""} positive
                        {badge.last_positive_date && (
                          <> &middot; Last: {new Date(badge.last_positive_date).toLocaleDateString()}</>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Legacy disease risk banner (for places without per-disease data) */}
            {place.disease_risk && (!place.disease_badges || place.disease_badges.length === 0) && (
              <div className="flag-banner flag-disease">
                <div className="flag-icon">&#9888;&#65039;</div>
                <div className="flag-content">
                  <strong>Disease Risk</strong>
                  {place.disease_risk_notes && (
                    <p>{place.disease_risk_notes}</p>
                  )}
                </div>
              </div>
            )}

            {place.watch_list && (
              <div className="flag-banner flag-watchlist">
                <div className="flag-icon">👁️</div>
                <div className="flag-content">
                  <strong>Watch List</strong>
                  {place.watch_list_reason && (
                    <p>{place.watch_list_reason}</p>
                  )}
                </div>
              </div>
            )}

            {/* Street View Preview (Interactive) */}
            {coordinates && (
              <div className="street-view-drawer">
                <button
                  className="street-view-drawer-toggle"
                  onClick={() => {
                    const opening = !showStreetView;
                    setShowStreetView(opening);
                    setSvHeading(0);
                    svPositionRef.current = null;
                    if (opening) {
                      (window as unknown as { atlasMapShowStreetViewCone?: (lat: number, lng: number) => void })
                        .atlasMapShowStreetViewCone?.(coordinates.lat, coordinates.lng);
                    } else {
                      (window as unknown as { atlasMapHideStreetViewCone?: () => void })
                        .atlasMapHideStreetViewCone?.();
                    }
                  }}
                >
                  <span>📷 Street View</span>
                  <span style={{ transform: showStreetView ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
                </button>
                {showStreetView && (
                  <>
                    <iframe
                      ref={svIframeRef}
                      className="street-view-drawer-iframe"
                      src={`/api/streetview/interactive?lat=${coordinates.lat}&lng=${coordinates.lng}`}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                    <div className="street-view-drawer-controls">
                      <span className="street-view-drawer-compass">
                        {["N","NE","E","SE","S","SW","W","NW"][Math.round(svHeading / 45) % 8]}
                        <span className="street-view-drawer-degrees">{svHeading}°</span>
                      </span>
                      <button
                        className="street-view-drawer-expand"
                        onClick={() => {
                          const pos = svPositionRef.current || coordinates;
                          const addr = place?.address || place?.display_name;
                          // Expand to fullscreen street view with minimap
                          (window as unknown as { atlasMapExpandStreetViewFullscreen?: (lat: number, lng: number, address?: string) => void })
                            .atlasMapExpandStreetViewFullscreen?.(pos.lat, pos.lng, addr || undefined);
                          setShowStreetView(false);
                        }}
                        title="Expand to fullscreen street view"
                      >
                        Expand
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Context Tags */}
            {place.contexts && place.contexts.length > 0 && (
              <div className="context-tags">
                {place.contexts.map((ctx) => (
                  <span key={ctx.context_type} className={`context-tag context-tag-${ctx.context_type}`}>
                    {ctx.display_label}
                  </span>
                ))}
              </div>
            )}

            {/* Data Sources */}
            {place.data_sources && place.data_sources.length > 0 && (
              <div className="data-sources">
                <span className="data-sources-label">Sources:</span>
                {place.data_sources.map((ds) => (
                  <span key={`${ds.source_system}-${ds.source_description}`} className="data-source-badge">
                    {formatSourceName(ds.source_system)}
                  </span>
                ))}
              </div>
            )}

            {/* Stats Grid */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{place.cat_count}</div>
                <div className="stat-label">Cats</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{place.person_count}</div>
                <div className="stat-label">People</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: place.active_request_count > 0 ? "#dc2626" : undefined }}>
                  {place.request_count}
                </div>
                <div className="stat-label">Requests</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: "#059669" }}>
                  {place.total_altered}
                </div>
                <div className="stat-label">Altered</div>
              </div>
            </div>

            {/* People Section */}
            <div className="section">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>People Linked</h3>
                <button
                  onClick={() => setShowAddPerson(!showAddPerson)}
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    backgroundColor: showAddPerson ? "#94a3b8" : "#6366f1",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "14px",
                    lineHeight: "1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                  }}
                  title={showAddPerson ? "Cancel" : "Link a person"}
                >
                  {showAddPerson ? "\u00d7" : "+"}
                </button>
              </div>

              {/* Inline add person form */}
              {showAddPerson && (
                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      placeholder="Search people by name..."
                      value={addPersonQuery}
                      onChange={(e) => handlePersonSearch(e.target.value)}
                      style={{
                        width: "100%",
                        fontSize: "13px",
                        padding: "8px",
                        border: "1px solid #e5e7eb",
                        borderRadius: "6px",
                        boxSizing: "border-box",
                      }}
                    />
                    {addPersonResults.length > 0 && !addPersonSelected && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          backgroundColor: "#fff",
                          border: "1px solid #e5e7eb",
                          borderRadius: "6px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                          maxHeight: "150px",
                          overflowY: "auto",
                          zIndex: 10,
                        }}
                      >
                        {addPersonResults.map((r) => (
                          <div
                            key={r.entity_id}
                            onClick={() => {
                              setAddPersonSelected({ entity_id: r.entity_id, display_name: r.display_name });
                              setAddPersonQuery(r.display_name);
                              setAddPersonResults([]);
                            }}
                            style={{
                              padding: "8px 10px",
                              fontSize: "13px",
                              cursor: "pointer",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#fff")}
                          >
                            <div style={{ fontWeight: 500 }}>{r.display_name}</div>
                            {r.subtitle && (
                              <div style={{ fontSize: "11px", color: "#6b7280" }}>{r.subtitle}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <select
                    value={addPersonRole}
                    onChange={(e) => setAddPersonRole(e.target.value)}
                    style={{
                      width: "100%",
                      fontSize: "13px",
                      padding: "8px",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                      boxSizing: "border-box",
                      backgroundColor: "#fff",
                    }}
                  >
                    <option value="resident">Resident</option>
                    <option value="owner">Owner</option>
                    <option value="tenant">Tenant</option>
                    <option value="manager">Manager</option>
                    <option value="requester">Requester</option>
                    <option value="contact">Contact</option>
                    <option value="emergency_contact">Emergency Contact</option>
                    <option value="employee">Employee</option>
                    <option value="other">Other</option>
                  </select>
                  <button
                    onClick={handleAddPerson}
                    disabled={!addPersonSelected || addPersonLoading}
                    style={{
                      padding: "8px",
                      fontSize: "13px",
                      fontWeight: 600,
                      backgroundColor: addPersonSelected ? "#6366f1" : "#e5e7eb",
                      color: addPersonSelected ? "#fff" : "#9ca3af",
                      border: "none",
                      borderRadius: "6px",
                      cursor: addPersonSelected ? "pointer" : "not-allowed",
                    }}
                  >
                    {addPersonLoading ? "Linking..." : "Link Person"}
                  </button>
                </div>
              )}

              {uniquePeople.length > 0 && (
                <div className="people-list">
                  {uniquePeople
                    .sort((a, b) => (b.is_home ? 1 : 0) - (a.is_home ? 1 : 0))
                    .map((person) => (
                    <div
                      key={person.person_id}
                      style={{ display: "flex", alignItems: "center", gap: "4px" }}
                    >
                      <a
                        href={`/people/${person.person_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`person-link ${person.is_home ? "person-link-home" : ""}`}
                        style={{ flex: 1 }}
                      >
                        {person.display_name}
                        {person.role && (
                          <span className={`person-role-badge ${person.is_home ? "person-role-home" : "person-role-assoc"}`}>
                            {person.role === "resident" ? "Resident" :
                             person.role === "owner" ? "Owner" :
                             person.role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                          </span>
                        )}
                      </a>
                      {person.is_manual && (
                        <button
                          onClick={() => handleRemovePerson(person.person_id, person.role || "")}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "14px",
                            color: "#9ca3af",
                            padding: "2px 4px",
                            lineHeight: 1,
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#dc3545")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
                          title="Remove this link"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {uniquePeople.length === 0 && !showAddPerson && (
                <div style={{ fontSize: "13px", color: "#9ca3af", marginTop: "4px" }}>
                  No people linked yet.
                </div>
              )}
            </div>

            {/* Cats Section */}
            {place.cats && place.cats.length > 0 && (
              <div className="section">
                <h3>Cats at Location</h3>
                <div className="cats-list">
                  {place.cats.map((cat) => (
                    <a
                      key={cat.cat_id}
                      href={`/cats/${cat.cat_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cat-card"
                    >
                      <div className="cat-card-header">
                        <span className="cat-name">{cat.display_name || "Unknown"}</span>
                        <div className="cat-badges">
                          {cat.altered_status === "spayed" || cat.altered_status === "neutered" ? (
                            <span className="cat-badge cat-badge-altered">{cat.altered_status === "spayed" ? "S" : "N"}</span>
                          ) : (
                            <span className="cat-badge cat-badge-intact">?</span>
                          )}
                          {cat.sex && <span className="cat-badge cat-badge-sex">{cat.sex === "Male" ? "M" : cat.sex === "Female" ? "F" : cat.sex.charAt(0)}</span>}
                          {cat.is_deceased && <span className="cat-badge cat-badge-deceased">Dec</span>}
                        </div>
                      </div>
                      <div className="cat-card-details">
                        {cat.breed && <span>{cat.breed}</span>}
                        {cat.primary_color && <span>{cat.primary_color}</span>}
                        {cat.microchip && <span className="cat-microchip">{cat.microchip}</span>}
                      </div>
                      {cat.appointment_count > 0 && (
                        <div className="cat-card-appointments">
                          {cat.appointment_count} appointment{cat.appointment_count !== 1 ? "s" : ""}
                          {cat.latest_appointment_date && (
                            <> &middot; Last: {new Date(cat.latest_appointment_date).toLocaleDateString()}</>
                          )}
                        </div>
                      )}
                      {cat.latest_service_type && (
                        <div className="cat-card-services">
                          {formatServiceType(cat.latest_service_type)}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Notes Section with Tabs */}
            <div className="section notes-section">
              <div className="notes-tabs">
                <button
                  className={`notes-tab ${activeTab === "original" ? "active" : ""}`}
                  onClick={() => setActiveTab("original")}
                >
                  Original Notes
                  {place.google_notes.length > 0 && (
                    <span className="tab-count">{place.google_notes.length}</span>
                  )}
                </button>
                <button
                  className={`notes-tab ${activeTab === "ai" ? "active" : ""}`}
                  onClick={() => setActiveTab("ai")}
                >
                  AI Summaries
                </button>
                <button
                  className={`notes-tab ${activeTab === "journal" ? "active" : ""}`}
                  onClick={() => setActiveTab("journal")}
                >
                  Journal
                  {place.journal_entries.length > 0 && (
                    <span className="tab-count">{place.journal_entries.length}</span>
                  )}
                </button>
              </div>

              <div className="notes-content">
                {activeTab === "original" && (
                  <OriginalNotesList notes={place.google_notes} />
                )}
                {activeTab === "ai" && (
                  <AISummariesList notes={place.google_notes} />
                )}
                {activeTab === "journal" && (
                  <>
                    <div className="journal-add-form">
                      <textarea
                        placeholder="Add a note..."
                        value={journalBody}
                        onChange={(e) => setJournalBody(e.target.value)}
                        rows={2}
                        className="journal-add-textarea"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && journalBody.trim()) {
                            handleJournalSubmit();
                          }
                        }}
                      />
                      <button
                        className="journal-add-btn"
                        onClick={handleJournalSubmit}
                        disabled={journalSaving || !journalBody.trim()}
                      >
                        {journalSaving ? "Saving..." : "Add"}
                      </button>
                    </div>
                    <JournalEntriesList entries={place.journal_entries} />
                  </>
                )}
              </div>
            </div>

            {/* Watchlist Toggle */}
            <div className="section watchlist-section">
              <h3>Watch List</h3>

              {showWatchlistForm && !place.watch_list ? (
                <div className="watchlist-form">
                  <textarea
                    placeholder="Why should this place be on the watch list?"
                    value={watchlistReason}
                    onChange={(e) => setWatchlistReason(e.target.value)}
                    rows={3}
                  />
                  <div className="watchlist-form-buttons">
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowWatchlistForm(false);
                        setWatchlistReason("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={handleWatchlistToggle}
                      disabled={watchlistLoading || !watchlistReason.trim()}
                    >
                      {watchlistLoading ? "Adding..." : "Add to Watch List"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className={`watchlist-toggle ${place.watch_list ? "active" : ""}`}
                  onClick={handleWatchlistToggle}
                  disabled={watchlistLoading}
                >
                  {watchlistLoading
                    ? "Updating..."
                    : place.watch_list
                    ? "Remove from Watch List"
                    : "Add to Watch List"}
                </button>
              )}
            </div>

            {/* Footer Links */}
            <div className="drawer-footer">
              <a
                href={`/places/${place.place_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                Open Full Page →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Original notes with preserved formatting
function OriginalNotesList({ notes }: { notes: GoogleNote[] }) {
  if (notes.length === 0) {
    return <div className="notes-empty">No Google Maps notes linked to this location.</div>;
  }

  return (
    <div className="notes-list">
      {notes.map((note) => (
        <div
          key={note.entry_id}
          className={`note-entry ${note.ai_meaning === "watch_list" ? "note-watchlist" : ""} ${
            note.ai_meaning?.includes("disease") ? "note-disease" : ""
          }`}
        >
          <div className="note-header">
            <span className="note-date">
              {note.parsed_date
                ? new Date(note.parsed_date).toLocaleDateString()
                : "Unknown date"}
            </span>
            {note.kml_name && <span className="note-author">{note.kml_name}</span>}
          </div>
          <div className="note-body">
            {(note.original_redacted || note.original_content || "No content")
              .replace(/<br\s*\/?>/gi, "\n")
              .split("\n")
              .map((line, i) => (
                <p key={i}>{line || "\u00A0"}</p>
              ))}
          </div>
          {note.ai_meaning && (
            <span className={`meaning-badge meaning-${note.ai_meaning.replace(/_/g, "-")}`}>
              {formatMeaning(note.ai_meaning)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// AI summaries (rewritten for clarity)
function AISummariesList({ notes }: { notes: GoogleNote[] }) {
  const notesWithSummary = notes.filter((n) => n.ai_summary);

  if (notesWithSummary.length === 0) {
    return <div className="notes-empty">No AI summaries available for this location.</div>;
  }

  return (
    <div className="notes-list">
      {notesWithSummary.map((note) => (
        <div key={note.entry_id} className="note-entry note-ai">
          <div className="note-header">
            <span className="note-date">
              {note.parsed_date
                ? new Date(note.parsed_date).toLocaleDateString()
                : "Unknown date"}
            </span>
            <span className="note-badge">AI Summary</span>
          </div>
          <div className="note-body">
            <p>{note.ai_summary}</p>
          </div>
          {note.ai_meaning && (
            <span className={`meaning-badge meaning-${note.ai_meaning.replace(/_/g, "-")}`}>
              {formatMeaning(note.ai_meaning)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// Journal entries from Atlas
function JournalEntriesList({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) {
    return <div className="notes-empty">No journal entries for this location.</div>;
  }

  return (
    <div className="notes-list">
      {entries.map((entry) => (
        <div key={entry.id} className="note-entry note-journal">
          <div className="note-header">
            <span className="note-date">
              {new Date(entry.created_at).toLocaleDateString()}
            </span>
            {entry.created_by && <span className="note-author">{entry.created_by}</span>}
            <span className="note-badge">{formatEntryType(entry.entry_kind)}</span>
          </div>
          <div className="note-body">
            {entry.body.split("\n").map((line, i) => (
              <p key={i}>{line || "\u00A0"}</p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Helper to format AI meaning badges
function formatMeaning(meaning: string): string {
  const labels: Record<string, string> = {
    watch_list: "Watch List",
    disease_risk: "Disease Risk",
    felv_colony: "FeLV Colony",
    fiv_colony: "FIV Colony",
    active_colony: "Active Colony",
    historical: "Historical",
    resolved: "Resolved",
  };
  return labels[meaning] || meaning.replace(/_/g, " ");
}

// Helper to format journal entry types
function formatEntryType(type: string): string {
  const labels: Record<string, string> = {
    note: "Note",
    call_log: "Call",
    visit: "Site Visit",
    update: "Update",
    observation: "Observation",
  };
  return labels[type] || type;
}

// Helper to format service type from appointment data
function formatServiceType(serviceType: string): string {
  // Service types come as "Service1 / /; Service2 / /; ..."
  const services = serviceType
    .split(/;\s*/)
    .map((s) => s.replace(/\s*\/\s*\/?\s*/g, "").trim())
    .filter((s) => s.length > 0 && s !== "/");
  if (services.length === 0) return "";
  if (services.length <= 3) return services.join(", ");
  return services.slice(0, 3).join(", ") + ` +${services.length - 3} more`;
}

// Helper to format data source system names for display
function formatSourceName(source: string): string {
  const labels: Record<string, string> = {
    shelterluv: "ShelterLuv",
    volunteerhub: "VolunteerHub",
    google_maps: "Google Maps",
    clinichq: "ClinicHQ",
    airtable: "Airtable",
    airtable_sync: "Airtable",
    atlas_ui: "Atlas",
    web_intake: "Web Intake",
    web_app: "Atlas",
    file_upload: "Import",
    app: "Atlas",
    legacy_import: "Legacy",
  };
  return labels[source] || source;
}

// Helper to format disease status for display
function formatDiseaseStatus(status: string): string {
  const labels: Record<string, string> = {
    confirmed_active: "Confirmed Active",
    suspected: "Suspected",
    historical: "Historical",
    perpetual: "Perpetual",
    false_flag: "Dismissed",
    cleared: "Cleared",
  };
  return labels[status] || status.replace(/_/g, " ");
}
