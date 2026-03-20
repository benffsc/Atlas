import {
  HAS_PROPERTY_ACCESS_OPTIONS,
  REFERRAL_SOURCE_SIMPLE_OPTIONS,
  YES_NO_OPTIONS,
  toSelectOptions,
} from "@/lib/form-options";
import type { BaseStepProps } from "./types";

const YES_NO_RADIO = toSelectOptions(YES_NO_OPTIONS);
const ACCESS_RADIO = toSelectOptions(HAS_PROPERTY_ACCESS_OPTIONS);
const REFERRAL_SELECT = toSelectOptions(REFERRAL_SOURCE_SIMPLE_OPTIONS);

export default function SituationStep({ formData, updateField }: BaseStepProps) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Property & Access</h2>

      <div style={{ marginBottom: "1rem" }}>
        <label>Is caller the property owner?</label>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          {YES_NO_RADIO.map((opt) => (
            <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="is_property_owner_2"
                value={opt.value}
                checked={formData.is_property_owner === opt.value}
                onChange={(e) => updateField("is_property_owner", e.target.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>Do they have access to where cats congregate?</label>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          {ACCESS_RADIO.map((opt) => (
            <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="has_property_access_2"
                value={opt.value}
                checked={formData.has_property_access === opt.value}
                onChange={(e) => updateField("has_property_access", e.target.value)}
              />
              {opt.label}
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
          {REFERRAL_SELECT.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
