"use client";

import { useCallback } from "react";
import { PersonReferencePicker } from "@/components/ui/PersonReferencePicker";
import type { PersonReference } from "@/components/ui/PersonReferencePicker";
import { RELATED_PERSON_RELATIONSHIP_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/form-options";
import { Icon } from "@/components/ui/Icon";
import { SPACING } from "@/lib/design-tokens";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RelatedPersonEntry {
  _key: string;
  person_id: string | null;
  display_name: string;
  is_resolved: boolean;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship_type: string;
  relationship_notes: string;
  notify_before_release: boolean;
  preferred_language: string;
}

export interface OtherPartiesSectionValue {
  entries: RelatedPersonEntry[];
}

export interface OtherPartiesSectionProps {
  value: OtherPartiesSectionValue;
  onChange: (v: OtherPartiesSectionValue) => void;
  compact?: boolean;
  maxEntries?: number;
}

export const EMPTY_OTHER_PARTIES: OtherPartiesSectionValue = { entries: [] };

// ─── Helpers ────────────────────────────────────────────────────────────────

let _keyCounter = 0;
function nextKey(): string {
  return `rp_${++_keyCounter}_${Date.now()}`;
}

function emptyEntry(): RelatedPersonEntry {
  return {
    _key: nextKey(),
    person_id: null,
    display_name: "",
    is_resolved: false,
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    relationship_type: "",
    relationship_notes: "",
    notify_before_release: false,
    preferred_language: "",
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function OtherPartiesSection({
  value,
  onChange,
  compact = false,
  maxEntries = 5,
}: OtherPartiesSectionProps) {
  const { entries } = value;

  const updateEntry = useCallback(
    (key: string, patch: Partial<RelatedPersonEntry>) => {
      onChange({
        entries: entries.map((e) =>
          e._key === key ? { ...e, ...patch } : e
        ),
      });
    },
    [entries, onChange]
  );

  const removeEntry = useCallback(
    (key: string) => {
      onChange({ entries: entries.filter((e) => e._key !== key) });
    },
    [entries, onChange]
  );

  const addEntry = useCallback(() => {
    if (entries.length >= maxEntries) return;
    onChange({ entries: [...entries, emptyEntry()] });
  }, [entries, maxEntries, onChange]);

  const handlePersonChange = useCallback(
    (key: string, ref: PersonReference) => {
      updateEntry(key, {
        person_id: ref.person_id,
        display_name: ref.display_name,
        is_resolved: ref.is_resolved,
      });
    },
    [updateEntry]
  );

  return (
    <div>
      {/* Section header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: entries.length > 0 ? SPACING.md : SPACING.sm,
        }}
      >
        <Icon name="users" size={compact ? 16 : 18} color="var(--text-muted)" />
        <span style={{ fontWeight: 600, fontSize: compact ? "0.85rem" : "0.95rem" }}>
          Other People Involved
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          ({entries.length}/{maxEntries})
        </span>
      </div>

      {/* Entries */}
      <div style={{ display: "flex", flexDirection: "column", gap: SPACING.md }}>
        {entries.map((entry) => (
          <EntryCard
            key={entry._key}
            entry={entry}
            compact={compact}
            onPersonChange={(ref) => handlePersonChange(entry._key, ref)}
            onUpdate={(patch) => updateEntry(entry._key, patch)}
            onRemove={() => removeEntry(entry._key)}
          />
        ))}
      </div>

      {/* Add button */}
      {entries.length < maxEntries && (
        <button
          type="button"
          onClick={addEntry}
          style={{
            marginTop: entries.length > 0 ? SPACING.sm : 0,
            padding: "6px 14px",
            fontSize: "0.8rem",
            fontWeight: 500,
            color: "var(--primary)",
            background: "transparent",
            border: "1px dashed var(--primary)",
            borderRadius: "6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Icon name="plus" size={14} />
          Add Related Person
        </button>
      )}
    </div>
  );
}

// ─── Entry Card ─────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  compact,
  onPersonChange,
  onUpdate,
  onRemove,
}: {
  entry: RelatedPersonEntry;
  compact: boolean;
  onPersonChange: (ref: PersonReference) => void;
  onUpdate: (patch: Partial<RelatedPersonEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--card-border, #e5e7eb)",
        borderRadius: "8px",
        padding: compact ? "10px 12px" : "12px 16px",
        background: "var(--card-bg, #fff)",
        position: "relative",
      }}
    >
      {/* Remove button (top right) */}
      <button
        type="button"
        onClick={onRemove}
        title="Remove person"
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          padding: "2px 6px",
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: "0.85rem",
          lineHeight: 1,
          borderRadius: "4px",
        }}
        onMouseOver={(e) => { e.currentTarget.style.color = "var(--danger, #dc2626)"; e.currentTarget.style.background = "var(--danger-bg, #fef2f2)"; }}
        onMouseOut={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
      >
        <Icon name="trash-2" size={14} />
      </button>

      {/* Row 1: Person picker + relationship type */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 180px",
          gap: "10px",
          alignItems: "start",
          paddingRight: "32px",
        }}
      >
        <div>
          <PersonReferencePicker
            value={{
              person_id: entry.person_id,
              display_name: entry.display_name,
              is_resolved: entry.is_resolved,
            }}
            onChange={onPersonChange}
            placeholder="Search or create person..."
            allowCreate
          />
        </div>
        <div>
          <select
            value={entry.relationship_type}
            onChange={(e) => onUpdate({ relationship_type: e.target.value })}
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: "0.85rem",
              border: "1px solid var(--card-border, #e5e7eb)",
              borderRadius: "6px",
              background: "var(--bg-primary, #fff)",
              color: entry.relationship_type ? "var(--foreground)" : "var(--text-muted)",
            }}
          >
            <option value="">Relationship...</option>
            {RELATED_PERSON_RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Language + notify + notes */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          marginTop: "8px",
          flexWrap: "wrap",
        }}
      >
        <select
          value={entry.preferred_language}
          onChange={(e) => onUpdate({ preferred_language: e.target.value })}
          style={{
            padding: "4px 8px",
            fontSize: "0.8rem",
            border: "1px solid var(--card-border, #e5e7eb)",
            borderRadius: "5px",
            background: "var(--bg-primary, #fff)",
            color: entry.preferred_language ? "var(--foreground)" : "var(--text-muted)",
            width: "120px",
          }}
        >
          <option value="">Language...</option>
          {LANGUAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <input
            type="checkbox"
            checked={entry.notify_before_release}
            onChange={(e) =>
              onUpdate({ notify_before_release: e.target.checked })
            }
          />
          Notify before release
        </label>

        <input
          type="text"
          value={entry.relationship_notes}
          onChange={(e) => onUpdate({ relationship_notes: e.target.value })}
          placeholder="Notes..."
          style={{
            flex: 1,
            minWidth: "120px",
            padding: "4px 8px",
            fontSize: "0.8rem",
            border: "1px solid var(--card-border, #e5e7eb)",
            borderRadius: "5px",
          }}
        />
      </div>
    </div>
  );
}
