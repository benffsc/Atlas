"use client";

import { useState, useEffect, useMemo } from "react";

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
  entry_id: string;
  entry_type: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

interface DiseaseBadge {
  disease_key: string;
  short_code: string;
  color: string;
  status: string;
  last_positive_date: string | null;
  positive_cat_count: number;
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
  people: Array<{ person_id: string; display_name: string }>;

  // Notes
  google_notes: GoogleNote[];
  journal_entries: JournalEntry[];
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

  // Watchlist toggle state
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistReason, setWatchlistReason] = useState("");
  const [showWatchlistForm, setShowWatchlistForm] = useState(false);

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

            {/* Street View Preview */}
            {coordinates && (
              <div className="street-view-drawer">
                <button
                  className="street-view-drawer-toggle"
                  onClick={() => setShowStreetView(!showStreetView)}
                >
                  <span>📷 Street View</span>
                  <span style={{ transform: showStreetView ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
                </button>
                {showStreetView && (
                  <iframe
                    className="street-view-drawer-iframe"
                    src={`/api/streetview/embed?lat=${coordinates.lat}&lng=${coordinates.lng}`}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                )}
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
            {uniquePeople.length > 0 && (
              <div className="section">
                <h3>People Linked</h3>
                <div className="people-list">
                  {uniquePeople.map((person) => (
                    <a
                      key={person.person_id}
                      href={`/people/${person.person_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="person-link"
                    >
                      {person.display_name}
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
                  <JournalEntriesList entries={place.journal_entries} />
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
        <div key={entry.entry_id} className="note-entry note-journal">
          <div className="note-header">
            <span className="note-date">
              {new Date(entry.created_at).toLocaleDateString()}
            </span>
            {entry.author_name && <span className="note-author">{entry.author_name}</span>}
            <span className="note-badge">{formatEntryType(entry.entry_type)}</span>
          </div>
          <div className="note-body">
            {entry.content.split("\n").map((line, i) => (
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
