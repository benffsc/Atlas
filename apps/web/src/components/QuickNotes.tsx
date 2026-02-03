"use client";

import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { JournalEntry } from "@/components/JournalSection";

interface QuickNotesProps {
  entityType: "person" | "place" | "cat";
  entityId: string;
  entries: JournalEntry[];
  onNoteAdded: () => void;
  /** Tab ID for "View all" link. Defaults to "activity". Person page uses "journal". */
  activityTabId?: string;
}

const ENTITY_KEY_MAP: Record<string, string> = {
  person: "person_id",
  place: "place_id",
  cat: "cat_id",
};

function getInitials(name: string | null): string {
  if (!name) return "??";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export default function QuickNotes({
  entityType,
  entityId,
  entries,
  onNoteAdded,
  activityTabId = "activity",
}: QuickNotesProps) {
  const { user, isLoading: authLoading } = useCurrentUser();
  const [newNote, setNewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter to notes only, sort pinned first then by date descending
  const notes = entries
    .filter((e) => e.entry_kind === "note" && !e.is_archived)
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      const dateA = new Date(a.occurred_at || a.created_at).getTime();
      const dateB = new Date(b.occurred_at || b.created_at).getTime();
      return dateB - dateA;
    })
    .slice(0, 5);

  const handleSubmit = async () => {
    if (!newNote.trim() || !user?.staff_id) return;

    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, string> = {
        body: newNote.trim(),
        entry_kind: "note",
        created_by: user.display_name || "Unknown",
        created_by_staff_id: user.staff_id,
        [ENTITY_KEY_MAP[entityType]]: entityId,
      };

      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setNewNote("");
        onNoteAdded();
      } else {
        const data = await response.json().catch(() => null);
        setError(data?.error || "Failed to save note");
      }
    } catch {
      setError("Failed to save note");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className="card"
      style={{
        padding: "1rem 1.25rem",
        marginBottom: "1.5rem",
        borderLeft: "3px solid #0d6efd",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>Staff Notes</div>
        {entries.some((e) => e.entry_kind === "note") && (
          <a
            href={`?tab=${activityTabId}`}
            style={{
              fontSize: "0.8rem",
              color: "#0d6efd",
              textDecoration: "none",
            }}
          >
            View all &rarr;
          </a>
        )}
      </div>

      {/* Input area */}
      {user?.staff_id && (
        <div style={{ marginBottom: notes.length > 0 ? "0.75rem" : 0 }}>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "flex-start",
            }}
          >
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a quick note..."
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                padding: "0.5rem 0.75rem",
                fontSize: "0.85rem",
                borderRadius: "6px",
                border: "1px solid var(--border, #dee2e6)",
                background: "var(--card-bg, #fff)",
                color: "var(--foreground)",
              }}
              onFocus={(e) => {
                e.currentTarget.rows = 2;
              }}
              onBlur={(e) => {
                if (!e.currentTarget.value) e.currentTarget.rows = 1;
              }}
              disabled={submitting}
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || !newNote.trim()}
              style={{
                padding: "0.5rem 0.75rem",
                fontSize: "0.8rem",
                fontWeight: 500,
                border: "none",
                borderRadius: "6px",
                background:
                  newNote.trim() && !submitting ? "#0d6efd" : "#94a3b8",
                color: "#fff",
                cursor:
                  newNote.trim() && !submitting ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              {submitting ? "..." : "Add"}
            </button>
          </div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--muted, #6c757d)",
              marginTop: "0.25rem",
            }}
          >
            Posting as {user.display_name}
          </div>
          {error && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "#dc3545",
                marginTop: "0.25rem",
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}

      {authLoading && !user && (
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--muted, #6c757d)",
            marginBottom: "0.5rem",
          }}
        >
          Loading...
        </div>
      )}

      {/* Notes list */}
      {notes.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {notes.map((note) => {
            const displayName =
              note.created_by_staff_name || note.created_by;
            const initials = getInitials(displayName);
            const dateStr = formatDate(
              note.occurred_at || note.created_at
            );

            return (
              <div
                key={note.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.375rem 0.5rem",
                  background: note.is_pinned
                    ? "var(--accent-bg, #e3f2fd)"
                    : "var(--card-bg, #f8f9fa)",
                  borderRadius: "4px",
                  minWidth: 0,
                }}
              >
                {/* Pin indicator */}
                {note.is_pinned && (
                  <span
                    style={{ fontSize: "0.7rem", flexShrink: 0 }}
                    title="Pinned"
                  >
                    pin
                  </span>
                )}

                {/* Initials badge */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    background: note.created_by_staff_id
                      ? "#0d6efd"
                      : "#6c757d",
                    color: "#fff",
                    fontSize: "0.6rem",
                    fontWeight: "bold",
                    flexShrink: 0,
                  }}
                  title={displayName || "Unknown"}
                >
                  {initials}
                </span>

                {/* Note body - truncated */}
                <span
                  style={{
                    flex: 1,
                    fontSize: "0.8rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    color: "var(--foreground)",
                  }}
                  title={note.body}
                >
                  {note.body}
                </span>

                {/* Date */}
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--muted, #6c757d)",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {dateStr}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        !authLoading && (
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--muted, #6c757d)",
              padding: "0.5rem 0",
            }}
          >
            No notes yet.{user?.staff_id ? " Add one above." : ""}
          </div>
        )
      )}
    </div>
  );
}
