"use client";

import { useState, useEffect } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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
  contact_method?: string | null;
  contact_result?: string | null;
  // Optional linked entity names
  cat_name?: string | null;
  person_name?: string | null;
  place_name?: string | null;
  primary_cat_id?: string | null;
  primary_person_id?: string | null;
  primary_place_id?: string | null;
  cross_ref_source?: string | null;
}

interface JournalSectionProps {
  entries: JournalEntry[];
  entityType: "cat" | "person" | "place" | "request";
  entityId: string;
  onEntryAdded: () => void;
  /** Auto-fill staff from session - hides dropdown when provided.
   *  If omitted, resolves automatically from useCurrentUser() hook. */
  currentStaffId?: string;
  currentStaffName?: string;
}

// Contact method options
const CONTACT_METHODS = [
  { value: "phone", label: "Phone Call" },
  { value: "text", label: "Text / SMS" },
  { value: "email", label: "Email" },
  { value: "voicemail", label: "Voicemail" },
  { value: "in_person", label: "In Person" },
  { value: "mail", label: "Mail" },
  { value: "online_form", label: "Online Form" },
];

// Contact result options
const CONTACT_RESULTS = [
  { value: "answered", label: "Answered / Spoke" },
  { value: "no_answer", label: "No Answer" },
  { value: "left_voicemail", label: "Left Voicemail" },
  { value: "sent", label: "Sent" },
  { value: "scheduled", label: "Scheduled" },
  { value: "no_response", label: "No Response" },
  { value: "bounced", label: "Bounced" },
  { value: "other", label: "Other" },
];

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
  contact_attempt: { bg: "#6f42c1", label: "Communication" },
  communication: { bg: "#17a2b8", label: "Communication" },
  field_visit: { bg: "#28a745", label: "Field Visit" },
  medical: { bg: "#dc3545", label: "Medical" },
  trap_event: { bg: "#fd7e14", label: "Trap" },
  intake: { bg: "#6f42c1", label: "Intake" },
  release: { bg: "#20c997", label: "Release" },
  status_change: { bg: "#6c757d", label: "Status" },
  system: { bg: "#adb5bd", label: "System" },
};

// Contact method display labels
const CONTACT_METHOD_LABELS: Record<string, string> = {
  phone: "Phone",
  text: "Text",
  email: "Email",
  voicemail: "Voicemail",
  in_person: "In Person",
  mail: "Mail",
  online_form: "Form",
};

// Contact result display labels
const CONTACT_RESULT_LABELS: Record<string, string> = {
  answered: "Answered",
  no_answer: "No Answer",
  left_voicemail: "Left VM",
  sent: "Sent",
  scheduled: "Scheduled",
  spoke: "Spoke",
  meeting_held: "Met",
  no_response: "No Response",
  bounced: "Bounced",
  other: "Other",
};

export default function JournalSection({
  entries,
  entityType,
  entityId,
  onEntryAdded,
  currentStaffId,
  currentStaffName,
}: JournalSectionProps) {
  // Self-resolve staff from session when props not provided
  const { user } = useCurrentUser();
  const effectiveStaffId = currentStaffId || user?.staff_id || "";
  const effectiveStaffName = currentStaffName || user?.display_name || "";
  const isStaffAutoFilled = !!(currentStaffId || user?.staff_id);

  const [newNote, setNewNote] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<string>(effectiveStaffId);
  const [addingNote, setAddingNote] = useState(false);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Communication logging state
  const [entryMode, setEntryMode] = useState<"note" | "communication">("note");
  const [contactMethod, setContactMethod] = useState("phone");
  const [contactResult, setContactResult] = useState("answered");

  // Fetch staff list on mount (only needed if no auto-fill)
  useEffect(() => {
    if (!isStaffAutoFilled) {
      fetch("/api/staff")
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Staff API returned ${res.status}: ${res.statusText}`);
          }
          return res.json();
        })
        .then((data) => {
          if (!data.staff || data.staff.length === 0) {
            console.warn("JournalSection: No active staff found in database");
          }
          setStaffList(data.staff || []);
        })
        .catch((err) => {
          console.error("Failed to fetch staff:", err);
          // Still set empty array so UI doesn't break
          setStaffList([]);
        });
    }
  }, [isStaffAutoFilled]);

  // Keep selectedStaffId in sync with effective staff
  useEffect(() => {
    const id = currentStaffId || user?.staff_id;
    if (id) {
      setSelectedStaffId(id);
    }
  }, [currentStaffId, user?.staff_id]);

  const handleAddEntry = async () => {
    if (!newNote.trim() || !selectedStaffId) return;

    // Use effective name if auto-filled, otherwise look up from list
    const displayName = isStaffAutoFilled
      ? effectiveStaffName
      : staffList.find(s => s.staff_id === selectedStaffId)?.display_name;

    setAddingNote(true);
    try {
      const payload: Record<string, string> = {
        body: newNote,
        entry_kind: entryMode === "communication" ? "contact_attempt" : "note",
        created_by: displayName || "Unknown",
        created_by_staff_id: selectedStaffId,
      };

      // Communication-specific fields
      if (entryMode === "communication") {
        payload.contact_method = contactMethod;
        payload.contact_result = contactResult;
      }

      // Set the appropriate entity ID
      if (entityType === "cat") payload.cat_id = entityId;
      else if (entityType === "person") payload.person_id = entityId;
      else if (entityType === "place") payload.place_id = entityId;
      else if (entityType === "request") payload.request_id = entityId;

      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setNewNote("");
        onEntryAdded();
      }
    } catch (err) {
      console.error("Failed to add entry:", err);
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

  const isCommunication = entryMode === "communication";

  return (
    <div>
      {/* Entry creation form */}
      <div style={{ marginBottom: "1rem" }}>
        {/* Staff attribution */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {isStaffAutoFilled ? (
            <span style={{
              padding: "0.375rem 0.625rem",
              background: "var(--info-bg)",
              borderRadius: "4px",
              fontSize: "0.8rem",
              color: "var(--info-text)",
            }}>
              Logged by: <strong>{effectiveStaffName || "You"}</strong>
            </span>
          ) : (
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              style={{
                padding: "0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--border)",
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
          )}
        </div>

        {/* Mode toggle: Note vs Communication */}
        <div style={{ display: "flex", gap: 0, marginBottom: "0.5rem" }}>
          <button
            type="button"
            onClick={() => setEntryMode("note")}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.8rem",
              fontWeight: 500,
              border: "1px solid var(--border)",
              borderRadius: "4px 0 0 4px",
              background: !isCommunication ? "#0d6efd" : "var(--card-bg, #f8f9fa)",
              color: !isCommunication ? "#fff" : "var(--foreground)",
              cursor: "pointer",
            }}
          >
            Note
          </button>
          <button
            type="button"
            onClick={() => setEntryMode("communication")}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.8rem",
              fontWeight: 500,
              border: "1px solid var(--border)",
              borderLeft: "none",
              borderRadius: "0 4px 4px 0",
              background: isCommunication ? "#6f42c1" : "var(--card-bg, #f8f9fa)",
              color: isCommunication ? "#fff" : "var(--foreground)",
              cursor: "pointer",
            }}
          >
            Log Communication
          </button>
        </div>

        {/* Communication-specific fields */}
        {isCommunication && (
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <select
              value={contactMethod}
              onChange={(e) => setContactMethod(e.target.value)}
              style={{
                padding: "0.375rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                fontSize: "0.85rem",
              }}
            >
              {CONTACT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <select
              value={contactResult}
              onChange={(e) => setContactResult(e.target.value)}
              style={{
                padding: "0.375rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                fontSize: "0.85rem",
              }}
            >
              {CONTACT_RESULTS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        )}

        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder={isCommunication ? "Describe the communication..." : "Add a note..."}
          rows={2}
          style={{ width: "100%", resize: "vertical" }}
        />
        <button
          onClick={handleAddEntry}
          disabled={addingNote || !newNote.trim() || !selectedStaffId}
          style={{ marginTop: "0.5rem" }}
        >
          {addingNote ? "Saving..." : isCommunication ? "Log Communication" : "Add Note"}
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
                  background: entry.is_pinned ? "var(--accent-bg, #e3f2fd)" : "var(--card-bg, #f8f9fa)",
                  borderRadius: "6px",
                  borderLeft: `3px solid ${kindStyle.bg}`,
                  cursor: isLong ? "pointer" : "default",
                  transition: "all 0.15s ease",
                  color: "var(--foreground)",
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

                  {/* Contact method badge */}
                  {entry.contact_method && (
                    <span
                      style={{
                        padding: "0.15rem 0.4rem",
                        borderRadius: "3px",
                        background: "var(--bg-secondary, #e9ecef)",
                        color: "var(--foreground)",
                        fontSize: "0.65rem",
                        fontWeight: 500,
                      }}
                    >
                      {CONTACT_METHOD_LABELS[entry.contact_method] || entry.contact_method}
                    </span>
                  )}

                  {/* Contact result badge */}
                  {entry.contact_result && (
                    <span
                      style={{
                        padding: "0.15rem 0.4rem",
                        borderRadius: "3px",
                        background: entry.contact_result === "answered" || entry.contact_result === "spoke"
                          ? "#d4edda" : entry.contact_result === "no_answer" || entry.contact_result === "bounced"
                          ? "#f8d7da" : "var(--bg-secondary, #e9ecef)",
                        color: entry.contact_result === "answered" || entry.contact_result === "spoke"
                          ? "#155724" : entry.contact_result === "no_answer" || entry.contact_result === "bounced"
                          ? "#721c24" : "var(--foreground)",
                        fontSize: "0.65rem",
                        fontWeight: 500,
                      }}
                    >
                      {CONTACT_RESULT_LABELS[entry.contact_result] || entry.contact_result}
                    </span>
                  )}

                  {/* Pinned indicator */}
                  {entry.is_pinned && (
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                      pinned
                    </span>
                  )}

                  {/* Date */}
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {dateStr}
                  </span>

                  {/* Edited indicator */}
                  {entry.edit_count > 0 && (
                    <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontStyle: "italic" }}>
                      edited
                    </span>
                  )}

                  {/* Cross-reference source */}
                  {entry.cross_ref_source && (
                    <span
                      style={{
                        padding: "0.15rem 0.4rem",
                        borderRadius: "3px",
                        background: "rgba(108,117,125,0.08)",
                        color: "var(--muted, #6c757d)",
                        fontSize: "0.6rem",
                        fontWeight: 500,
                        fontStyle: "italic",
                        border: "1px dashed var(--border, #dee2e6)",
                      }}
                      title={`Originally on a linked ${entry.cross_ref_source}`}
                    >
                      via {entry.cross_ref_source}
                    </span>
                  )}

                  {/* Linked entities */}
                  {renderLinkedEntities(entry)}

                  {/* Expand indicator */}
                  {isLong && (
                    <span style={{
                      marginLeft: "auto",
                      fontSize: "0.7rem",
                      color: "var(--muted)"
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
                    borderTop: "1px solid var(--border)",
                    fontSize: "0.75rem",
                    color: "var(--muted)"
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
