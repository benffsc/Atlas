"use client";

import { useCallback } from "react";
import {
  COLONY_DURATION_OPTIONS,
  EARTIP_ESTIMATE_OPTIONS,
  REQUEST_PURPOSE_OPTIONS,
  HANDLEABILITY_OPTIONS,
  OWNERSHIP_OPTIONS,
} from "@/lib/form-options";

// --- Types ---

export interface CatDetailsSectionValue {
  estimatedCatCount: number | "";
  /** @deprecated Moved to StaffTriagePanel — kept for backward compat */
  totalCatsReported?: number | "";
  /** @deprecated Moved to StaffTriagePanel — kept for backward compat */
  peakCount?: number | "";
  /** @deprecated Moved to StaffTriagePanel — kept for backward compat */
  countConfidence?: string;
  colonyDuration: string;
  /** @deprecated Derived from colonyDuration in facade */
  awarenessDuration?: string;
  eartipCount: number | "";
  eartipEstimate: string;
  /** @deprecated Derived from handleability in facade */
  catsAreFriendly?: boolean | null;
  catName: string;
  catDescription: string;
  wellnessCatCount: number | "";
  requestPurposes: string[];
  handleability: string;
  ownershipStatus: string;
}

export interface CatDetailsSectionProps {
  value: CatDetailsSectionValue;
  onChange: (data: CatDetailsSectionValue) => void;
  compact?: boolean;
}

// --- Constants ---

export const EMPTY_CAT_DETAILS: CatDetailsSectionValue = {
  estimatedCatCount: "",
  totalCatsReported: "",
  peakCount: "",
  countConfidence: "unknown",
  colonyDuration: "unknown",
  awarenessDuration: "unknown",
  eartipCount: "",
  eartipEstimate: "unknown",
  catsAreFriendly: null,
  catName: "",
  catDescription: "",
  wellnessCatCount: "",
  requestPurposes: ["tnr"],
  handleability: "",
  ownershipStatus: "",
};

// --- Component ---

export function CatDetailsSection({
  value,
  onChange,
  compact = false,
}: CatDetailsSectionProps) {
  const update = useCallback(
    (partial: Partial<CatDetailsSectionValue>) => {
      onChange({ ...value, ...partial });
    },
    [value, onChange]
  );

  const togglePurpose = useCallback(
    (purpose: string) => {
      const current = value.requestPurposes;
      const updated = current.includes(purpose)
        ? current.filter((p) => p !== purpose)
        : [...current, purpose];
      update({ requestPurposes: updated });
    },
    [value.requestPurposes, update]
  );

  const showTnrFields =
    value.requestPurposes.some((p) =>
      ["tnr", "relocation", "rescue"].includes(p)
    );
  const showWellnessFields = value.requestPurposes.includes("wellness");
  const catCount =
    typeof value.estimatedCatCount === "number" ? value.estimatedCatCount : 0;
  const showExactEartip = catCount > 0 && catCount <= 5;
  const showCatName = catCount >= 1 && catCount <= 3;

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

  const inputStyle: React.CSSProperties = { width: "100%" };

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>About the Cats</div>

      {/* Request Purpose */}
      <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
        <label style={labelStyle}>Request purpose</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {REQUEST_PURPOSE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: "6px",
                cursor: "pointer",
                background: value.requestPurposes.includes(opt.value)
                  ? "var(--primary, #2563eb)"
                  : "transparent",
                color: value.requestPurposes.includes(opt.value)
                  ? "#fff"
                  : "inherit",
                fontSize: compact ? "0.8rem" : "0.85rem",
              }}
            >
              <input
                type="checkbox"
                checked={value.requestPurposes.includes(opt.value)}
                onChange={() => togglePurpose(opt.value)}
                style={{ display: "none" }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* TNR / Relocation / Rescue fields */}
      {showTnrFields && (
        <>
          <div style={rowStyle}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>How many cats?</label>
              <input
                type="number"
                min={1}
                value={value.estimatedCatCount}
                onChange={(e) =>
                  update({
                    estimatedCatCount:
                      e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
                placeholder="0"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={labelStyle}>How long have cats been here?</label>
              <select
                value={value.colonyDuration}
                onChange={(e) => update({ colonyDuration: e.target.value })}
                style={inputStyle}
              >
                {COLONY_DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      {/* Wellness fields */}
      {showWellnessFields && (
        <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
          <label style={labelStyle}>Altered cats for wellness</label>
          <input
            type="number"
            min={0}
            value={value.wellnessCatCount}
            onChange={(e) =>
              update({
                wellnessCatCount:
                  e.target.value === "" ? "" : Number(e.target.value),
              })
            }
            placeholder="0"
            style={{ ...inputStyle, maxWidth: "150px" }}
          />
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.8rem",
              color: "var(--text-muted, #6b7280)",
            }}
          >
            Already ear-tipped cats to check on
          </p>
        </div>
      )}

      {/* Ear-tip estimate */}
      {(showTnrFields || showWellnessFields) && (
        <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
          {showExactEartip ? (
            <div>
              <label style={labelStyle}>Ear-tipped cats (exact)</label>
              <input
                type="number"
                min={0}
                max={catCount}
                value={value.eartipCount}
                onChange={(e) =>
                  update({
                    eartipCount:
                      e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
                placeholder="0"
                style={{ ...inputStyle, maxWidth: "120px" }}
              />
            </div>
          ) : (
            <div>
              <label style={labelStyle}>Ear-tip estimate</label>
              <select
                value={value.eartipEstimate}
                onChange={(e) => update({ eartipEstimate: e.target.value })}
                style={{ ...inputStyle, maxWidth: "250px" }}
              >
                {EARTIP_ESTIMATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Handleability */}
      <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
        <label style={labelStyle}>Handleability</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {HANDLEABILITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                fontSize: compact ? "0.8rem" : "0.9rem",
              }}
            >
              <input
                type="radio"
                name="handleability"
                checked={value.handleability === opt.value}
                onChange={() => update({ handleability: opt.value })}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Ownership status */}
      <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
        <label style={labelStyle}>Ownership status</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          {OWNERSHIP_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                fontSize: compact ? "0.8rem" : "0.9rem",
              }}
            >
              <input
                type="radio"
                name="ownershipStatus"
                checked={value.ownershipStatus === opt.value}
                onChange={() => update({ ownershipStatus: opt.value })}
              />
              {opt.shortLabel}
            </label>
          ))}
        </div>
      </div>

      {/* Cat name (1-3 cats only) */}
      {showCatName && (
        <div style={{ marginBottom: compact ? "8px" : "1rem" }}>
          <label style={labelStyle}>
            Cat name{catCount > 1 ? "s" : ""}
          </label>
          <input
            type="text"
            value={value.catName}
            onChange={(e) => update({ catName: e.target.value })}
            placeholder={
              catCount === 1
                ? "Cat's name (if known)"
                : "Cat names (if known)"
            }
            style={inputStyle}
          />
        </div>
      )}
    </div>
  );
}
