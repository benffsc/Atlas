"use client";

import { useCallback } from "react";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/components/forms/PlaceResolver";
import { RELATED_PLACE_RELATIONSHIP_OPTIONS } from "@/lib/form-options";
import { Icon } from "@/components/ui/Icon";
import { SPACING } from "@/lib/design-tokens";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RelatedPlaceEntry {
  _key: string;
  place_id: string | null;
  display_name: string;
  formatted_address: string | null;
  relationship_type: string;
  relationship_notes: string;
  is_primary_trapping_site: boolean;
}

export interface RelatedPlacesSectionValue {
  entries: RelatedPlaceEntry[];
}

export interface RelatedPlacesSectionProps {
  value: RelatedPlacesSectionValue;
  onChange: (v: RelatedPlacesSectionValue) => void;
  compact?: boolean;
  maxEntries?: number;
}

export const EMPTY_RELATED_PLACES: RelatedPlacesSectionValue = { entries: [] };

// ─── Helpers ────────────────────────────────────────────────────────────────

let _keyCounter = 0;
function nextKey(): string {
  return `rpl_${++_keyCounter}_${Date.now()}`;
}

function emptyEntry(): RelatedPlaceEntry {
  return {
    _key: nextKey(),
    place_id: null,
    display_name: "",
    formatted_address: null,
    relationship_type: "",
    relationship_notes: "",
    is_primary_trapping_site: false,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RelatedPlacesSection({
  value,
  onChange,
  compact = false,
  maxEntries = 5,
}: RelatedPlacesSectionProps) {
  const { entries } = value;

  const updateEntry = useCallback(
    (key: string, patch: Partial<RelatedPlaceEntry>) => {
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

  const handlePlaceChange = useCallback(
    (key: string, place: ResolvedPlace | null) => {
      updateEntry(key, {
        place_id: place?.place_id || null,
        display_name: place?.display_name || "",
        formatted_address: place?.formatted_address || null,
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
        <Icon name="map-pin" size={compact ? 16 : 18} color="var(--text-muted)" />
        <span style={{ fontWeight: 600, fontSize: compact ? "0.85rem" : "0.95rem" }}>
          Related Locations
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
            onPlaceChange={(place) => handlePlaceChange(entry._key, place)}
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
          Add Related Location
        </button>
      )}
    </div>
  );
}

// ─── Entry Card ─────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  compact,
  onPlaceChange,
  onUpdate,
  onRemove,
}: {
  entry: RelatedPlaceEntry;
  compact: boolean;
  onPlaceChange: (place: ResolvedPlace | null) => void;
  onUpdate: (patch: Partial<RelatedPlaceEntry>) => void;
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
        title="Remove location"
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

      {/* Row 1: Place resolver + relationship type */}
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
          <PlaceResolver
            value={entry.place_id ? {
              place_id: entry.place_id,
              display_name: entry.display_name,
              formatted_address: entry.formatted_address,
              locality: null,
            } : null}
            onChange={onPlaceChange}
            placeholder="Search for an address..."
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
            {RELATED_PLACE_RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Primary checkbox + notes */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          marginTop: "8px",
          flexWrap: "wrap",
        }}
      >
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
            checked={entry.is_primary_trapping_site}
            onChange={(e) =>
              onUpdate({ is_primary_trapping_site: e.target.checked })
            }
          />
          Primary trapping site
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
