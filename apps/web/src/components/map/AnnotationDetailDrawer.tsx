"use client";

import { useState, useEffect } from "react";

interface JournalEntry {
  id: string;
  entry_kind: string;
  title: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
}

interface AnnotationDetails {
  annotation_id: string;
  label: string;
  note: string | null;
  photo_url: string | null;
  annotation_type: string;
  created_by: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  lat: number;
  lng: number;
  journal_count: number;
  journal_entries: JournalEntry[];
}

interface AnnotationDetailDrawerProps {
  annotationId: string | null;
  onClose: () => void;
}

const ANNOTATION_TYPE_COLORS: Record<string, string> = {
  colony_sighting: "#22c55e",
  trap_location: "#3b82f6",
  hazard: "#ef4444",
  feeding_site: "#f59e0b",
  general: "#6b7280",
  other: "#8b5cf6",
};

const ANNOTATION_TYPE_LABELS: Record<string, string> = {
  colony_sighting: "Colony Sighting",
  trap_location: "Trap Location",
  hazard: "Hazard",
  feeding_site: "Feeding Site",
  general: "General",
  other: "Other",
};

function formatEntryKind(kind: string): string {
  const labels: Record<string, string> = {
    note: "Note",
    call_log: "Call",
    visit: "Site Visit",
    update: "Update",
    observation: "Observation",
  };
  return labels[kind] || kind;
}

export function AnnotationDetailDrawer({ annotationId, onClose }: AnnotationDetailDrawerProps) {
  const [annotation, setAnnotation] = useState<AnnotationDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Journal entry creation
  const [journalBody, setJournalBody] = useState("");
  const [journalSaving, setJournalSaving] = useState(false);

  // Fetch annotation details when annotationId changes
  useEffect(() => {
    if (!annotationId) {
      setAnnotation(null);
      return;
    }

    setAnnotation(null);
    setLoading(true);
    setError(null);
    setJournalBody("");

    fetch(`/api/annotations/${annotationId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load annotation details");
        return res.json();
      })
      .then((data) => {
        setAnnotation(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [annotationId]);

  // Refetch annotation details (used after adding journal entries)
  const refetchAnnotation = () => {
    if (!annotationId) return;
    fetch(`/api/annotations/${annotationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setAnnotation(data);
      });
  };

  // Handle journal entry creation
  const handleJournalSubmit = async () => {
    if (!annotation || !journalBody.trim()) return;
    setJournalSaving(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotation_id: annotation.annotation_id,
          body: journalBody.trim(),
          entry_kind: "note",
          created_by: "staff",
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setJournalBody("");
      refetchAnnotation();
    } catch {
      alert("Failed to save journal entry");
    } finally {
      setJournalSaving(false);
    }
  };

  if (!annotationId) return null;

  const typeColor = annotation
    ? ANNOTATION_TYPE_COLORS[annotation.annotation_type] || ANNOTATION_TYPE_COLORS.general
    : ANNOTATION_TYPE_COLORS.general;

  const typeLabel = annotation
    ? ANNOTATION_TYPE_LABELS[annotation.annotation_type] || annotation.annotation_type
    : "";

  return (
    <div className="place-detail-drawer">
      {/* Header */}
      <div className="drawer-header">
        <div className="drawer-title">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h2>{annotation?.label || "Loading..."}</h2>
            {annotation && (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 10px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "white",
                  backgroundColor: typeColor,
                  whiteSpace: "nowrap",
                }}
              >
                {typeLabel}
              </span>
            )}
          </div>
          {annotation && !annotation.is_active && (
            <span
              style={{
                fontSize: "12px",
                color: "#ef4444",
                fontWeight: 500,
                marginTop: "4px",
                display: "block",
              }}
            >
              Inactive
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

        {annotation && !loading && (
          <>
            {/* Note */}
            {annotation.note && (
              <div style={{
                padding: "12px",
                background: "var(--map-control-hover)",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "14px",
                lineHeight: "1.5",
                color: "var(--map-control-text)",
              }}>
                {annotation.note.split("\n").map((line, i) => (
                  <p key={i} style={{ margin: "0 0 4px 0" }}>{line || "\u00A0"}</p>
                ))}
              </div>
            )}

            {/* Photo */}
            {annotation.photo_url && (
              <div style={{
                marginBottom: "16px",
                borderRadius: "8px",
                overflow: "hidden",
                border: "1px solid var(--map-control-border)",
              }}>
                <img
                  src={annotation.photo_url}
                  alt={annotation.label}
                  style={{
                    width: "100%",
                    display: "block",
                    maxHeight: "240px",
                    objectFit: "cover",
                  }}
                />
              </div>
            )}

            {/* Info Row */}
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "12px",
              marginBottom: "16px",
              fontSize: "13px",
              color: "var(--map-popup-secondary)",
            }}>
              <span>
                <strong style={{ color: "var(--map-control-text)" }}>Created by:</strong>{" "}
                {annotation.created_by}
              </span>
              <span>
                <strong style={{ color: "var(--map-control-text)" }}>Date:</strong>{" "}
                {new Date(annotation.created_at).toLocaleDateString()}
              </span>
              {annotation.expires_at && (
                <span>
                  <strong style={{ color: "var(--map-control-text)" }}>Expires:</strong>{" "}
                  {new Date(annotation.expires_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Coordinates */}
            <div style={{
              fontSize: "12px",
              color: "var(--map-popup-secondary)",
              marginBottom: "20px",
              fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", monospace',
            }}>
              {annotation.lat.toFixed(6)}, {annotation.lng.toFixed(6)}
            </div>

            {/* Journal Section */}
            <div className="section notes-section">
              <h3>
                Journal
                {annotation.journal_count > 0 && (
                  <span
                    className="tab-count"
                    style={{ marginLeft: "8px" }}
                  >
                    {annotation.journal_count}
                  </span>
                )}
              </h3>

              {/* Journal Add Form */}
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

              {/* Journal Entries List */}
              <div className="notes-content">
                {annotation.journal_entries.length === 0 ? (
                  <div className="notes-empty">No journal entries for this annotation.</div>
                ) : (
                  <div className="notes-list">
                    {annotation.journal_entries.map((entry) => (
                      <div key={entry.id} className="note-entry note-journal">
                        <div className="note-header">
                          <span className="note-date">
                            {new Date(entry.created_at).toLocaleDateString()}
                          </span>
                          {entry.created_by && (
                            <span className="note-author">{entry.created_by}</span>
                          )}
                          <span className="note-badge">
                            {formatEntryKind(entry.entry_kind)}
                          </span>
                        </div>
                        <div className="note-body">
                          {entry.body.split("\n").map((line, i) => (
                            <p key={i}>{line || "\u00A0"}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
