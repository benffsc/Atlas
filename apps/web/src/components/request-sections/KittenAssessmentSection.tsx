"use client";

import { useCallback } from "react";
import {
  KITTEN_AGE_COARSE_OPTIONS,
  KITTEN_BEHAVIOR_INTAKE_OPTIONS,
  MOM_PRESENT_OPTIONS,
  MOM_FIXED_OPTIONS,
  CAN_BRING_IN_OPTIONS,
  toSelectOptions,
} from "@/lib/form-options";

// --- Types ---

export interface KittenAssessmentValue {
  hasKittens: boolean;
  kittenCount: number | "";
  kittenAgeWeeks: number | "";
  kittenAgeEstimate: string;
  kittenMixedAgesDescription: string;
  kittenBehavior: string;
  kittenContained: string;
  momPresent: string;
  momFixed: string;
  canBringIn: string;
  kittenNotes: string;
}

export interface KittenAssessmentSectionProps {
  value: KittenAssessmentValue;
  onChange: (data: KittenAssessmentValue) => void;
  /** Override age estimate dropdown options. Defaults to built-in coarse ranges. */
  ageOptions?: readonly { value: string; label: string }[];
  /** Override behavior radio options. Defaults to built-in options. */
  behaviorOptions?: readonly { value: string; label: string }[];
  compact?: boolean;
}

// --- Constants (derived from canonical form-options.ts) ---

const AGE_ESTIMATE_OPTIONS = [
  { value: "", label: "Select age range..." },
  ...toSelectOptions(KITTEN_AGE_COARSE_OPTIONS),
];

const BEHAVIOR_OPTIONS = toSelectOptions(KITTEN_BEHAVIOR_INTAKE_OPTIONS);
const MOM_PRESENT_RADIO = toSelectOptions(MOM_PRESENT_OPTIONS);
const MOM_FIXED_RADIO = toSelectOptions(MOM_FIXED_OPTIONS);
const CAN_BRING_IN_RADIO = toSelectOptions(CAN_BRING_IN_OPTIONS);

export const EMPTY_KITTEN_ASSESSMENT: KittenAssessmentValue = {
  hasKittens: false,
  kittenCount: "",
  kittenAgeWeeks: "",
  kittenAgeEstimate: "",
  kittenMixedAgesDescription: "",
  kittenBehavior: "",
  kittenContained: "",
  momPresent: "",
  momFixed: "",
  canBringIn: "",
  kittenNotes: "",
};

// --- Component ---

export function KittenAssessmentSection({
  value,
  onChange,
  ageOptions,
  behaviorOptions,
  compact = false,
}: KittenAssessmentSectionProps) {
  const resolvedAgeOptions = ageOptions
    ? [{ value: "", label: "Select age range..." }, ...ageOptions]
    : AGE_ESTIMATE_OPTIONS;
  const resolvedBehaviorOptions = behaviorOptions || BEHAVIOR_OPTIONS;
  const update = useCallback(
    (partial: Partial<KittenAssessmentValue>) => {
      onChange({ ...value, ...partial });
    },
    [value, onChange]
  );

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
    display: "flex",
    alignItems: "center",
    gap: "8px",
    ...(compact
      ? {}
      : {
          paddingBottom: "8px",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
        }),
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: compact ? "8px" : "1rem",
    flexWrap: "wrap",
    marginBottom: compact ? "8px" : "1rem",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "0.25rem",
    fontWeight: 500,
    fontSize: compact ? "0.8rem" : "0.9rem",
  };

  const radioGroupStyle: React.CSSProperties = {
    display: "flex",
    gap: "1rem",
    fontSize: compact ? "0.8rem" : "0.9rem",
  };

  const radioLabelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    cursor: "pointer",
  };

  const inputStyle: React.CSSProperties = { width: "100%" };

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={value.hasKittens}
            onChange={(e) => update({ hasKittens: e.target.checked })}
          />
          Kittens present
        </label>
      </div>

      {value.hasKittens && (
        <>
          {/* Count + Age */}
          <div style={rowStyle}>
            <div style={{ flex: "1 1 120px" }}>
              <label style={labelStyle}>How many?</label>
              <input
                type="number"
                min={1}
                value={value.kittenCount}
                onChange={(e) =>
                  update({
                    kittenCount:
                      e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
                placeholder="0"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label style={labelStyle}>Age (weeks)</label>
              <input
                type="number"
                min={0}
                max={52}
                value={value.kittenAgeWeeks}
                onChange={(e) =>
                  update({
                    kittenAgeWeeks:
                      e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
                placeholder="0"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: "2 1 200px" }}>
              <label style={labelStyle}>Age range</label>
              <select
                value={value.kittenAgeEstimate}
                onChange={(e) =>
                  update({ kittenAgeEstimate: e.target.value })
                }
                style={inputStyle}
              >
                {resolvedAgeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Mixed ages description */}
          {(value.kittenAgeEstimate === "mixed" || value.kittenAgeEstimate === "mixed_ages") && (
            <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
              <label style={labelStyle}>Describe the age mix</label>
              <input
                type="text"
                value={value.kittenMixedAgesDescription}
                onChange={(e) =>
                  update({ kittenMixedAgesDescription: e.target.value })
                }
                placeholder='e.g., "3 at ~8 weeks, 2 at ~6 months"'
                style={inputStyle}
              />
            </div>
          )}

          {/* Behavior */}
          <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
            <label style={labelStyle}>Kitten behavior / socialization</label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              {resolvedBehaviorOptions.map((opt) => (
                <label key={opt.value} style={radioLabelStyle}>
                  <input
                    type="radio"
                    name="kittenBehavior"
                    checked={value.kittenBehavior === opt.value}
                    onChange={() => update({ kittenBehavior: opt.value })}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Grid: Contained, Mom present, Mom fixed, Can bring in */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: compact
                ? "1fr 1fr"
                : "repeat(auto-fit, minmax(180px, 1fr))",
              gap: compact ? "8px" : "1rem",
              marginBottom: compact ? "8px" : "1rem",
            }}
          >
            {/* Contained */}
            <div>
              <label style={labelStyle}>Kittens contained/caught?</label>
              <div style={radioGroupStyle}>
                {["yes", "no", "some"].map((v) => (
                  <label key={v} style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="kittenContained"
                      checked={value.kittenContained === v}
                      onChange={() => update({ kittenContained: v })}
                    />
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            {/* Mom present */}
            <div>
              <label style={labelStyle}>Mom cat present?</label>
              <div style={radioGroupStyle}>
                {MOM_PRESENT_RADIO.map((opt) => (
                  <label key={opt.value} style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="momPresent"
                      checked={value.momPresent === opt.value}
                      onChange={() => update({ momPresent: opt.value })}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Mom fixed — only when mom present */}
            {(value.momPresent === "yes_present" || value.momPresent === "yes" || value.momPresent === "comes_goes") && (
              <div>
                <label style={labelStyle}>Mom fixed (ear-tipped)?</label>
                <div style={radioGroupStyle}>
                  {MOM_FIXED_RADIO.map((opt) => (
                    <label key={opt.value} style={radioLabelStyle}>
                      <input
                        type="radio"
                        name="momFixed"
                        checked={value.momFixed === opt.value}
                        onChange={() => update({ momFixed: opt.value })}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Can bring in */}
            <div>
              <label style={labelStyle}>Can bring them in?</label>
              <div style={radioGroupStyle}>
                {CAN_BRING_IN_RADIO.map((opt) => (
                  <label key={opt.value} style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="canBringIn"
                      checked={value.canBringIn === opt.value}
                      onChange={() => update({ canBringIn: opt.value })}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Kitten notes</label>
            <textarea
              value={value.kittenNotes}
              onChange={(e) => update({ kittenNotes: e.target.value })}
              placeholder="Colors, where they hide, feeding times, trap-savvy, etc..."
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
        </>
      )}
    </div>
  );
}
