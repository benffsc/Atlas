import { formatPhone, formatPhoneAsYouType } from "@/lib/formatters";
import { PersonSuggestionBanner } from "@/components/ui/PersonSuggestionBanner";
import {
  THIRD_PARTY_RELATIONSHIP_OPTIONS,
  REQUESTER_RELATIONSHIP_OPTIONS,
  toSelectOptions,
} from "@/lib/form-options";
import type { ContactStepProps } from "./types";

const THIRD_PARTY_SELECT = toSelectOptions(THIRD_PARTY_RELATIONSHIP_OPTIONS);
const REQUESTER_SELECT = toSelectOptions(REQUESTER_RELATIONSHIP_OPTIONS);

export default function ContactStep({
  formData,
  updateField,
  errors,
  handleContactFieldChange,
  selectedPersonId,
  setSelectedPersonId,
  showPersonDropdown,
  personSuggestions,
  personDropdownRef,
  selectPerson,
  identitySuggestions,
  identitySuggestionLoading,
  identitySuggestionDismissed,
  onDismissIdentitySuggestion,
  onSelectIdentitySuggestion,
}: ContactStepProps) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Caller Information</h2>

      {/* Third-party toggle */}
      <div style={{
        marginBottom: "1.5rem",
        padding: "1rem",
        background: formData.is_third_party_report ? "#fff3cd" : "#f8f9fa",
        border: `1px solid ${formData.is_third_party_report ? "#ffc107" : "var(--border)"}`,
        borderRadius: "8px",
      }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={formData.is_third_party_report}
            onChange={(e) => updateField("is_third_party_report", e.target.checked)}
          />
          <span>
            <strong>Third-party report</strong>
            <span style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)" }}>
              Caller is reporting about cats they've seen but don't care for
            </span>
          </span>
        </label>

        {formData.is_third_party_report && (
          <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #ffc107" }}>
            <div style={{ marginBottom: "1rem" }}>
              <label>Relationship</label>
              <select
                value={formData.third_party_relationship}
                onChange={(e) => updateField("third_party_relationship", e.target.value)}
              >
                <option value="">Select...</option>
                {THIRD_PARTY_SELECT.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}><strong>Property owner (if known):</strong></p>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <input
                type="text"
                value={formData.property_owner_name}
                onChange={(e) => updateField("property_owner_name", e.target.value)}
                placeholder="Owner's name"
              />
              <input
                type="tel"
                value={formData.property_owner_phone}
                onChange={(e) => updateField("property_owner_phone", formatPhoneAsYouType(e.target.value))}
                placeholder="Owner's phone"
              />
            </div>
          </div>
        )}
      </div>

      {/* Relationship to location (non-third-party only) */}
      {!formData.is_third_party_report && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
            Your relationship to the location
          </label>
          <select
            value={formData.requester_relationship}
            onChange={(e) => updateField("requester_relationship", e.target.value)}
            style={{ width: "100%", maxWidth: "300px" }}
          >
            {REQUESTER_SELECT.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Contact fields with person search */}
      <div style={{ position: "relative" }} ref={personDropdownRef}>
        {/* Existing person match indicator */}
        {selectedPersonId && (
          <div style={{
            background: "#d4edda",
            border: "1px solid #c3e6cb",
            borderRadius: "6px",
            padding: "0.5rem 0.75rem",
            marginBottom: "0.75rem",
            fontSize: "0.85rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span>Linked to existing person record</span>
            <button
              type="button"
              onClick={() => setSelectedPersonId(null)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem", color: "var(--muted)" }}
            >
              Clear
            </button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <label>First Name *</label>
            <input
              type="text"
              value={formData.first_name}
              onChange={(e) => handleContactFieldChange("first_name", e.target.value)}
              style={{ borderColor: errors.first_name ? "#dc3545" : undefined }}
              autoComplete="off"
            />
            {errors.first_name && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.first_name}</span>}
          </div>
          <div>
            <label>Last Name *</label>
            <input
              type="text"
              value={formData.last_name}
              onChange={(e) => handleContactFieldChange("last_name", e.target.value)}
              style={{ borderColor: errors.last_name ? "#dc3545" : undefined }}
              autoComplete="off"
            />
            {errors.last_name && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.last_name}</span>}
          </div>
        </div>

        {/* Person suggestions dropdown */}
        {showPersonDropdown && personSuggestions.length > 0 && (
          <div style={{
            position: "absolute",
            top: selectedPersonId ? "calc(100% - 1.5rem)" : "calc(100% - 2rem)",
            left: 0,
            right: 0,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 1000,
            maxHeight: "200px",
            overflowY: "auto",
          }}>
            <div style={{ padding: "0.5rem 0.75rem", background: "var(--section-bg)", borderBottom: "1px solid var(--border)", fontSize: "0.75rem", color: "var(--muted)" }}>
              Existing contacts found:
            </div>
            {personSuggestions.map((person) => (
              <div
                key={person.person_id}
                onClick={() => selectPerson(person)}
                style={{
                  padding: "0.75rem",
                  cursor: "pointer",
                  borderBottom: "1px solid #eee",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f7ff")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ fontWeight: 500 }}>{person.display_name}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  {person.emails && <span>{person.emails}</span>}
                  {person.emails && person.phones && <span> · </span>}
                  {person.phones && <span>{formatPhone(person.phones)}</span>}
                  {person.cat_count > 0 && <span style={{ marginLeft: "0.5rem", color: "#0d6efd" }}>({person.cat_count} cats)</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
        <div>
          <label>Email</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => handleContactFieldChange("email", e.target.value)}
            style={{ borderColor: errors.email ? "#dc3545" : undefined }}
            autoComplete="off"
          />
          {errors.email && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.email}</span>}
        </div>
        <div>
          <label>Phone</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => handleContactFieldChange("phone", e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem" }}>* Email or phone required</p>

      {/* Identity-based person suggestion (email/phone match) */}
      {identitySuggestions && onDismissIdentitySuggestion && onSelectIdentitySuggestion && (
        <div style={{ marginTop: "0.75rem" }}>
          <PersonSuggestionBanner
            suggestions={identitySuggestions}
            loading={identitySuggestionLoading ?? false}
            dismissed={identitySuggestionDismissed ?? false}
            onDismiss={onDismissIdentitySuggestion}
            onSelect={onSelectIdentitySuggestion}
          />
        </div>
      )}
    </div>
  );
}
