"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { formatPhone, formatPhoneAsYouType } from "@/lib/formatters";
import {
  PersonReferencePicker,
  type PersonReference,
} from "@/components/ui/PersonReferencePicker";
import { usePersonSuggestion } from "@/hooks/usePersonSuggestion";
import { PersonSuggestionBanner } from "@/components/ui/PersonSuggestionBanner";

// --- Types ---

export interface PersonSectionValue {
  person_id: string | null;
  display_name: string;
  is_resolved: boolean;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

export interface PersonSectionProps {
  role: "requestor" | "property_owner" | "site_contact" | "caretaker";
  label?: string;
  value: PersonSectionValue;
  onChange: (data: PersonSectionValue) => void;
  allowCreate?: boolean;
  showSameAsRequestor?: boolean;
  sameAsRequestor?: boolean;
  onSameAsRequestorChange?: (v: boolean) => void;
  required?: boolean;
  compact?: boolean;
  /** Always show first/last/phone/email fields, even before search resolves */
  alwaysShowFields?: boolean;
  onAddressSelected?: (address: {
    place_id: string;
    formatted_address: string;
  }) => void;
}

// --- Constants ---

const ROLE_LABELS: Record<PersonSectionProps["role"], string> = {
  requestor: "Requester",
  property_owner: "Property Owner",
  site_contact: "Site Contact",
  caretaker: "Caretaker",
};

const EMPTY_VALUE: PersonSectionValue = {
  person_id: null,
  display_name: "",
  is_resolved: false,
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
};

// --- Helpers ---

interface PersonDetailIdentifier {
  id_type: string;
  id_value: string;
  confidence: number;
}

interface PersonDetailResponse {
  person_id: string;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  identifiers?: PersonDetailIdentifier[] | null;
}

interface PersonAddress {
  place_id: string;
  formatted_address: string | null;
  display_name: string | null;
  role: string;
}

function parseName(displayName: string): {
  first_name: string;
  last_name: string;
} {
  const parts = displayName.trim().split(/\s+/);
  return {
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" ") || "",
  };
}

// --- Component ---

export function PersonSection({
  role,
  label,
  value,
  onChange,
  allowCreate = true,
  showSameAsRequestor = false,
  sameAsRequestor = false,
  onSameAsRequestorChange,
  required = false,
  compact = false,
  alwaysShowFields = false,
  onAddressSelected,
}: PersonSectionProps) {
  const sectionLabel = label || ROLE_LABELS[role];

  // Internal state
  const [editingContactInfo, setEditingContactInfo] = useState(false);
  const [originalContactInfo, setOriginalContactInfo] = useState<{
    phone: string;
    email: string;
  } | null>(null);
  const [addresses, setAddresses] = useState<PersonAddress[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Dedup suggestion — only active when person is NOT resolved
  const personSuggestion = usePersonSuggestion({
    email: value.email,
    phone: value.phone,
    enabled: !value.is_resolved,
  });

  // Fetch person details + addresses when resolved
  const fetchPersonDetails = useCallback(
    async (personId: string) => {
      setLoadingDetails(true);
      try {
        const [person, addressData] = await Promise.all([
          fetchApi<PersonDetailResponse>(`/api/people/${personId}`),
          fetchApi<{ addresses: PersonAddress[] }>(
            `/api/people/${personId}/addresses`
          ).catch(() => ({ addresses: [] })),
        ]);

        const emailId = person.identifiers?.find(
          (id) => id.id_type === "email" && id.confidence >= 0.5
        );
        const phoneId = person.identifiers?.find(
          (id) => id.id_type === "phone" && id.confidence >= 0.5
        );

        const email = emailId?.id_value || "";
        const phone = phoneId?.id_value || "";
        const nameParts = parseName(person.display_name || "");

        const newValue: PersonSectionValue = {
          person_id: personId,
          display_name: person.display_name || "",
          is_resolved: true,
          first_name: person.first_name || nameParts.first_name,
          last_name: person.last_name || nameParts.last_name,
          email,
          phone,
        };

        setOriginalContactInfo({ phone, email });
        setAddresses(
          addressData.addresses.filter((a) => a.formatted_address)
        );
        setEditingContactInfo(false);
        onChange(newValue);
      } catch (err) {
        console.error("Failed to fetch person details:", err);
      } finally {
        setLoadingDetails(false);
      }
    },
    [onChange]
  );

  // Handle PersonReferencePicker changes
  const handlePickerChange = useCallback(
    (ref: PersonReference) => {
      if (ref.is_resolved && ref.person_id) {
        // Person selected from search — fetch full details
        fetchPersonDetails(ref.person_id);
      } else if (ref.display_name && !ref.is_resolved) {
        // Free text entry — parse name parts
        const nameParts = parseName(ref.display_name);
        onChange({
          ...value,
          person_id: null,
          display_name: ref.display_name,
          is_resolved: false,
          first_name: nameParts.first_name,
          last_name: nameParts.last_name,
        });
      } else {
        // Cleared
        onChange({ ...EMPTY_VALUE });
        setAddresses([]);
        setOriginalContactInfo(null);
        setEditingContactInfo(false);
        personSuggestion.reset();
      }
    },
    [fetchPersonDetails, onChange, value, personSuggestion]
  );

  // Handle suggestion banner selection
  const handleSuggestionSelect = useCallback(
    (person: { person_id: string; display_name: string }) => {
      fetchPersonDetails(person.person_id);
      personSuggestion.selectPerson(person as Parameters<typeof personSuggestion.selectPerson>[0]);
    },
    [fetchPersonDetails, personSuggestion]
  );

  // Handle contact field changes
  const handleFieldChange = useCallback(
    (field: keyof PersonSectionValue, fieldValue: string) => {
      const updated = { ...value, [field]: fieldValue };

      // Update display_name from first+last when not resolved
      if (
        !value.is_resolved &&
        (field === "first_name" || field === "last_name")
      ) {
        const first =
          field === "first_name" ? fieldValue : value.first_name;
        const last = field === "last_name" ? fieldValue : value.last_name;
        updated.display_name = [first, last].filter(Boolean).join(" ");
      }

      onChange(updated);
    },
    [value, onChange]
  );

  // Cancel edit — restore original contact info
  const handleCancelEdit = useCallback(() => {
    if (originalContactInfo) {
      onChange({
        ...value,
        phone: originalContactInfo.phone,
        email: originalContactInfo.email,
      });
    }
    setEditingContactInfo(false);
  }, [originalContactInfo, value, onChange]);

  // Clear resolved person and addresses when sameAsRequestor toggles off->on
  useEffect(() => {
    if (sameAsRequestor) {
      setAddresses([]);
      setEditingContactInfo(false);
    }
  }, [sameAsRequestor]);

  // --- Styles ---

  const sectionStyle: React.CSSProperties = compact
    ? { marginBottom: "12px" }
    : {
        marginBottom: "20px",
        padding: "16px",
        border: "1px solid var(--card-border, #e5e7eb)",
        borderRadius: "10px",
        background: "var(--card-bg, #fff)",
      };

  const headerStyle: React.CSSProperties = {
    fontSize: compact ? "0.85rem" : "0.95rem",
    fontWeight: 600,
    marginBottom: compact ? "8px" : "12px",
    ...(compact
      ? {}
      : {
          paddingBottom: "8px",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
        }),
  };

  const fieldRowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: compact ? "8px" : "12px",
    marginTop: compact ? "8px" : "12px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: compact ? "6px 10px" : "10px 12px",
    border: "1px solid var(--card-border, #e5e7eb)",
    borderRadius: "8px",
    fontSize: compact ? "0.85rem" : "0.9rem",
    background: "var(--background, #fff)",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 500,
    marginBottom: "4px",
    color: "var(--text-muted, #6b7280)",
  };

  // --- Render ---

  // Same as requestor checkbox
  const showSameCheckbox =
    showSameAsRequestor && role !== "requestor" && onSameAsRequestorChange;

  // Derive picker value from PersonSectionValue
  const pickerValue: PersonReference = {
    person_id: value.person_id,
    display_name: value.display_name,
    is_resolved: value.is_resolved,
  };

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>
        {sectionLabel}
        {required && (
          <span style={{ color: "#dc3545", marginLeft: "2px" }}>*</span>
        )}
      </div>

      {/* Same as requestor checkbox */}
      {showSameCheckbox && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "0.85rem",
            marginBottom: sameAsRequestor ? "0" : "12px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={sameAsRequestor}
            onChange={(e) => onSameAsRequestorChange!(e.target.checked)}
          />
          Same as requester
        </label>
      )}

      {/* Collapsed when same-as-requestor is checked */}
      {sameAsRequestor ? null : (
        <>
          {/* Person search/select picker */}
          <PersonReferencePicker
            value={pickerValue}
            onChange={handlePickerChange}
            placeholder={`Search for ${sectionLabel.toLowerCase()}...`}
            allowCreate={allowCreate}
          />

          {loadingDetails && (
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--text-muted, #6b7280)",
                marginTop: "6px",
              }}
            >
              Loading person details...
            </div>
          )}

          {/* Resolved person: read-only contact display with edit option */}
          {value.is_resolved && !loadingDetails && (
            <div style={{ marginTop: "12px" }}>
              {/* Contact info display */}
              {!editingContactInfo ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "0.85rem",
                    color: "var(--text-muted, #6b7280)",
                  }}
                >
                  {value.phone && (
                    <span>{formatPhone(value.phone)}</span>
                  )}
                  {value.email && <span>{value.email}</span>}
                  {!value.phone && !value.email && (
                    <span style={{ fontStyle: "italic" }}>
                      No contact info on file
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingContactInfo(true)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#2563eb",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      padding: 0,
                      textDecoration: "underline",
                    }}
                  >
                    Update Contact Info
                  </button>
                </div>
              ) : (
                /* Editing resolved person contact fields */
                <div>
                  <div style={fieldRowStyle}>
                    <div>
                      <label style={labelStyle}>Phone</label>
                      <input
                        type="tel"
                        value={value.phone}
                        onChange={(e) =>
                          handleFieldChange(
                            "phone",
                            formatPhoneAsYouType(e.target.value)
                          )
                        }
                        placeholder="(707) 555-1234"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Email</label>
                      <input
                        type="email"
                        value={value.email}
                        onChange={(e) =>
                          handleFieldChange("email", e.target.value)
                        }
                        placeholder="email@example.com"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginTop: "8px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setEditingContactInfo(false)}
                      style={{
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
                      Done
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      style={{
                        padding: "4px 12px",
                        background: "transparent",
                        color: "var(--text-muted, #6b7280)",
                        border: "1px solid var(--border, #e5e7eb)",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Known addresses */}
              {addresses.length > 0 && onAddressSelected && (
                <div style={{ marginTop: "10px" }}>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      color: "var(--text-muted, #6b7280)",
                      marginBottom: "4px",
                    }}
                  >
                    Known addresses
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px",
                    }}
                  >
                    {addresses.map((addr) => (
                      <button
                        key={addr.place_id}
                        type="button"
                        onClick={() =>
                          onAddressSelected({
                            place_id: addr.place_id,
                            formatted_address:
                              addr.formatted_address || "",
                          })
                        }
                        style={{
                          padding: "4px 10px",
                          background: "var(--section-bg, #f9fafb)",
                          border: "1px solid var(--card-border, #e5e7eb)",
                          borderRadius: "16px",
                          fontSize: "0.8rem",
                          cursor: "pointer",
                          color: "var(--text-secondary)",
                          whiteSpace: "nowrap",
                        }}
                        title={`Use: ${addr.formatted_address}`}
                      >
                        {addr.formatted_address}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Contact fields when NOT resolved — manual entry mode */}
          {!value.is_resolved && (alwaysShowFields || value.display_name) && !loadingDetails && (
            <div style={{ marginTop: "12px" }}>
              {alwaysShowFields && !value.display_name && (
                <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #9ca3af)", marginBottom: "8px", fontStyle: "italic" }}>
                  Or enter contact details directly:
                </p>
              )}
              <div style={fieldRowStyle}>
                <div>
                  <label style={labelStyle}>First Name</label>
                  <input
                    type="text"
                    value={value.first_name}
                    onChange={(e) =>
                      handleFieldChange("first_name", e.target.value)
                    }
                    placeholder="First name"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Last Name</label>
                  <input
                    type="text"
                    value={value.last_name}
                    onChange={(e) =>
                      handleFieldChange("last_name", e.target.value)
                    }
                    placeholder="Last name"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={fieldRowStyle}>
                <div>
                  <label style={labelStyle}>Phone {alwaysShowFields && <span style={{ color: "var(--danger-text, #dc2626)" }}>*</span>}</label>
                  <input
                    type="tel"
                    value={value.phone}
                    onChange={(e) =>
                      handleFieldChange(
                        "phone",
                        formatPhoneAsYouType(e.target.value)
                      )
                    }
                    placeholder="(707) 555-1234"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input
                    type="email"
                    value={value.email}
                    onChange={(e) =>
                      handleFieldChange("email", e.target.value)
                    }
                    placeholder="email@example.com"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Dedup suggestion banner */}
              <div style={{ marginTop: "10px" }}>
                <PersonSuggestionBanner
                  suggestions={personSuggestion.suggestions}
                  loading={personSuggestion.loading}
                  dismissed={personSuggestion.dismissed}
                  onDismiss={personSuggestion.dismiss}
                  onSelect={handleSuggestionSelect}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
