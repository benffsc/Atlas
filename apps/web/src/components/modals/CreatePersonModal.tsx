"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { formatPhoneAsYouType } from "@/lib/formatters";
import { shouldBePerson } from "@/lib/guards";
import { usePersonSuggestion } from "@/hooks/usePersonSuggestion";
import { PersonSuggestionBanner } from "@/components/ui/PersonSuggestionBanner";
import { PERSON_ENTITY_TYPE } from "@/lib/enums";

interface CreatePersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (personId: string, displayName: string) => void;
  initialName?: string;
}

interface CreatePersonResponse {
  person: {
    person_id: string;
    display_name: string;
    first_name: string | null;
    last_name: string | null;
    entity_type: string | null;
    is_verified: boolean;
  };
  resolution: {
    decision_type: string;
    is_new: boolean;
    is_match: boolean;
    confidence: number;
    reason: string;
  };
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  individual: "Individual",
  household: "Household",
  organization: "Organization",
  clinic: "Clinic",
  rescue: "Rescue",
};

export default function CreatePersonModal({
  isOpen,
  onClose,
  onCreated,
  initialName,
}: CreatePersonModalProps) {
  const [firstName, setFirstName] = useState(initialName || "");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [entityType, setEntityType] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatePersonResponse | null>(null);

  const { suggestions, loading: suggestLoading, dismissed, dismiss, selectPerson, selectedPerson } =
    usePersonSuggestion({ email, phone });

  if (!isOpen) return null;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneAsYouType(e.target.value));
  };

  const handleSubmit = async () => {
    setError(null);

    // Client-side gate
    const gate = shouldBePerson(firstName, lastName || null, email || null, phone || null);
    if (!gate.valid) {
      setError(gate.reason);
      return;
    }

    setSaving(true);
    try {
      const resp = await postApi<CreatePersonResponse>("/api/people", {
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        entity_type: entityType || null,
      });

      setResult(resp);

      // Brief delay to show result, then navigate
      setTimeout(() => {
        onCreated(resp.person.person_id, resp.person.display_name);
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create person");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectExisting = (person: { person_id: string; display_name: string }) => {
    onCreated(person.person_id, person.display_name);
  };

  const hasIdentifier = (email && email.includes("@")) || (phone && phone.replace(/\D/g, "").length >= 7);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          maxWidth: "480px",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.5rem",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>New Person</h2>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--text-muted, #6b7280)" }}>
            Create a new person record in Atlas
          </p>
        </div>

        {/* Content */}
        <div style={{ padding: "1.5rem" }}>
          {error && (
            <div
              style={{
                background: "rgba(220, 53, 69, 0.1)",
                border: "1px solid rgba(220, 53, 69, 0.3)",
                borderRadius: "8px",
                padding: "0.75rem 1rem",
                marginBottom: "1rem",
                color: "#dc3545",
                fontSize: "0.85rem",
              }}
            >
              {error}
            </div>
          )}

          {result && (
            <div
              style={{
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                borderRadius: "8px",
                padding: "0.75rem 1rem",
                marginBottom: "1rem",
                color: "#16a34a",
                fontSize: "0.85rem",
              }}
            >
              {result.resolution.is_new
                ? `Created "${result.person.display_name}"`
                : `Matched existing person "${result.person.display_name}" (${result.resolution.reason})`}
            </div>
          )}

          {/* Dedup banner */}
          {!result && (
            <PersonSuggestionBanner
              suggestions={suggestions}
              loading={suggestLoading}
              dismissed={dismissed}
              onDismiss={dismiss}
              onSelect={(person) => handleSelectExisting(person)}
            />
          )}

          <div style={{ display: "grid", gap: "1rem" }}>
            {/* Name row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>First Name *</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                  style={inputStyle}
                  autoFocus
                  disabled={!!result}
                />
              </div>
              <div>
                <label style={labelStyle}>Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Smith"
                  style={inputStyle}
                  disabled={!!result}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                style={inputStyle}
                disabled={!!result}
              />
            </div>

            {/* Phone */}
            <div>
              <label style={labelStyle}>Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={handlePhoneChange}
                placeholder="(707) 555-1234"
                style={inputStyle}
                disabled={!!result}
              />
            </div>

            {/* Identifier hint */}
            {!hasIdentifier && firstName.length > 0 && !result && (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#b45309" }}>
                Email or phone is required to create a person record.
              </p>
            )}

            {/* Entity type */}
            <div>
              <label style={labelStyle}>Entity Type</label>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                style={inputStyle}
                disabled={!!result}
              >
                <option value="">Default (Individual)</option>
                {PERSON_ENTITY_TYPE.map((t) => (
                  <option key={t} value={t}>
                    {ENTITY_TYPE_LABELS[t] || t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 1.5rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            {result ? "Close" : "Cancel"}
          </button>

          {!result && (
            <button
              onClick={handleSubmit}
              disabled={saving || !firstName.trim() || !hasIdentifier}
              style={{
                padding: "0.5rem 1.5rem",
                background: saving || !firstName.trim() || !hasIdentifier ? "#9ca3af" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: saving || !firstName.trim() || !hasIdentifier ? "not-allowed" : "pointer",
                fontWeight: 500,
              }}
            >
              {saving ? "Creating..." : "Create Person"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  fontWeight: 500,
  marginBottom: "4px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid var(--card-border, #e5e7eb)",
  borderRadius: "8px",
  fontSize: "0.9rem",
  background: "var(--background, #fff)",
};
