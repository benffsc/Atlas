"use client";

import { formatPhone } from "@/lib/formatters";
import type { PersonSuggestionResult } from "@/hooks/usePersonSuggestion";

interface PersonSuggestionBannerProps {
  suggestions: PersonSuggestionResult[];
  loading: boolean;
  dismissed: boolean;
  onDismiss: () => void;
  onSelect: (person: PersonSuggestionResult) => void;
}

export function PersonSuggestionBanner({
  suggestions,
  loading,
  dismissed,
  onDismiss,
  onSelect,
}: PersonSuggestionBannerProps) {
  if (loading || dismissed || suggestions.length === 0) return null;

  const person = suggestions[0];
  const matchInfo = person.match_type === "both"
    ? "email & phone"
    : person.match_type === "email"
      ? "email"
      : "phone";

  const contactDetail = person.match_type === "phone" && person.phone
    ? formatPhone(person.phone)
    : person.email || person.phone;

  const firstAddress = person.addresses?.[0]?.formatted_address;

  return (
    <div
      style={{
        padding: "10px 14px",
        background: "#eff6ff",
        border: "1px solid #93c5fd",
        borderRadius: "8px",
        marginBottom: "12px",
        fontSize: "0.85rem",
        color: "#1e40af",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: "2px" }}>
          Existing person found by {matchInfo}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 500 }}>{person.display_name}</span>
          {contactDetail && (
            <span style={{ color: "#3b82f6" }}>{contactDetail}</span>
          )}
          {person.cat_count > 0 && (
            <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>
              ({person.cat_count} cat{person.cat_count !== 1 ? "s" : ""})
            </span>
          )}
          {firstAddress && (
            <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>
              {firstAddress}
            </span>
          )}
          {suggestions.length > 1 && (
            <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>
              (+{suggestions.length - 1} more)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onSelect(person)}
          style={{
            marginTop: "6px",
            padding: "4px 12px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "0.8rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Use this person
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#93c5fd",
          fontSize: "1.1rem",
          lineHeight: 1,
          padding: "2px",
          flexShrink: 0,
        }}
        title="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
