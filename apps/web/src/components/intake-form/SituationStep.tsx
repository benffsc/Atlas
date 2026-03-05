import type { BaseStepProps } from "./types";

export default function SituationStep({ formData, updateField }: BaseStepProps) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Property & Access</h2>

      <div style={{ marginBottom: "1rem" }}>
        <label>Is caller the property owner?</label>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          {["yes", "no"].map((v) => (
            <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="is_property_owner_2"
                value={v}
                checked={formData.is_property_owner === v}
                onChange={(e) => updateField("is_property_owner", e.target.value)}
              />
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>Do they have access to where cats congregate?</label>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          {["yes", "no", "need_permission"].map((v) => (
            <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="has_property_access_2"
                value={v}
                checked={formData.has_property_access === v}
                onChange={(e) => updateField("has_property_access", e.target.value)}
              />
              {v === "need_permission" ? "Need permission" : v.charAt(0).toUpperCase() + v.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label>How did they hear about us?</label>
        <select
          value={formData.referral_source}
          onChange={(e) => updateField("referral_source", e.target.value)}
        >
          <option value="">Select...</option>
          <option value="search">Online search</option>
          <option value="social">Social media</option>
          <option value="friend">Friend/family</option>
          <option value="shelter">Animal shelter</option>
          <option value="vet">Veterinarian</option>
          <option value="repeat">Previous experience</option>
          <option value="other">Other</option>
        </select>
      </div>
    </div>
  );
}
