"use client";

import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { JournalEntry } from "@/components/JournalSection";

interface QuickNotesProps {
  entityType: "person" | "place" | "cat";
  entityId: string;
  entries: JournalEntry[];
  onNoteAdded: () => void;
}

type NoteLevel = "info" | "heads_up" | "warning";

const LEVEL_STYLES: Record<NoteLevel, { border: string; bg: string; label: string; btnBg: string }> = {
  info:     { border: "#0d6efd", bg: "#e7f1ff", label: "Info",     btnBg: "#0d6efd" },
  heads_up: { border: "#f59e0b", bg: "#fef3c7", label: "Heads-up", btnBg: "#d97706" },
  warning:  { border: "#dc3545", bg: "#fee2e2", label: "Warning",  btnBg: "#dc3545" },
};

const ENTITY_KEY_MAP: Record<string, string> = {
  person: "person_id",
  place: "place_id",
  cat: "cat_id",
};

const MAX_CHARS = 100;

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

function getNoteLevel(tags: string[] | undefined): NoteLevel {
  if (tags?.includes("warning")) return "warning";
  if (tags?.includes("heads_up")) return "heads_up";
  return "info";
}

export default function QuickNotes({
  entityType,
  entityId,
  entries,
  onNoteAdded,
}: QuickNotesProps) {
  const { user, isLoading: authLoading } = useCurrentUser();
  const [isOpen, setIsOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [level, setLevel] = useState<NoteLevel>("info");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter to quick_note tagged entries only
  const notes = entries
    .filter((e) => e.tags?.includes("quick_note") && !e.is_archived)
    .sort((a, b) => {
      // Warnings first, then heads-up, then info
      const levelOrder = { warning: 0, heads_up: 1, info: 2 };
      const aLevel = getNoteLevel(a.tags);
      const bLevel = getNoteLevel(b.tags);
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      if (levelOrder[aLevel] !== levelOrder[bLevel]) return levelOrder[aLevel] - levelOrder[bLevel];
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
      const payload: Record<string, unknown> = {
        body: newNote.trim().slice(0, MAX_CHARS),
        entry_kind: "note",
        tags: ["quick_note", level],
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
        setLevel("info");
        setIsOpen(false);
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
    if (e.key === "Escape") {
      setIsOpen(false);
      setNewNote("");
      setError(null);
    }
  };

  return (
    <div
      className="card"
      style={{
        padding: "1rem 1.25rem",
        marginBottom: "1.5rem",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: notes.length > 0 || isOpen ? "0.75rem" : 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>Staff Notes</div>
        <div style={{ fontSize: "0.7rem", color: "var(--muted, #6c757d)", marginTop: "0.125rem" }}>
          High-level context only — detailed notes &amp; contact logs go in the Journal below
        </div>
      </div>

      {/* Add button (collapsed state) */}
      {!isOpen && user?.staff_id && (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            padding: "0.375rem 0.75rem",
            fontSize: "0.8rem",
            fontWeight: 500,
            border: "1px dashed var(--border, #dee2e6)",
            borderRadius: "6px",
            background: "transparent",
            color: "#0d6efd",
            cursor: "pointer",
            marginBottom: notes.length > 0 ? "0.75rem" : 0,
          }}
        >
          + Add Quick Note
        </button>
      )}

      {/* Expanded input */}
      {isOpen && user?.staff_id && (
        <div style={{ marginBottom: notes.length > 0 ? "0.75rem" : 0 }}>
          {/* Level picker */}
          <div style={{ display: "flex", gap: 0, marginBottom: "0.5rem" }}>
            {(Object.keys(LEVEL_STYLES) as NoteLevel[]).map((lvl) => {
              const style = LEVEL_STYLES[lvl];
              const isActive = level === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setLevel(lvl)}
                  style={{
                    padding: "0.3rem 0.625rem",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    border: `1px solid ${style.border}`,
                    borderLeft: lvl === "info" ? `1px solid ${style.border}` : "none",
                    borderRadius: lvl === "info" ? "4px 0 0 4px" : lvl === "warning" ? "0 4px 4px 0" : "0",
                    background: isActive ? style.btnBg : "transparent",
                    color: isActive ? "#fff" : style.border,
                    cursor: "pointer",
                  }}
                >
                  {style.label}
                </button>
              );
            })}
          </div>

          {/* Input row */}
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={handleKeyDown}
                placeholder="Short context note..."
                maxLength={MAX_CHARS}
                autoFocus
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  paddingRight: "3.5rem",
                  fontSize: "0.85rem",
                  borderRadius: "6px",
                  border: `1px solid ${LEVEL_STYLES[level].border}`,
                  background: "var(--card-bg, #fff)",
                  color: "var(--foreground)",
                  boxSizing: "border-box",
                }}
                disabled={submitting}
              />
              <span
                style={{
                  position: "absolute",
                  right: "0.5rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "0.65rem",
                  color: newNote.length >= MAX_CHARS ? "#dc3545" : "var(--muted, #6c757d)",
                }}
              >
                {newNote.length}/{MAX_CHARS}
              </span>
            </div>
            <button
              onClick={handleSubmit}
              disabled={submitting || !newNote.trim()}
              style={{
                padding: "0.5rem 0.75rem",
                fontSize: "0.8rem",
                fontWeight: 500,
                border: "none",
                borderRadius: "6px",
                background: newNote.trim() && !submitting ? LEVEL_STYLES[level].btnBg : "#94a3b8",
                color: "#fff",
                cursor: newNote.trim() && !submitting ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              {submitting ? "..." : "Add"}
            </button>
            <button
              onClick={() => { setIsOpen(false); setNewNote(""); setError(null); }}
              style={{
                padding: "0.5rem 0.5rem",
                fontSize: "0.8rem",
                border: "1px solid var(--border, #dee2e6)",
                borderRadius: "6px",
                background: "transparent",
                color: "var(--muted, #6c757d)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>

          {/* Attribution + error */}
          <div style={{ fontSize: "0.7rem", color: "var(--muted, #6c757d)", marginTop: "0.25rem" }}>
            Posting as {user.display_name}
          </div>
          {error && (
            <div style={{ fontSize: "0.75rem", color: "#dc3545", marginTop: "0.25rem" }}>
              {error}
            </div>
          )}
        </div>
      )}

      {authLoading && !user && (
        <div style={{ fontSize: "0.8rem", color: "var(--muted, #6c757d)", marginBottom: "0.5rem" }}>
          Loading...
        </div>
      )}

      {/* Notes list */}
      {notes.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {notes.map((note) => {
            const displayName = note.created_by_staff_name || note.created_by;
            const initials = getInitials(displayName);
            const dateStr = formatDate(note.occurred_at || note.created_at);
            const noteLevel = getNoteLevel(note.tags);
            const style = LEVEL_STYLES[noteLevel];

            return (
              <div
                key={note.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.4rem 0.5rem",
                  background: style.bg,
                  borderLeft: `3px solid ${style.border}`,
                  borderRadius: "4px",
                  minWidth: 0,
                }}
              >
                {/* Initials badge */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    background: style.border,
                    color: "#fff",
                    fontSize: "0.6rem",
                    fontWeight: "bold",
                    flexShrink: 0,
                  }}
                  title={displayName || "Unknown"}
                >
                  {initials}
                </span>

                {/* Note body */}
                <span
                  style={{
                    flex: 1,
                    fontSize: "0.8rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    color: "var(--foreground)",
                    fontWeight: noteLevel === "warning" ? 600 : 400,
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
        !authLoading && !isOpen && (
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--muted, #6c757d)",
              padding: "0.25rem 0",
            }}
          >
            No quick notes yet.
          </div>
        )
      )}
    </div>
  );
}
