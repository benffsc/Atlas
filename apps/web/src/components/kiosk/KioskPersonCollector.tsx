"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { formatPhoneAsYouType, isValidPhone } from "@/lib/formatters";
import { useDebounce } from "@/hooks/useDebounce";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/feedback/Skeleton";
import { kioskLabelStyle, kioskInputStyle } from "./kiosk-styles";

export interface CollectedPerson {
  person_id: string | null;
  display_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  is_resolved: boolean;
  resolution_type: "resolved" | "created" | "unresolved";
  /** Auto-detected from person record — helps parent form auto-select checkout type */
  detected_role?: "trapper" | "foster" | null;
}

interface KioskPersonCollectorProps {
  value: CollectedPerson;
  onChange: (person: CollectedPerson) => void;
}

interface PersonMatch {
  entity_id: string;
  display_name: string;
  subtitle: string;
}

/**
 * Kiosk-friendly person collection component.
 *
 * Unlike PersonReferencePicker which starts with search, this component
 * shows explicit first name / last name / phone / email fields from the
 * start. It runs background matching against existing people as the user
 * types (phone or email), and offers to link to an existing person when
 * a match is found.
 *
 * This eliminates the name-parsing problem entirely: staff explicitly
 * enters "Maria" in first name and "Del Carmen Lopez" in last name.
 *
 * Identity resolution:
 * - If a match is found and user accepts → links to existing person
 * - If no match → creates new person on form submit via POST /api/people
 * - Phone normalization ensures kiosk-created records auto-link to later
 *   ClinicHQ bookings with the same phone/email
 */
export function KioskPersonCollector({
  value,
  onChange,
}: KioskPersonCollectorProps) {
  const [matchResults, setMatchResults] = useState<PersonMatch[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchDismissed, setMatchDismissed] = useState(false);
  const abortRef = useRef<AbortController>();

  const update = useCallback(
    (field: keyof CollectedPerson, val: string) => {
      const next = { ...value, [field]: val };
      // If they're editing fields after linking, unlink
      if (value.is_resolved && field !== "email") {
        next.is_resolved = false;
        next.person_id = null;
        next.resolution_type = "unresolved";
      }
      next.display_name = [next.first_name, next.last_name].filter(Boolean).join(" ");
      onChange(next);
      setMatchDismissed(false);
    },
    [value, onChange],
  );

  // Background matching: search by name, phone, or email as user types
  const checkMatches = useCallback(
    async (firstName: string, lastName: string, phone: string, email: string) => {
      // Determine best search query — prefer identifier, fall back to name
      const phoneDigits = phone.replace(/\D/g, "");
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
      const q = email.includes("@")
        ? email
        : phoneDigits.length >= 7
          ? phoneDigits
          : fullName.length >= 3
            ? fullName
            : "";

      if (!q) {
        setMatchResults([]);
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setMatchLoading(true);
      try {
        const data = await fetchApi<{ results: PersonMatch[]; fuzzy_results?: PersonMatch[] }>(
          `/api/search?q=${encodeURIComponent(q)}&type=person&limit=4&fuzzy=true`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          // Combine exact + fuzzy, dedupe
          const combined: PersonMatch[] = [];
          const seen = new Set<string>();
          for (const r of [...(data.results || []), ...(data.fuzzy_results || [])]) {
            if (!seen.has(r.entity_id)) { combined.push(r); seen.add(r.entity_id); }
          }
          setMatchResults(combined);
        }
      } catch {
        // Ignore abort errors
      } finally {
        if (!controller.signal.aborted) setMatchLoading(false);
      }
    },
    [],
  );

  const debouncedCheck = useDebounce(checkMatches, 400);

  // Trigger matching when name, phone, or email changes
  useEffect(() => {
    if (!value.is_resolved) {
      debouncedCheck(value.first_name, value.last_name, value.phone, value.email);
    }
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [value.first_name, value.last_name, value.phone, value.email, value.is_resolved, debouncedCheck]);

  const handleSelectMatch = useCallback(
    async (match: PersonMatch) => {
      // Immediately show resolved state with display name
      const parts = match.display_name.split(" ");
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || "";

      onChange({
        ...value,
        person_id: match.entity_id,
        display_name: match.display_name,
        first_name: firstName,
        last_name: lastName,
        is_resolved: true,
        resolution_type: "resolved",
      });
      setMatchResults([]);

      // Fetch full person detail to fill phone/email and detect role
      try {
        const detail = await fetchApi<{
          person: {
            person_id: string;
            display_name: string;
            identifiers: Array<{ id_type: string; id_value_raw: string }> | null;
            trapper_type: string | null;
            primary_role: string | null;
          };
        }>(`/api/people/${match.entity_id}`);

        const person = detail.person;
        const ids = person.identifiers || [];
        const phoneId = ids.find((i) => i.id_type === "phone");
        const emailId = ids.find((i) => i.id_type === "email");

        // Detect role for auto-selecting checkout type
        const detectedRole: "trapper" | "foster" | null =
          person.trapper_type ? "trapper"
          : person.primary_role === "foster" ? "foster"
          : null;

        onChange({
          person_id: match.entity_id,
          display_name: match.display_name,
          first_name: firstName,
          last_name: lastName,
          phone: phoneId?.id_value_raw || "",
          email: emailId?.id_value_raw || "",
          is_resolved: true,
          resolution_type: "resolved",
          detected_role: detectedRole,
        });
      } catch {
        // Non-blocking — match is already linked, just won't auto-fill contact info
      }
    },
    [value, onChange],
  );

  const handleClearResolution = useCallback(() => {
    onChange({
      ...value,
      person_id: null,
      is_resolved: false,
      resolution_type: "unresolved",
    });
  }, [value, onChange]);


  // Show linked banner if resolved
  if (value.is_resolved && value.person_id) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.875rem 1rem",
            background: "var(--success-bg, rgba(34,197,94,0.08))",
            border: "2px solid var(--success-text, #16a34a)",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "var(--success-text, #16a34a)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="check" size={20} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-primary)" }}>
              {value.display_name}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Linked to existing record
            </div>
          </div>
          <button
            onClick={handleClearResolution}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.25rem",
              color: "var(--text-secondary)",
            }}
          >
            <Icon name="x" size={18} color="var(--text-secondary)" />
          </button>
        </div>
      </div>
    );
  }

  const showMatches = !matchDismissed && matchResults.length > 0 && !value.is_resolved;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {/* Name row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div>
          <label style={kioskLabelStyle}>First Name *</label>
          <input
            type="text"
            value={value.first_name}
            onChange={(e) => update("first_name", e.target.value)}
            placeholder="First name"
            autoComplete="given-name"
            style={kioskInputStyle}
          />
        </div>
        <div>
          <label style={kioskLabelStyle}>Last Name</label>
          <input
            type="text"
            value={value.last_name}
            onChange={(e) => update("last_name", e.target.value)}
            placeholder="Last name"
            autoComplete="family-name"
            style={kioskInputStyle}
          />
        </div>
      </div>

      {/* Phone */}
      <div>
        <label style={kioskLabelStyle}>Phone *</label>
        <input
          type="tel"
          inputMode="tel"
          value={value.phone}
          onChange={(e) => update("phone", formatPhoneAsYouType(e.target.value))}
          placeholder="(707) 555-1234"
          autoComplete="tel"
          style={kioskInputStyle}
        />
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
          Phone is the best way to auto-link with ClinicHQ records
        </div>
      </div>

      {/* Email */}
      <div>
        <label style={kioskLabelStyle}>Email (optional)</label>
        <input
          type="email"
          inputMode="email"
          value={value.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="email@example.com"
          autoComplete="email"
          style={kioskInputStyle}
        />
      </div>

      {/* Match banner */}
      {matchLoading && (
        <div style={{ padding: "0.5rem 0" }}>
          <Skeleton height={40} />
        </div>
      )}

      {showMatches && (
        <div
          style={{
            background: "var(--info-bg, #eff6ff)",
            border: "1px solid var(--info-border, #93c5fd)",
            borderRadius: 10,
            padding: "0.75rem",
          }}
        >
          <div
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--info-text, #1e40af)",
              marginBottom: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>Existing match found — is this the same person?</span>
            <button
              onClick={() => setMatchDismissed(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "0.75rem",
                color: "var(--info-text)",
                textDecoration: "underline",
              }}
            >
              No, create new
            </button>
          </div>
          {matchResults.map((match) => (
            <button
              key={match.entity_id}
              onClick={() => handleSelectMatch(match)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                width: "100%",
                padding: "0.5rem 0.75rem",
                background: "var(--card-bg, #fff)",
                border: "1px solid var(--card-border, #e5e7eb)",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                marginBottom: "0.375rem",
              }}
            >
              <Icon name="user" size={16} color="var(--primary)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{match.display_name}</div>
                {match.subtitle && (
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    {match.subtitle}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

    </div>
  );
}

/**
 * Helper: resolve a CollectedPerson to a person_id via the identity engine.
 * Call this before submitting the checkout — it creates the person if needed.
 *
 * Returns the person_id (existing or new) and resolution_type.
 */
export async function resolveCollectedPerson(
  person: CollectedPerson,
): Promise<{ person_id: string | null; resolution_type: "resolved" | "created" | "unresolved" }> {
  // Already resolved
  if (person.is_resolved && person.person_id) {
    return { person_id: person.person_id, resolution_type: "resolved" };
  }

  const phoneDigits = person.phone.replace(/\D/g, "");
  const hasPhone = isValidPhone(person.phone);
  const hasEmail = person.email.includes("@");

  // Can't create without identifier
  if (!hasPhone && !hasEmail) {
    return { person_id: null, resolution_type: "unresolved" };
  }

  try {
    const resp = await postApi<{
      person: { person_id: string; display_name: string };
      resolution: { is_new: boolean };
    }>("/api/people", {
      first_name: person.first_name.trim(),
      last_name: person.last_name.trim() || null,
      phone: hasPhone ? phoneDigits : null,
      email: hasEmail ? person.email.trim() : null,
    });

    return {
      person_id: resp.person.person_id,
      resolution_type: resp.resolution.is_new ? "created" : "resolved",
    };
  } catch {
    // If identity engine rejects (org name, blacklist, etc.), fall back to unresolved
    return { person_id: null, resolution_type: "unresolved" };
  }
}
