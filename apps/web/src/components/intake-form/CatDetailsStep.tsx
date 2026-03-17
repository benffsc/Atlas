import {
  HANDLEABILITY_OPTIONS as BASE_HANDLEABILITY_OPTIONS,
  URGENT_SITUATION_EXAMPLES,
} from "@/lib/intake-options";
import type { CatDetailsStepProps, CustomField } from "./types";

const HANDLEABILITY_OPTIONS = [
  ...BASE_HANDLEABILITY_OPTIONS,
  { value: "unknown", label: "Unknown / Haven't tried", desc: "Caller doesn't know if cat is approachable" },
];

function renderCustomField(
  field: CustomField,
  value: string | boolean,
  onChange: (fieldKey: string, value: string | boolean) => void,
) {
  switch (field.field_type) {
    case "text":
      return (
        <div key={field.field_id} style={{ marginBottom: "1rem" }}>
          <label>
            {field.field_label}
            {field.is_required && " *"}
            {field.is_beacon_critical && (
              <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", background: "#0d6efd", color: "#fff", padding: "1px 4px", borderRadius: "3px" }}>Beacon</span>
            )}
          </label>
          <input
            type="text"
            value={value as string}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            placeholder={field.placeholder || undefined}
          />
          {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
        </div>
      );

    case "textarea":
      return (
        <div key={field.field_id} style={{ marginBottom: "1rem" }}>
          <label>
            {field.field_label}
            {field.is_required && " *"}
          </label>
          <textarea
            value={value as string}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            placeholder={field.placeholder || undefined}
            rows={3}
          />
          {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
        </div>
      );

    case "number":
      return (
        <div key={field.field_id} style={{ marginBottom: "1rem" }}>
          <label>
            {field.field_label}
            {field.is_required && " *"}
          </label>
          <input
            type="number"
            value={value as string}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            placeholder={field.placeholder || undefined}
            style={{ maxWidth: "150px" }}
          />
          {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
        </div>
      );

    case "select":
      return (
        <div key={field.field_id} style={{ marginBottom: "1rem" }}>
          <label>
            {field.field_label}
            {field.is_required && " *"}
          </label>
          <select
            value={value as string}
            onChange={(e) => onChange(field.field_key, e.target.value)}
          >
            <option value="">Select...</option>
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
        </div>
      );

    case "checkbox":
      return (
        <div key={field.field_id} style={{ marginBottom: "1rem" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(field.field_key, e.target.checked)}
            />
            <span>
              {field.field_label}
              {field.help_text && (
                <span style={{ display: "block", fontSize: "0.85rem", color: "#666" }}>{field.help_text}</span>
              )}
            </span>
          </label>
        </div>
      );

    case "date":
      return (
        <div key={field.field_id} style={{ marginBottom: "1rem" }}>
          <label>
            {field.field_label}
            {field.is_required && " *"}
          </label>
          <input
            type="date"
            value={value as string}
            onChange={(e) => onChange(field.field_key, e.target.value)}
          />
          {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
        </div>
      );

    case "phone":
      return (
        <div key={field.field_id} style={{ marginBottom: "1rem" }}>
          <label>
            {field.field_label}
            {field.is_required && " *"}
          </label>
          <input
            type="tel"
            value={value as string}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            placeholder={field.placeholder || undefined}
          />
          {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
        </div>
      );

    case "email":
      return (
        <div key={field.field_id} style={{ marginBottom: "1rem" }}>
          <label>
            {field.field_label}
            {field.is_required && " *"}
          </label>
          <input
            type="email"
            value={value as string}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            placeholder={field.placeholder || undefined}
          />
          {field.help_text && <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.25rem 0 0" }}>{field.help_text}</p>}
        </div>
      );

    default:
      return null;
  }
}

export default function CatDetailsStep({
  formData,
  updateField,
  errors,
  customFields,
  customFieldValues,
  updateCustomField,
  setShowEmergencyModal,
}: CatDetailsStepProps) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>
        {formData.call_type === "pet_spay_neuter" && "Pet Details"}
        {formData.call_type === "wellness_check" && "Cat Details"}
        {formData.call_type === "single_stray" && "Stray Cat Details"}
        {formData.call_type === "colony_tnr" && "Colony Details"}
        {formData.call_type === "kitten_rescue" && "Kitten Details"}
        {formData.call_type === "medical_concern" && "Medical Details"}
      </h2>

      {/* PET SPAY/NEUTER path */}
      {formData.call_type === "pet_spay_neuter" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label>Cat's Name</label>
              <input
                type="text"
                value={formData.cat_name}
                onChange={(e) => updateField("cat_name", e.target.value)}
                placeholder="Fluffy"
              />
            </div>
            <div>
              <label>Description (color, markings)</label>
              <input
                type="text"
                value={formData.cat_description}
                onChange={(e) => updateField("cat_description", e.target.value)}
                placeholder="Orange tabby"
              />
            </div>
          </div>
          <p style={{ fontSize: "0.9rem", background: "#e7f1ff", padding: "0.75rem", borderRadius: "6px" }}>
            Direct caller to schedule spay/neuter appointment via regular booking process.
          </p>
        </>
      )}

      {/* WELLNESS CHECK path */}
      {formData.call_type === "wellness_check" && (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <label>Cat's Name (if known)</label>
            <input
              type="text"
              value={formData.cat_name}
              onChange={(e) => updateField("cat_name", e.target.value)}
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label>Description</label>
            <input
              type="text"
              value={formData.cat_description}
              onChange={(e) => updateField("cat_description", e.target.value)}
              placeholder="Color, markings, ear-tipped?"
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formData.has_medical_concerns}
                onChange={(e) => updateField("has_medical_concerns", e.target.checked)}
              />
              <strong>Cat has medical concerns</strong>
            </label>
          </div>
          {formData.has_medical_concerns && (
            <div style={{ marginBottom: "1rem" }}>
              <label>Describe the medical concerns *</label>
              <textarea
                value={formData.medical_description}
                onChange={(e) => updateField("medical_description", e.target.value)}
                placeholder="What symptoms are they seeing? Injury? Illness?"
                rows={3}
                style={{ borderColor: errors.medical_description ? "#dc3545" : undefined }}
              />
              {errors.medical_description && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.medical_description}</span>}
            </div>
          )}
        </>
      )}

      {/* SINGLE STRAY path */}
      {formData.call_type === "single_stray" && (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <label>Description</label>
            <input
              type="text"
              value={formData.cat_description}
              onChange={(e) => updateField("cat_description", e.target.value)}
              placeholder="Color, size, any markings"
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label>Fixed status</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {[
                { v: "yes_eartip", l: "Yes (ear-tipped)" },
                { v: "no", l: "No / Not fixed" },
                { v: "unknown", l: "Don't know" },
              ].map(({ v, l }) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="fixed_status"
                    value={v}
                    checked={formData.fixed_status === v}
                    onChange={(e) => updateField("fixed_status", e.target.value)}
                  />
                  {l}
                </label>
              ))}
            </div>
          </div>

          {/* HANDLEABILITY - key question */}
          <div style={{ marginBottom: "1rem", background: "#f0f9ff", padding: "1rem", borderRadius: "8px" }}>
            <label><strong>Can the caller handle this cat?</strong></label>
            <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.75rem" }}>
              This determines if they can bring it in a carrier or if trapping is needed
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {HANDLEABILITY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                    padding: "0.5rem",
                    border: `1px solid ${formData.handleability === opt.value ? "#0066cc" : "#ddd"}`,
                    borderRadius: "4px",
                    cursor: "pointer",
                    background: formData.handleability === opt.value ? "#e7f1ff" : "#fff",
                  }}
                >
                  <input
                    type="radio"
                    name="handleability"
                    value={opt.value}
                    checked={formData.handleability === opt.value}
                    onChange={(e) => updateField("handleability", e.target.value)}
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <span style={{ display: "block", fontSize: "0.8rem", color: "#666" }}>{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formData.has_medical_concerns}
                onChange={(e) => updateField("has_medical_concerns", e.target.checked)}
              />
              Cat appears injured or sick
            </label>
          </div>
          {formData.has_medical_concerns && (
            <div style={{ marginBottom: "1rem" }}>
              <label>Describe the medical concerns</label>
              <textarea
                value={formData.medical_description}
                onChange={(e) => updateField("medical_description", e.target.value)}
                rows={2}
              />
            </div>
          )}
        </>
      )}

      {/* COLONY/TNR path */}
      {formData.call_type === "colony_tnr" && (
        <>
          <div style={{ background: "#f0f9ff", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
            <p style={{ fontSize: "0.9rem", color: "#0d6efd", fontWeight: 500, marginBottom: "1rem" }}>
              Colony Size & TNR Status
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label>How many <strong>adult cats</strong> total at this location?</label>
                <input
                  type="text"
                  value={formData.cat_count}
                  onChange={(e) => updateField("cat_count", e.target.value)}
                  placeholder="e.g., 8 or 10-12"
                />
                <p style={{ fontSize: "0.75rem", color: "#666", margin: "0.25rem 0 0" }}>
                  Adults only - kittens tracked separately
                </p>
              </div>
              <div>
                <label>How many <strong>adult cats</strong> still need to be fixed?</label>
                <input
                  type="text"
                  value={formData.cats_needing_tnr}
                  onChange={(e) => updateField("cats_needing_tnr", e.target.value)}
                  placeholder="e.g., 5"
                />
                <p style={{ fontSize: "0.75rem", color: "#666", margin: "0.25rem 0 0" }}>
                  Adults without ear tips
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label>Most seen at once (last week)?</label>
              <input
                type="number"
                value={formData.peak_count}
                onChange={(e) => updateField("peak_count", e.target.value)}
                placeholder="Peak count"
              />
            </div>
            <div>
              <label>How many are already ear-tipped?</label>
              <input
                type="number"
                value={formData.eartip_count}
                onChange={(e) => updateField("eartip_count", e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label>Feeding situation</label>
            <select
              value={formData.feeding_situation}
              onChange={(e) => updateField("feeding_situation", e.target.value)}
            >
              <option value="">Select...</option>
              <option value="caller_feeds_daily">Caller feeds daily</option>
              <option value="caller_feeds_sometimes">Caller feeds sometimes</option>
              <option value="someone_else_feeds">Someone else feeds them</option>
              <option value="no_feeding">No regular feeding</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>

          {/* HANDLEABILITY for colony */}
          <div style={{ marginBottom: "1rem", background: "#f0f9ff", padding: "1rem", borderRadius: "8px" }}>
            <label><strong>Are any cats handleable?</strong></label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              {[
                { v: "some_friendly", l: "Some are friendly (can be carried)" },
                { v: "all_unhandleable", l: "All unhandleable (need traps)" },
                { v: "unknown", l: "Unknown / varies" },
              ].map(({ v, l }) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="handleability"
                    value={v}
                    checked={formData.handleability === v}
                    onChange={(e) => updateField("handleability", e.target.value)}
                  />
                  {l}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formData.has_medical_concerns}
                onChange={(e) => updateField("has_medical_concerns", e.target.checked)}
              />
              Any cats appear injured or sick
            </label>
          </div>
          {formData.has_medical_concerns && (
            <div style={{ marginTop: "0.5rem" }}>
              <textarea
                value={formData.medical_description}
                onChange={(e) => updateField("medical_description", e.target.value)}
                placeholder="Describe which cats and what concerns..."
                rows={2}
              />
            </div>
          )}
        </>
      )}

      {/* KITTEN RESCUE path */}
      {formData.call_type === "kitten_rescue" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label>How many kittens?</label>
              <input
                type="number"
                value={formData.kitten_count}
                onChange={(e) => updateField("kitten_count", e.target.value)}
                min="1"
              />
            </div>
            <div>
              <label>Approximate age</label>
              <select
                value={formData.kitten_age}
                onChange={(e) => updateField("kitten_age", e.target.value)}
              >
                <option value="">Select...</option>
                <option value="under_4_weeks">Under 4 weeks (bottle babies)</option>
                <option value="4_to_8_weeks">4-8 weeks (weaning)</option>
                <option value="8_to_12_weeks">8-12 weeks</option>
                <option value="over_12_weeks">Over 12 weeks</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label>Socialization</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              {[
                { v: "friendly", l: "Friendly - can be handled" },
                { v: "shy_handleable", l: "Shy but handleable" },
                { v: "unhandleable", l: "Shy/scared - hard to handle" },
                { v: "unknown", l: "Unknown" },
              ].map(({ v, l }) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="kitten_socialization"
                    value={v}
                    checked={formData.kitten_socialization === v}
                    onChange={(e) => updateField("kitten_socialization", e.target.value)}
                  />
                  {l}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label>Is mom cat present?</label>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              {["yes", "no", "unsure"].map((v) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="mom_present"
                    value={v}
                    checked={formData.mom_present === v}
                    onChange={(e) => updateField("mom_present", e.target.value)}
                  />
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div style={{ background: "#fff3cd", padding: "0.75rem", borderRadius: "6px", fontSize: "0.9rem" }}>
            <strong>Note:</strong> Foster space is limited. Assess age, socialization, and whether kittens are contained before promising foster placement.
          </div>
        </>
      )}

      {/* MEDICAL CONCERN path */}
      {formData.call_type === "medical_concern" && (
        <>
          {/* Emergency toggle */}
          <div
            onClick={() => {
              if (!formData.is_emergency) {
                setShowEmergencyModal(true);
              } else {
                updateField("is_emergency", false);
                updateField("emergency_acknowledged", false);
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "1rem",
              background: formData.is_emergency ? "#f8d7da" : "#f8f9fa",
              border: `2px solid ${formData.is_emergency ? "#dc3545" : "#ddd"}`,
              borderRadius: "8px",
              cursor: "pointer",
              marginBottom: "1rem",
            }}
          >
            <input
              type="checkbox"
              checked={formData.is_emergency}
              onChange={() => {}}
              style={{ pointerEvents: "none" }}
            />
            <span>
              <strong>This is an urgent situation</strong>
              <span style={{ display: "block", fontSize: "0.85rem", color: "#666" }}>
                {URGENT_SITUATION_EXAMPLES}
              </span>
            </span>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label>Description of cat</label>
            <input
              type="text"
              value={formData.cat_description}
              onChange={(e) => updateField("cat_description", e.target.value)}
              placeholder="Color, markings, owned or stray?"
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label><strong>Describe the medical concerns *</strong></label>
            <textarea
              value={formData.medical_description}
              onChange={(e) => {
                updateField("medical_description", e.target.value);
                updateField("has_medical_concerns", true);
              }}
              placeholder="What are they seeing? Injury? Illness symptoms? How long?"
              rows={4}
              style={{ borderColor: errors.medical_description ? "#dc3545" : undefined }}
            />
            {errors.medical_description && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.medical_description}</span>}
          </div>

          {/* Handleability */}
          <div style={{ background: "#f0f9ff", padding: "1rem", borderRadius: "8px" }}>
            <label><strong>Can the caller handle this cat?</strong></label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              {HANDLEABILITY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="handleability"
                    value={opt.value}
                    checked={formData.handleability === opt.value}
                    onChange={(e) => updateField("handleability", e.target.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Custom Fields - rendered dynamically from admin config */}
      {customFields.length > 0 && (
        <div style={{
          marginTop: "1.5rem",
          padding: "1rem",
          background: "var(--section-bg)",
          borderRadius: "8px",
          border: "1px solid #ddd",
        }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>Additional Questions</h3>
          {customFields.map(field => renderCustomField(field, customFieldValues[field.field_key] || "", updateCustomField))}
        </div>
      )}

      {/* Notes field - shown for all call types */}
      <div style={{ marginTop: "1.5rem" }}>
        <label>Additional Notes</label>
        <textarea
          value={formData.notes}
          onChange={(e) => updateField("notes", e.target.value)}
          placeholder="Any other relevant details from the call..."
          rows={3}
        />
      </div>
    </div>
  );
}
