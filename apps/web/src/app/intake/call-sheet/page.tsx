"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import PlaceResolver from "@/components/PlaceResolver";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { BackButton } from "@/components/BackButton";
import { formatPhone, formatPhoneAsYouType } from "@/lib/formatters";

/**
 * Parse city and zip from a formatted address string.
 */
function parseAddressComponents(formattedAddress: string | null): { city: string; zip: string } {
  if (!formattedAddress) return { city: "", zip: "" };
  const parts = formattedAddress.split(",").map(p => p.trim());
  let city = "";
  let zip = "";
  const zipMatch = formattedAddress.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipMatch) zip = zipMatch[1];
  if (parts.length >= 3) {
    const stateZipPart = parts[parts.length - 2] || parts[parts.length - 1];
    if (/\b[A-Z]{2}\s+\d{5}\b/.test(stateZipPart)) {
      city = parts[parts.length - 3] || "";
    } else {
      city = parts[1] || "";
    }
  } else if (parts.length === 2) {
    city = parts[0] || "";
  }
  return { city, zip };
}
import {
  OWNERSHIP_OPTIONS,
  FIXED_STATUS_OPTIONS,
  FEEDING_FREQUENCY_OPTIONS,
  COLONY_DURATION_OPTIONS,
  AWARENESS_DURATION_OPTIONS,
  KITTEN_AGE_OPTIONS,
  HANDLEABILITY_OPTIONS,
  REFERRAL_SOURCE_OPTIONS,
  COUNT_CONFIDENCE_OPTIONS,
} from "@/lib/intake-options";

// ─── Form State ─────────────────────────────────────────────────
interface CallSheetForm {
  // Contact
  first_name: string;
  last_name: string;
  phone: string;
  email: string;

  // Third-party
  is_third_party_report: boolean;
  third_party_relationship: string;

  // Cat Location
  cats_address: string;
  cats_city: string;
  cats_zip: string;
  county: string;
  property_type: string;

  // About the Cats
  ownership_status: string;
  cat_count_estimate: number | "";
  count_confidence: string;
  eartip_count_observed: number | "";
  fixed_status: string;

  // Kittens
  has_kittens: boolean;
  kitten_count: number | "";
  kitten_age_estimate: string;

  // Medical / Emergency
  has_medical_concerns: boolean;
  medical_description: string;
  is_emergency: boolean;

  // Awareness & Referral
  awareness_duration: string;
  colony_duration: string;
  referral_source: string;

  // Property Access & Logistics (page 2)
  has_property_access: string; // "yes" | "need_permission" | "no"
  is_property_owner: string;   // "yes" | "renter" | "neighbor"
  dogs_on_site: string;        // "yes" | "no"
  trap_savvy: string;          // "yes" | "no" | "unknown"
  previous_tnr: string;        // "yes" | "no" | "partial"
  handleability: string;
  access_notes: string;

  // Feeding Schedule
  feeder_info: string;
  feeding_time: string;
  feeding_location: string;
  feeding_frequency: string;
  best_trapping_time: string;

  // Important Notes (checkboxes)
  important_notes: string[];

  // Descriptions
  cat_count_text: string;
  situation_description: string;

  // Staff Assessment
  priority_override: string;
  final_category: string;
  reviewed_by: string;
}

const initialForm: CallSheetForm = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  is_third_party_report: false,
  third_party_relationship: "",
  cats_address: "",
  cats_city: "",
  cats_zip: "",
  county: "sonoma",
  property_type: "",
  ownership_status: "",
  cat_count_estimate: "",
  count_confidence: "",
  eartip_count_observed: "",
  fixed_status: "",
  has_kittens: false,
  kitten_count: "",
  kitten_age_estimate: "",
  has_medical_concerns: false,
  medical_description: "",
  is_emergency: false,
  awareness_duration: "",
  colony_duration: "",
  referral_source: "",
  has_property_access: "",
  is_property_owner: "",
  dogs_on_site: "",
  trap_savvy: "",
  previous_tnr: "",
  handleability: "",
  access_notes: "",
  feeder_info: "",
  feeding_time: "",
  feeding_location: "",
  feeding_frequency: "",
  best_trapping_time: "",
  important_notes: [],
  cat_count_text: "",
  situation_description: "",
  priority_override: "normal",
  final_category: "",
  reviewed_by: "",
};

const IMPORTANT_NOTE_OPTIONS = [
  "withhold_food_24hr",
  "other_feeders",
  "cats_cross_property",
  "pregnant_cat",
  "injured_sick_priority",
  "caller_can_help_trap",
  "wildlife_concerns",
  "neighbor_issues",
  "urgent_time_sensitive",
];

const IMPORTANT_NOTE_LABELS: Record<string, string> = {
  withhold_food_24hr: "Withhold food 24hr before",
  other_feeders: "Other feeders in area",
  cats_cross_property: "Cats cross property lines",
  pregnant_cat: "Pregnant cat suspected",
  injured_sick_priority: "Injured/sick cat priority",
  caller_can_help_trap: "Caller can help trap",
  wildlife_concerns: "Wildlife concerns (raccoons etc.)",
  neighbor_issues: "Neighbor issues / complaints",
  urgent_time_sensitive: "Urgent / time-sensitive",
};

const COUNTY_OPTIONS = ["sonoma", "marin", "napa", "other"];
const PROPERTY_TYPE_OPTIONS = ["house", "apartment", "business", "rural", "other"];

// ─── Person Search ──────────────────────────────────────────────
interface PersonSuggestion {
  person_id: string;
  display_name: string;
  emails: string | null;
  phones: string | null;
  cat_count: number;
}

// ─── Styles ─────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  padding: "1.25rem",
  marginBottom: "1rem",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "15px",
  color: "#166534",
  borderBottom: "2px solid #86efac",
  paddingBottom: "6px",
  marginBottom: "12px",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontWeight: 600,
  fontSize: "13px",
  color: "#374151",
  marginBottom: "4px",
};

const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  fontSize: "14px",
  boxSizing: "border-box" as const,
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "12px",
};

const grid3: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: "12px",
};

const grid4: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr 1fr",
  gap: "12px",
};

const radioGroup: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  marginTop: "4px",
};

const radioLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "5px",
  cursor: "pointer",
  fontSize: "13px",
};

const pageCard: React.CSSProperties = {
  ...card,
  borderLeft: "4px solid #27ae60",
};

const pageHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "16px",
  paddingBottom: "8px",
  borderBottom: "1px solid #e5e7eb",
};

// ─── Component ──────────────────────────────────────────────────
export default function CallSheetEntryPage() {
  const router = useRouter();
  const [form, setForm] = useState<CallSheetForm>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Person search
  const [personSuggestions, setPersonSuggestions] = useState<PersonSuggestion[]>([]);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const personSearchTimeout = useRef<NodeJS.Timeout>();
  const personDropdownRef = useRef<HTMLDivElement>(null);

  // Place selection
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | null>(null);

  const updateForm = (updates: Partial<CallSheetForm>) => {
    setForm(prev => ({ ...prev, ...updates }));
  };

  // Person search
  const searchPeople = useCallback(async (query: string) => {
    if (query.length < 2) {
      setPersonSuggestions([]);
      setShowPersonDropdown(false);
      return;
    }
    try {
      const response = await fetch(`/api/people/search?q=${encodeURIComponent(query)}&limit=5`);
      if (response.ok) {
        const data = await response.json();
        setPersonSuggestions(data.people || []);
        setShowPersonDropdown(data.people?.length > 0);
      }
    } catch (err) {
      console.error("Person search error:", err);
    }
  }, []);

  const handleContactChange = (field: keyof CallSheetForm, value: string) => {
    // Auto-format phone as user types
    const processedValue = field === "phone" ? formatPhoneAsYouType(value) : value;
    updateForm({ [field]: processedValue });
    setSelectedPersonId(null);
    if (field === "first_name" || field === "last_name" || field === "email" || field === "phone") {
      if (personSearchTimeout.current) clearTimeout(personSearchTimeout.current);
      const searchQuery = field === "email" || field === "phone"
        ? processedValue
        : `${form.first_name} ${form.last_name}`.trim() || processedValue;
      personSearchTimeout.current = setTimeout(() => searchPeople(searchQuery), 300);
    }
  };

  const selectPerson = (person: PersonSuggestion) => {
    const parts = person.display_name.split(" ");
    setForm(prev => ({
      ...prev,
      first_name: parts[0] || "",
      last_name: parts.slice(1).join(" ") || "",
      email: person.emails?.split(", ")[0] || prev.email,
      phone: person.phones?.split(", ")[0] || prev.phone,
    }));
    setSelectedPersonId(person.person_id);
    setShowPersonDropdown(false);
    setPersonSuggestions([]);
  };

  const handlePlaceResolved = (place: ResolvedPlace | null) => {
    setResolvedPlace(place);
    setSelectedPlaceId(place?.place_id || null);
    if (place) {
      const { city, zip } = parseAddressComponents(place.formatted_address);
      updateForm({
        cats_address: place.formatted_address || place.display_name || "",
        cats_city: city,
        cats_zip: zip,
      });
    }
  };

  // Close person dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (personDropdownRef.current && !personDropdownRef.current.contains(e.target as Node)) {
        setShowPersonDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleNote = (note: string) => {
    setForm(prev => ({
      ...prev,
      important_notes: prev.important_notes.includes(note)
        ? prev.important_notes.filter(n => n !== note)
        : [...prev.important_notes, note],
    }));
  };

  // ─── Submit ─────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    // Validate
    if (!form.first_name || !form.last_name) {
      setError("First and last name are required");
      setSubmitting(false);
      return;
    }
    if (!form.email && !form.phone) {
      setError("Email or phone is required");
      setSubmitting(false);
      return;
    }
    if (!form.cats_address && !resolvedPlace) {
      setError("Cat location address is required");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "paper",
          source_system: "call_sheet",
          existing_person_id: selectedPersonId || null,
          selected_address_place_id: selectedPlaceId || null,
          // Contact
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone || null,
          email: form.email || null,
          // Third-party
          is_third_party_report: form.is_third_party_report,
          third_party_relationship: form.third_party_relationship || null,
          // Location
          cats_address: resolvedPlace?.formatted_address || form.cats_address,
          cats_city: form.cats_city || null,
          cats_zip: form.cats_zip || null,
          county: form.county || null,
          // Cats
          ownership_status: form.ownership_status || null,
          cat_count_estimate: form.cat_count_estimate || null,
          count_confidence: form.count_confidence || null,
          colony_duration: form.colony_duration || null,
          eartip_count_observed: form.eartip_count_observed || null,
          fixed_status: form.fixed_status || null,
          handleability: form.handleability || null,
          // Kittens
          has_kittens: form.has_kittens,
          kitten_count: form.has_kittens ? (form.kitten_count || null) : null,
          kitten_age_estimate: form.has_kittens ? (form.kitten_age_estimate || null) : null,
          // Medical / Emergency
          has_medical_concerns: form.has_medical_concerns,
          medical_description: form.medical_description || null,
          is_emergency: form.is_emergency,
          // Awareness
          awareness_duration: form.awareness_duration || null,
          referral_source: form.referral_source || null,
          // Feeding
          feeds_cat: form.feeder_info ? true : null,
          feeding_frequency: form.feeding_frequency || null,
          feeder_info: form.feeder_info || null,
          // Access
          has_property_access: form.has_property_access === "yes" ? true :
            form.has_property_access === "no" ? false : null,
          access_notes: form.access_notes || null,
          is_property_owner: form.is_property_owner === "yes" ? true :
            form.is_property_owner === "renter" || form.is_property_owner === "neighbor" ? false : null,
          // Descriptions
          cat_count_text: form.cat_count_text || null,
          situation_description: form.situation_description || null,
          // Staff
          priority_override: form.priority_override || null,
          reviewed_by: form.reviewed_by || null,
          // Trapping-specific fields → custom_fields JSONB
          custom_fields: {
            property_type: form.property_type || undefined,
            dogs_on_site: form.dogs_on_site || undefined,
            trap_savvy: form.trap_savvy || undefined,
            previous_tnr: form.previous_tnr || undefined,
            feeding_time: form.feeding_time || undefined,
            feeding_location: form.feeding_location || undefined,
            best_trapping_time: form.best_trapping_time || undefined,
            important_notes: form.important_notes.length > 0 ? form.important_notes : undefined,
            caller_is_owner: form.is_property_owner || undefined,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to submit");
      }

      const data = await response.json();
      setSuccess(`Call sheet submitted! Triage: ${data.triage_category}`);
      setTimeout(() => {
        router.push(`/intake/queue/${data.submission_id}`);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <BackButton fallbackHref="/intake/queue" />
        <h1 style={{ margin: "0.5rem 0 0 0" }}>Enter Call Sheet</h1>
        <p className="text-muted">Transcribe a completed paper call sheet into Atlas</p>
      </div>

      {error && (
        <div style={{ background: "#f8d7da", color: "#721c24", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#d1e7dd", color: "#0a5630", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit}>

        {/* ═══════════════════ PAGE 1: CONTACT & CATS ═══════════════════ */}
        <div style={pageCard}>
          <div style={pageHeader}>
            <span style={{ background: "#27ae60", color: "#fff", borderRadius: "4px", padding: "2px 8px", fontSize: "12px", fontWeight: 700 }}>Page 1</span>
            <span style={{ fontSize: "14px", color: "#6b7280" }}>Contact &amp; Cat Information (front of sheet)</span>
          </div>

          {/* Contact Information */}
          <div style={{ marginBottom: "16px" }}>
            <div style={sectionTitle}>Contact Information</div>
            <div style={grid2} ref={personDropdownRef}>
              <div style={{ position: "relative" }}>
                <label style={fieldLabel}>First Name *</label>
                <input
                  style={fieldInput}
                  value={form.first_name}
                  onChange={e => handleContactChange("first_name", e.target.value)}
                  placeholder="First name"
                />
                {selectedPersonId && (
                  <span style={{ position: "absolute", right: "10px", top: "30px", fontSize: "11px", color: "#16a34a", fontWeight: 600 }}>Linked</span>
                )}
                {showPersonDropdown && personSuggestions.length > 0 && (
                  <div style={{
                    position: "absolute", top: "100%", left: 0, right: 0,
                    background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 50, maxHeight: "200px", overflow: "auto",
                  }}>
                    {personSuggestions.map(p => (
                      <div
                        key={p.person_id}
                        onClick={() => selectPerson(p)}
                        style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f3f4f6", fontSize: "13px" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f0fdf4")}
                        onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
                      >
                        <strong>{p.display_name}</strong>
                        {p.phones && <span style={{ color: "#6b7280", marginLeft: "8px" }}>{formatPhone(p.phones)}</span>}
                        {p.emails && <span style={{ color: "#6b7280", marginLeft: "8px" }}>{p.emails}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label style={fieldLabel}>Last Name *</label>
                <input style={fieldInput} value={form.last_name} onChange={e => handleContactChange("last_name", e.target.value)} placeholder="Last name" />
              </div>
              <div>
                <label style={fieldLabel}>Phone *</label>
                <input style={fieldInput} type="tel" value={form.phone} onChange={e => handleContactChange("phone", e.target.value)} placeholder="(707) 555-1234" />
              </div>
              <div>
                <label style={fieldLabel}>Email</label>
                <input style={fieldInput} type="email" value={form.email} onChange={e => handleContactChange("email", e.target.value)} placeholder="email@example.com" />
              </div>
            </div>
            <div style={{ marginTop: "10px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px" }}>
                <input type="checkbox" checked={form.is_third_party_report} onChange={e => updateForm({ is_third_party_report: e.target.checked })} />
                Third-party report (calling on behalf of someone)
              </label>
              {form.is_third_party_report && (
                <div style={{ marginTop: "8px" }}>
                  <label style={fieldLabel}>Relationship to caller</label>
                  <input style={{ ...fieldInput, maxWidth: "300px" }} value={form.third_party_relationship} onChange={e => updateForm({ third_party_relationship: e.target.value })} placeholder="e.g., neighbor, volunteer" />
                </div>
              )}
            </div>
          </div>

          {/* Cat Location */}
          <div style={{ marginBottom: "16px" }}>
            <div style={sectionTitle}>Cat Location</div>
            <div style={{ marginBottom: "10px" }}>
              <label style={fieldLabel}>Address (where cats are) *</label>
              <PlaceResolver value={resolvedPlace} onChange={handlePlaceResolved} placeholder="Start typing address..." />
            </div>
            <div style={grid3}>
              <div>
                <label style={fieldLabel}>City</label>
                <input style={fieldInput} value={form.cats_city} onChange={e => updateForm({ cats_city: e.target.value })} placeholder="City" />
              </div>
              <div>
                <label style={fieldLabel}>ZIP</label>
                <input style={fieldInput} value={form.cats_zip} onChange={e => updateForm({ cats_zip: e.target.value })} placeholder="95472" maxLength={5} />
              </div>
              <div>
                <label style={fieldLabel}>County</label>
                <div style={radioGroup}>
                  {COUNTY_OPTIONS.map(c => (
                    <label key={c} style={radioLabel}>
                      <input type="radio" name="county" value={c} checked={form.county === c} onChange={() => updateForm({ county: c })} />
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginTop: "10px" }}>
              <label style={fieldLabel}>Property Type</label>
              <div style={radioGroup}>
                {PROPERTY_TYPE_OPTIONS.map(pt => (
                  <label key={pt} style={radioLabel}>
                    <input type="radio" name="property_type" value={pt} checked={form.property_type === pt} onChange={() => updateForm({ property_type: pt })} />
                    {pt.charAt(0).toUpperCase() + pt.slice(1)}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* About the Cats */}
          <div style={{ marginBottom: "16px" }}>
            <div style={sectionTitle}>About the Cats</div>
            <div style={grid2}>
              <div>
                <label style={fieldLabel}>Ownership / Relationship</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                  {OWNERSHIP_OPTIONS.map(opt => (
                    <label key={opt.value} style={radioLabel}>
                      <input type="radio" name="ownership" value={opt.value} checked={form.ownership_status === opt.value} onChange={() => updateForm({ ownership_status: opt.value })} />
                      {opt.shortLabel}
                    </label>
                  ))}
                </div>
                <div style={{ ...grid2, marginTop: "10px" }}>
                  <div>
                    <label style={fieldLabel}>Cat count</label>
                    <input style={fieldInput} type="number" min={0} value={form.cat_count_estimate} onChange={e => updateForm({ cat_count_estimate: e.target.value ? parseInt(e.target.value) : "" })} placeholder="#" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Eartipped</label>
                    <input style={fieldInput} type="number" min={0} value={form.eartip_count_observed} onChange={e => updateForm({ eartip_count_observed: e.target.value ? parseInt(e.target.value) : "" })} placeholder="#" />
                  </div>
                </div>
                <div style={{ marginTop: "8px" }}>
                  <label style={fieldLabel}>Count confidence</label>
                  <div style={radioGroup}>
                    {COUNT_CONFIDENCE_OPTIONS.map(opt => (
                      <label key={opt.value} style={radioLabel}>
                        <input type="radio" name="count_confidence" value={opt.value} checked={form.count_confidence === opt.value} onChange={() => updateForm({ count_confidence: opt.value })} />
                        {opt.value === "exact" ? "Exact" : opt.value === "good_estimate" ? "Good est." : opt.value === "rough_guess" ? "Rough guess" : "Unknown"}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: "8px" }}>
                  <label style={fieldLabel}>Fixed status</label>
                  <div style={radioGroup}>
                    {FIXED_STATUS_OPTIONS.map(opt => (
                      <label key={opt.value} style={radioLabel}>
                        <input type="radio" name="fixed_status" value={opt.value} checked={form.fixed_status === opt.value} onChange={() => updateForm({ fixed_status: opt.value })} />
                        {opt.shortLabel}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                  <input type="checkbox" checked={form.has_kittens} onChange={e => updateForm({ has_kittens: e.target.checked })} />
                  Kittens present?
                </label>
                {form.has_kittens && (
                  <div style={{ paddingLeft: "4px", marginBottom: "10px" }}>
                    <div style={{ ...grid2, marginBottom: "6px" }}>
                      <div>
                        <label style={fieldLabel}>How many?</label>
                        <input style={fieldInput} type="number" min={0} value={form.kitten_count} onChange={e => updateForm({ kitten_count: e.target.value ? parseInt(e.target.value) : "" })} placeholder="#" />
                      </div>
                    </div>
                    <label style={fieldLabel}>Kitten age</label>
                    <select style={fieldInput} value={form.kitten_age_estimate} onChange={e => updateForm({ kitten_age_estimate: e.target.value })}>
                      <option value="">Select...</option>
                      {KITTEN_AGE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                  <input type="checkbox" checked={form.has_medical_concerns} onChange={e => updateForm({ has_medical_concerns: e.target.checked })} />
                  Medical concerns?
                </label>
                {form.has_medical_concerns && (
                  <div style={{ marginBottom: "10px" }}>
                    <label style={fieldLabel}>Describe</label>
                    <textarea style={{ ...fieldInput, minHeight: "50px" }} value={form.medical_description} onChange={e => updateForm({ medical_description: e.target.value })} placeholder="What medical issues?" />
                  </div>
                )}

                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#dc2626" }}>
                  <input type="checkbox" checked={form.is_emergency} onChange={e => updateForm({ is_emergency: e.target.checked })} />
                  EMERGENCY (injured, immediate danger)
                </label>
              </div>
            </div>
          </div>

          {/* Awareness & Referral */}
          <div>
            <div style={sectionTitle}>Awareness &amp; Referral</div>
            <div style={grid3}>
              <div>
                <label style={fieldLabel}>How long aware?</label>
                <div style={radioGroup}>
                  {AWARENESS_DURATION_OPTIONS.map(opt => (
                    <label key={opt.value} style={radioLabel}>
                      <input type="radio" name="awareness" value={opt.value} checked={form.awareness_duration === opt.value} onChange={() => updateForm({ awareness_duration: opt.value })} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={fieldLabel}>Colony duration</label>
                <select style={fieldInput} value={form.colony_duration} onChange={e => updateForm({ colony_duration: e.target.value })}>
                  <option value="">Select...</option>
                  {COLONY_DURATION_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Heard from</label>
                <select style={fieldInput} value={form.referral_source} onChange={e => updateForm({ referral_source: e.target.value })}>
                  <option value="">Select...</option>
                  {REFERRAL_SOURCE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════ PAGE 2: TRAPPING & NOTES ═══════════════════ */}
        <div style={pageCard}>
          <div style={pageHeader}>
            <span style={{ background: "#27ae60", color: "#fff", borderRadius: "4px", padding: "2px 8px", fontSize: "12px", fontWeight: 700 }}>Page 2</span>
            <span style={{ fontSize: "14px", color: "#6b7280" }}>Trapping Details &amp; Notes (back of sheet)</span>
          </div>

          {/* Property Access & Logistics */}
          <div style={{ marginBottom: "16px" }}>
            <div style={sectionTitle}>Property Access &amp; Logistics</div>
            <div style={grid2}>
              <div>
                <label style={fieldLabel}>Property access?</label>
                <div style={radioGroup}>
                  {[{ v: "yes", l: "Yes" }, { v: "need_permission", l: "Need permission" }, { v: "no", l: "No" }].map(o => (
                    <label key={o.v} style={radioLabel}>
                      <input type="radio" name="access" value={o.v} checked={form.has_property_access === o.v} onChange={() => updateForm({ has_property_access: o.v })} />
                      {o.l}
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: "8px" }}>
                  <label style={fieldLabel}>Caller is owner?</label>
                  <div style={radioGroup}>
                    {[{ v: "yes", l: "Yes" }, { v: "renter", l: "Renter" }, { v: "neighbor", l: "Neighbor" }].map(o => (
                      <label key={o.v} style={radioLabel}>
                        <input type="radio" name="owner" value={o.v} checked={form.is_property_owner === o.v} onChange={() => updateForm({ is_property_owner: o.v })} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: "8px" }}>
                  <label style={fieldLabel}>Dogs on site?</label>
                  <div style={radioGroup}>
                    {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }].map(o => (
                      <label key={o.v} style={radioLabel}>
                        <input type="radio" name="dogs" value={o.v} checked={form.dogs_on_site === o.v} onChange={() => updateForm({ dogs_on_site: o.v })} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label style={fieldLabel}>Trap-savvy?</label>
                <div style={radioGroup}>
                  {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }, { v: "unknown", l: "Unknown" }].map(o => (
                    <label key={o.v} style={radioLabel}>
                      <input type="radio" name="trap_savvy" value={o.v} checked={form.trap_savvy === o.v} onChange={() => updateForm({ trap_savvy: o.v })} />
                      {o.l}
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: "8px" }}>
                  <label style={fieldLabel}>Previous TNR?</label>
                  <div style={radioGroup}>
                    {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }, { v: "partial", l: "Partial" }].map(o => (
                      <label key={o.v} style={radioLabel}>
                        <input type="radio" name="prev_tnr" value={o.v} checked={form.previous_tnr === o.v} onChange={() => updateForm({ previous_tnr: o.v })} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: "8px" }}>
                  <label style={fieldLabel}>Handleability</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                    {HANDLEABILITY_OPTIONS.map(opt => (
                      <label key={opt.value} style={radioLabel}>
                        <input type="radio" name="handleability" value={opt.value} checked={form.handleability === opt.value} onChange={() => updateForm({ handleability: opt.value })} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: "10px" }}>
              <label style={fieldLabel}>Access notes (gate codes, parking, hazards)</label>
              <input style={fieldInput} value={form.access_notes} onChange={e => updateForm({ access_notes: e.target.value })} placeholder="Gate code, parking info, etc." />
            </div>
          </div>

          {/* Feeding Schedule */}
          <div style={{ marginBottom: "16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px" }}>
            <div style={{ ...sectionTitle, color: "#166534", borderBottomColor: "#86efac" }}>Feeding Schedule &amp; Best Trapping Times</div>
            <div style={grid3}>
              <div>
                <label style={fieldLabel}>Who feeds?</label>
                <input style={fieldInput} value={form.feeder_info} onChange={e => updateForm({ feeder_info: e.target.value })} placeholder="Name or description" />
              </div>
              <div>
                <label style={fieldLabel}>What time?</label>
                <input style={fieldInput} value={form.feeding_time} onChange={e => updateForm({ feeding_time: e.target.value })} placeholder="e.g., 6pm" />
              </div>
              <div>
                <label style={fieldLabel}>Where do cats eat?</label>
                <input style={fieldInput} value={form.feeding_location} onChange={e => updateForm({ feeding_location: e.target.value })} placeholder="Back porch, side yard..." />
              </div>
            </div>
            <div style={{ ...grid2, marginTop: "10px" }}>
              <div>
                <label style={fieldLabel}>Feeding frequency</label>
                <div style={radioGroup}>
                  {FEEDING_FREQUENCY_OPTIONS.map(opt => (
                    <label key={opt.value} style={radioLabel}>
                      <input type="radio" name="feed_freq" value={opt.value} checked={form.feeding_frequency === opt.value} onChange={() => updateForm({ feeding_frequency: opt.value })} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={fieldLabel}>Best day/time for trapping?</label>
                <input style={fieldInput} value={form.best_trapping_time} onChange={e => updateForm({ best_trapping_time: e.target.value })} placeholder="e.g., Weekday evenings" />
              </div>
            </div>
          </div>

          {/* Important Notes */}
          <div style={{ marginBottom: "16px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "8px", padding: "12px" }}>
            <div style={{ ...sectionTitle, color: "#92400e", borderBottomColor: "#fcd34d" }}>Important Notes (check all that apply)</div>
            <div style={grid3}>
              {IMPORTANT_NOTE_OPTIONS.map(note => (
                <label key={note} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px" }}>
                  <input type="checkbox" checked={form.important_notes.includes(note)} onChange={() => toggleNote(note)} />
                  {IMPORTANT_NOTE_LABELS[note]}
                </label>
              ))}
            </div>
          </div>

          {/* Cat Descriptions */}
          <div style={{ marginBottom: "16px" }}>
            <div style={sectionTitle}>Cat Descriptions</div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 6px 0" }}>Colors, markings, distinguishing features, names if known</p>
            <textarea style={{ ...fieldInput, minHeight: "60px" }} value={form.cat_count_text} onChange={e => updateForm({ cat_count_text: e.target.value })} placeholder="Describe individual cats..." />
          </div>

          {/* Situation Notes */}
          <div style={{ marginBottom: "16px" }}>
            <div style={sectionTitle}>Situation Notes</div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 6px 0" }}>Details, behaviors, access instructions, hazards, callback preferences</p>
            <textarea style={{ ...fieldInput, minHeight: "80px" }} value={form.situation_description} onChange={e => updateForm({ situation_description: e.target.value })} placeholder="Additional details..." />
          </div>

          {/* Staff Assessment */}
          <div style={{ background: "#f8fafc", border: "1px dashed #94a3b8", borderRadius: "8px", padding: "12px" }}>
            <div style={{ ...sectionTitle, color: "#475569", borderBottomColor: "#94a3b8" }}>Staff Assessment</div>
            <div style={grid4}>
              <div>
                <label style={fieldLabel}>Priority</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                  {[{ v: "high", l: "High" }, { v: "normal", l: "Normal" }, { v: "low", l: "Low" }].map(o => (
                    <label key={o.v} style={radioLabel}>
                      <input type="radio" name="priority" value={o.v} checked={form.priority_override === o.v} onChange={() => updateForm({ priority_override: o.v })} />
                      {o.l}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={fieldLabel}>Triage</label>
                <select style={fieldInput} value={form.final_category} onChange={e => updateForm({ final_category: e.target.value })}>
                  <option value="">Select...</option>
                  <option value="high_priority_tnr">FFR</option>
                  <option value="standard_tnr">Standard TNR</option>
                  <option value="wellness_only">Wellness</option>
                  <option value="owned_cat_low">Owned cat</option>
                  <option value="out_of_county">Out of area</option>
                  <option value="needs_review">Needs review</option>
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Received / Reviewed by</label>
                <input style={fieldInput} value={form.reviewed_by} onChange={e => updateForm({ reviewed_by: e.target.value })} placeholder="Staff name" />
              </div>
              <div>
                <label style={fieldLabel}>Call date</label>
                <input style={fieldInput} type="date" />
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════ SUBMIT ═══════════════════ */}
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginBottom: "2rem" }}>
          <a href="/intake/queue" style={{ textDecoration: "none" }}>
            <button type="button" style={{ padding: "10px 24px", border: "1px solid #d1d5db", borderRadius: "8px", background: "#fff", cursor: "pointer", fontSize: "14px" }}>
              Cancel
            </button>
          </a>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "10px 32px",
              background: submitting ? "#9ca3af" : "linear-gradient(135deg, #27ae60 0%, #1e8449 100%)",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor: submitting ? "not-allowed" : "pointer",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            {submitting ? "Submitting..." : "Submit Call Sheet"}
          </button>
        </div>
      </form>
    </div>
  );
}
