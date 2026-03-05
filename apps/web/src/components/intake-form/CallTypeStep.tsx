import { CALL_TYPE_OPTIONS as BASE_CALL_TYPE_OPTIONS } from "@/lib/intake-options";
import type { BaseStepProps, FormCallType } from "./types";

const CALL_TYPE_ICONS: Record<string, string> = {
  pet_spay_neuter: "\u{1F3E0}",
  wellness_check: "\u{1F48A}",
  single_stray: "\u{1F431}",
  colony_tnr: "\u{1F408}\u200D\u2B1B",
  kitten_rescue: "\u{1F37C}",
  medical_concern: "\u{1F6A8}",
};

const CALL_TYPE_OPTIONS = BASE_CALL_TYPE_OPTIONS.map((opt) => ({
  ...opt,
  icon: CALL_TYPE_ICONS[opt.value] || "\u{1F4CB}",
}));

export { CALL_TYPE_OPTIONS };

export default function CallTypeStep({ formData, updateField, errors }: BaseStepProps) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2 style={{ marginBottom: "0.5rem" }}>What is this call about?</h2>
      <p style={{ color: "#666", marginBottom: "1rem", fontSize: "0.9rem" }}>
        Select the option that best describes the caller's situation
      </p>

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {CALL_TYPE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              padding: "1rem",
              border: `2px solid ${formData.call_type === opt.value ? "#0066cc" : "#ddd"}`,
              borderRadius: "8px",
              cursor: "pointer",
              background: formData.call_type === opt.value ? "#e7f1ff" : "#fff",
              transition: "all 0.15s ease",
            }}
          >
            <input
              type="radio"
              name="call_type"
              value={opt.value}
              checked={formData.call_type === opt.value}
              onChange={(e) => updateField("call_type", e.target.value as FormCallType)}
              style={{ display: "none" }}
            />
            <span style={{ fontSize: "1.5rem" }}>{opt.icon}</span>
            <span>
              <strong>{opt.label}</strong>
              <span style={{ display: "block", fontSize: "0.85rem", color: "#666" }}>{opt.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {errors.call_type && <span style={{ color: "#dc3545", fontSize: "0.85rem" }}>{errors.call_type}</span>}
    </div>
  );
}
