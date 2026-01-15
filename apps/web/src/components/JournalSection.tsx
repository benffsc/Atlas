"use client";

import { useState, useEffect } from "react";

interface StaffMember {
  staff_id: string;
  display_name: string;
  first_name: string;
  last_name: string | null;
  role: string;
}

export interface JournalEntry {
  id: string;
  body: string;
  title: string | null;
  entry_kind: string;
  created_by: string | null;
  created_by_staff_id: string | null;
  created_by_staff_name?: string | null;
  created_by_staff_role?: string | null;
  created_at: string;
  updated_by: string | null;
  updated_by_staff_id: string | null;
  updated_at: string;
  occurred_at: string | null;
  is_archived: boolean;
  is_pinned: boolean;
  edit_count: number;
  tags: string[];
  // Optional linked entity names
  cat_name?: string | null;
  person_name?: string | null;
  place_name?: string | null;
  primary_cat_id?: string | null;
  primary_person_id?: string | null;
  primary_place_id?: string | null;
}

interface JournalSectionProps {
  entries: JournalEntry[];
  entityType: "cat" | "person" | "place" | "request";
  entityId: string;
  onEntryAdded: () => void;
}

// Get initials from a name
function getInitials(name: string | null): string {
  if (!name) return "??";

  // Try to extract initials from name
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "Today";
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined
    });
  }
}

// Entry kind colors and labels
const ENTRY_KIND_STYLES: Record<string, { bg: string; label: string }> = {
  note: { bg: "#0d6efd", label: "Note" },
  contact: { bg: "#17a2b8", label: "Contact" },
  field_visit: { bg: "#28a745", label: "Field Visit" },
  medical: { bg: "#dc3545", label: "Medical" },
  trap_event: { bg: "#fd7e14", label: "Trap" },
  intake: { bg: "#6f42c1", label: "Intake" },
  release: { bg: "#20c997", label: "Release" },
  status_change: { bg: "#6c757d", label: "Status" },
  system: { bg: "#adb5bd", label: "System" },
};

export default function JournalSection({
  entries,
  entityType,
  entityId,
  onEntryAdded,
}: JournalSectionProps) {
  const [newNote, setNewNote] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [addingNote, setAddingNote] = useState(false);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Fetch staff list on mount
  useEffect(() => {
    fetch("/api/staff")
      .then((res) => res.json())
      .then((data) => setStaffList(data.staff || []))
      .catch((err) => console.error("Failed to fetch staff:", err));
  }, []);

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedStaffId) return;

    const selectedStaff = staffList.find(s => s.staff_id === selectedStaffId);

    setAddingNote(true);
    try {
      const body: Record<string, string> = {
        body: newNote,
        entry_kind: "note",
        created_by: selectedStaff?.display_name || "Unknown",
        created_by_staff_id: selectedStaffId,
      };

      // Set the appropriate entity ID
      if (entityType === "cat") body.cat_id = entityId;
      else if (entityType === "person") body.person_id = entityId;
      else if (entityType === "place") body.place_id = entityId;
      else if (entityType === "request") body.request_id = entityId;

      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        setNewNote("");
        onEntryAdded();
      }
    } catch (err) {
      console.error("Failed to add note:", err);
    } finally {
      setAddingNote(false);
    }
  };

  const toggleExpanded = (entryId: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const renderLinkedEntities = (entry: JournalEntry) => {
    const links: JSX.Element[] = [];

    if (entry.primary_cat_id && entityType !== "cat") {
      links.push(
        <a key="cat" href={`/cats/${entry.primary_cat_id}`} className="text-sm" style={{ color: "#0d6efd" }}>
          {entry.cat_name || "Cat"}
        </a>
      );
    }
    if (entry.primary_person_id && entityType !== "person") {
      links.push(
        <a key="person" href={`/people/${entry.primary_person_id}`} className="text-sm" style={{ color: "#0d6efd" }}>
          {entry.person_name || "Person"}
        </a>
      );
    }
    if (entry.primary_place_id && entityType !== "place") {
      links.push(
        <a key="place" href={`/places/${entry.primary_place_id}`} className="text-sm" style={{ color: "#0d6efd" }}>
          {entry.place_name || "Place"}
        </a>
      );
    }

    return links.length > 0 ? (
      <span style={{ marginLeft: "0.5rem", display: "inline-flex", gap: "0.5rem" }}>
        {links}
      </span>
    ) : null;
  };

  return (
    <div>
      {/* Add new note */}
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <select
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
            style={{
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #dee2e6",
              minWidth: "160px"
            }}
          >
            <option value="">Select staff...</option>
            {staffList.map((s) => (
              <option key={s.staff_id} value={s.staff_id}>
                {s.display_name} ({s.role})
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          style={{ width: "100%", resize: "vertical" }}
        />
        <button
          onClick={handleAddNote}
          disabled={addingNote || !newNote.trim() || !selectedStaffId}
          style={{ marginTop: "0.5rem" }}
        >
          {addingNote ? "Adding..." : "Add Note"}
        </button>
      </div>

      {/* Entries list */}
      {entries.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {entries.map((entry) => {
            const isExpanded = expandedEntries.has(entry.id);
            const kindStyle = ENTRY_KIND_STYLES[entry.entry_kind] || ENTRY_KIND_STYLES.note;
            // Prefer staff name, fall back to created_by
            const displayName = entry.created_by_staff_name || entry.created_by;
            const initials = getInitials(displayName);
            const dateStr = formatDate(entry.occurred_at || entry.created_at);
            const isLong = entry.body.length > 120;

            return (
              <div
                key={entry.id}
                onClick={() => isLong && toggleExpanded(entry.id)}
                style={{
                  padding: isExpanded ? "1rem" : "0.75rem",
                  background: entry.is_pinned ? "#e3f2fd" : "#f8f9fa",
                  borderRadius: "6px",
                  borderLeft: `3px solid ${kindStyle.bg}`,
                  cursor: isLong ? "pointer" : "default",
                  transition: "all 0.15s ease",
                }}
              >
                {/* Compact header */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  flexWrap: "wrap"
                }}>
                  {/* Initials badge */}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      background: entry.created_by_staff_id ? "#0d6efd" : "#6c757d",
                      color: "#fff",
                      fontSize: "0.7rem",
                      fontWeight: "bold",
                      flexShrink: 0,
                    }}
                    title={`${displayName || "Unknown"}${entry.created_by_staff_role ? ` (${entry.created_by_staff_role})` : ""}`}
                  >
                    {initials}
                  </span>

                  {/* Entry kind badge */}
                  <span
                    style={{
                      padding: "0.15rem 0.4rem",
                      borderRadius: "3px",
                      background: kindStyle.bg,
                      color: "#fff",
                      fontSize: "0.65rem",
                      fontWeight: 500,
                    }}
                  >
                    {kindStyle.label}
                  </span>

                  {/* Pinned indicator */}
                  {entry.is_pinned && (
                    <span style={{ fontSize: "0.7rem", color: "#6c757d" }}>
                      pinned
                    </span>
                  )}

                  {/* Date */}
                  <span style={{ fontSize: "0.75rem", color: "#6c757d" }}>
                    {dateStr}
                  </span>

                  {/* Edited indicator */}
                  {entry.edit_count > 0 && (
                    <span style={{ fontSize: "0.7rem", color: "#6c757d", fontStyle: "italic" }}>
                      edited
                    </span>
                  )}

                  {/* Linked entities */}
                  {renderLinkedEntities(entry)}

                  {/* Expand indicator */}
                  {isLong && (
                    <span style={{
                      marginLeft: "auto",
                      fontSize: "0.7rem",
                      color: "#6c757d"
                    }}>
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  )}
                </div>

                {/* Title if present */}
                {entry.title && (
                  <p style={{
                    margin: "0.5rem 0 0 0",
                    fontWeight: "bold",
                    fontSize: "0.9rem"
                  }}>
                    {entry.title}
                  </p>
                )}

                {/* Body - compact or expanded */}
                <p style={{
                  margin: "0.5rem 0 0 0",
                  whiteSpace: "pre-wrap",
                  fontSize: "0.9rem",
                  lineHeight: "1.4",
                  overflow: "hidden",
                  ...(isLong && !isExpanded ? {
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                  } : {})
                }}>
                  {entry.body}
                </p>

                {/* Full timestamp when expanded */}
                {isExpanded && (
                  <div style={{
                    marginTop: "0.75rem",
                    paddingTop: "0.5rem",
                    borderTop: "1px solid #dee2e6",
                    fontSize: "0.75rem",
                    color: "#6c757d"
                  }}>
                    Created: {new Date(entry.created_at).toLocaleString()}
                    {entry.updated_at !== entry.created_at && (
                      <span> | Updated: {new Date(entry.updated_at).toLocaleString()}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-muted">No journal entries yet.</p>
      )}
    </div>
  );
}
