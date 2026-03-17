import { formatPhone } from "@/lib/formatters";
import {
  HANDLEABILITY_OPTIONS as BASE_HANDLEABILITY_OPTIONS,
} from "@/lib/intake-options";
import { CALL_TYPE_OPTIONS } from "./CallTypeStep";
import type { BaseStepProps } from "./types";

const HANDLEABILITY_OPTIONS = [
  ...BASE_HANDLEABILITY_OPTIONS,
  { value: "unknown", label: "Unknown / Haven't tried", desc: "Caller doesn't know if cat is approachable" },
];

export default function ReviewStep({ formData }: BaseStepProps) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Review & Submit</h2>

      {/* Call type badge */}
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        background: "#e7f1ff",
        borderRadius: "20px",
        marginBottom: "1rem",
      }}>
        <span>{CALL_TYPE_OPTIONS.find(o => o.value === formData.call_type)?.icon}</span>
        <strong>{CALL_TYPE_OPTIONS.find(o => o.value === formData.call_type)?.label}</strong>
      </div>

      {/* Third-party warning */}
      {formData.is_third_party_report && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "8px", padding: "0.75rem", marginBottom: "1rem" }}>
          <strong>THIRD-PARTY REPORT</strong> - Will need to contact property owner
        </div>
      )}

      {/* Emergency flag */}
      {formData.is_emergency && (
        <div style={{ background: "#f8d7da", border: "1px solid #dc3545", borderRadius: "8px", padding: "0.75rem", marginBottom: "1rem" }}>
          <strong>URGENT REQUEST</strong> - Prioritize follow-up
        </div>
      )}

      {/* Summary sections */}
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ background: "var(--section-bg)", padding: "1rem", borderRadius: "8px" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#666" }}>CONTACT</h4>
          <p style={{ margin: 0 }}><strong>{formData.first_name} {formData.last_name}</strong></p>
          {formData.email && <p style={{ margin: 0 }}>{formData.email}</p>}
          {formData.phone && <p style={{ margin: 0 }}>{formatPhone(formData.phone)}</p>}
        </div>

        <div style={{ background: "var(--section-bg)", padding: "1rem", borderRadius: "8px" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#666" }}>LOCATION</h4>
          <p style={{ margin: 0 }}>{formData.cats_address}</p>
          {formData.cats_city && <p style={{ margin: 0 }}>{formData.cats_city}{formData.cats_zip && `, ${formData.cats_zip}`}</p>}
          {formData.county && <p style={{ margin: 0 }}>{formData.county} County</p>}
          {formData.is_property_owner && <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem", color: "#666" }}>Property owner: {formData.is_property_owner}</p>}
        </div>

        <div style={{ background: "var(--section-bg)", padding: "1rem", borderRadius: "8px" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#666" }}>DETAILS</h4>
          {formData.cat_name && <p style={{ margin: 0 }}><strong>Name:</strong> {formData.cat_name}</p>}
          {formData.cat_description && <p style={{ margin: 0 }}><strong>Description:</strong> {formData.cat_description}</p>}
          {formData.call_type === "colony_tnr" && (
            <>
              <p style={{ margin: 0 }}><strong>Total cats:</strong> {formData.cat_count || "Unknown"}</p>
              {formData.cats_needing_tnr && <p style={{ margin: 0 }}><strong>Needing TNR:</strong> {formData.cats_needing_tnr}</p>}
              {formData.peak_count && <p style={{ margin: 0 }}><strong>Peak seen:</strong> {formData.peak_count}</p>}
              {formData.eartip_count && <p style={{ margin: 0 }}><strong>Ear-tipped:</strong> {formData.eartip_count}</p>}
            </>
          )}
          {formData.call_type === "kitten_rescue" && (
            <>
              <p style={{ margin: 0 }}><strong>Kitten count:</strong> {formData.kitten_count || "Unknown"}</p>
              {formData.kitten_age && <p style={{ margin: 0 }}><strong>Age:</strong> {formData.kitten_age.replace(/_/g, " ")}</p>}
              {formData.kitten_socialization && <p style={{ margin: 0 }}><strong>Socialization:</strong> {formData.kitten_socialization}</p>}
              {formData.mom_present && <p style={{ margin: 0 }}><strong>Mom present:</strong> {formData.mom_present}</p>}
            </>
          )}
          {formData.handleability && (
            <p style={{ margin: "0.5rem 0 0 0" }}>
              <strong>Handleability:</strong> {HANDLEABILITY_OPTIONS.find(o => o.value === formData.handleability)?.label || formData.handleability}
            </p>
          )}
        </div>

        {(formData.has_medical_concerns || formData.medical_description) && (
          <div style={{ background: "#f8d7da", padding: "1rem", borderRadius: "8px" }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#842029" }}>MEDICAL CONCERNS</h4>
            <p style={{ margin: 0 }}>{formData.medical_description || "Flagged as medical concern"}</p>
          </div>
        )}

        {formData.notes && (
          <div style={{ background: "var(--section-bg)", padding: "1rem", borderRadius: "8px" }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#666" }}>NOTES</h4>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{formData.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
