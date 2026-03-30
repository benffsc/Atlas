"use client";

import { useState, useCallback } from "react";
import {
  COUNT_CONFIDENCE_OPTIONS,
  TRIAGE_CATEGORY_OPTIONS,
  PRIORITY_OPTIONS,
  IMPORTANT_NOTE_OPTIONS,
} from "@/lib/form-options";
import type { EntryMode } from "@/components/request-entry";

// --- Types ---

export interface StaffTriageValue {
  priority: string;
  triageCategory: string;
  countConfidence: string;
  peakCount: number | "";
  totalCatsOverride: number | "";
  trapsOvernightSafe: boolean | null;
  accessWithoutContact: boolean | null;
  trapSavvy: string;
  previousTnr: string;
  catDescription: string;
  importantNotes: string[];
}

export interface StaffTriagePanelProps {
  value: StaffTriageValue;
  onChange: (data: StaffTriageValue) => void;
  entryMode: EntryMode;
  estimatedCatCount: number | "";
}

// --- Constants ---

export const EMPTY_STAFF_TRIAGE: StaffTriageValue = {
  priority: "normal",
  triageCategory: "",
  countConfidence: "unknown",
  peakCount: "",
  totalCatsOverride: "",
  trapsOvernightSafe: null,
  accessWithoutContact: null,
  trapSavvy: "",
  previousTnr: "",
  catDescription: "",
  importantNotes: [],
};

// --- Helpers ---

interface TriStateRadioProps {
  name: string;
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}

function TriStateRadio({ name, label, value, onChange }: TriStateRadioProps) {
  const radioLabelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    cursor: "pointer",
    fontSize: "0.85rem",
  };

  return (
    <div>
      <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.85rem" }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: "1rem" }}>
        <label style={radioLabelStyle}><input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> Yes</label>
        <label style={radioLabelStyle}><input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> No</label>
        <label style={radioLabelStyle}><input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} /> Unknown</label>
      </div>
    </div>
  );
}

// --- Component ---

export function StaffTriagePanel({
  value,
  onChange,
  entryMode,
  estimatedCatCount,
}: StaffTriagePanelProps) {
  // Default: collapsed for phone, expanded for paper, hidden for complete
  const [expanded, setExpanded] = useState(entryMode === "paper");

  const update = useCallback(
    (partial: Partial<StaffTriageValue>) => {
      onChange({ ...value, ...partial });
    },
    [value, onChange]
  );

  const toggleNote = useCallback(
    (note: string) => {
      const current = value.importantNotes;
      const updated = current.includes(note)
        ? current.filter((n) => n !== note)
        : [...current, note];
      update({ importantNotes: updated });
    },
    [value.importantNotes, update]
  );

  if (entryMode === "complete") return null;

  return (
    <div
      className="card"
      style={{
        marginBottom: "1.5rem",
        border: "1px solid var(--border-light, #e5e7eb)",
        borderRadius: "10px",
        overflow: "hidden",
      }}
    >
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "12px 16px",
          background: "var(--bg-secondary, #f9fafb)",
          border: "none",
          cursor: "pointer",
          fontSize: "0.9rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          textAlign: "left",
        }}
      >
        <span>Staff Triage (Phase 2)</span>
        <span style={{
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 150ms",
          fontSize: "0.75rem",
        }}>
          ▼
        </span>
      </button>

      {/* Accordion body */}
      {expanded && (
        <div style={{ padding: "16px" }}>
          {/* Row 1: Priority + Triage category */}
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div style={{ flex: "1 1 180px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Priority
              </label>
              <select
                value={value.priority}
                onChange={(e) => update({ priority: e.target.value })}
                style={{ width: "100%" }}
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Triage category
              </label>
              <select
                value={value.triageCategory}
                onChange={(e) => update({ triageCategory: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="">Select...</option>
                {TRIAGE_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Count refinements */}
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div style={{ flex: "1 1 150px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Count confidence
              </label>
              <select
                value={value.countConfidence}
                onChange={(e) => update({ countConfidence: e.target.value })}
                style={{ width: "100%" }}
              >
                {COUNT_CONFIDENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Peak count
              </label>
              <input
                type="number"
                min={0}
                value={value.peakCount}
                onChange={(e) => update({ peakCount: e.target.value === "" ? "" : Number(e.target.value) })}
                placeholder={estimatedCatCount !== "" ? String(estimatedCatCount) : "0"}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Total cats override
              </label>
              <input
                type="number"
                min={0}
                value={value.totalCatsOverride}
                onChange={(e) => update({ totalCatsOverride: e.target.value === "" ? "" : Number(e.target.value) })}
                placeholder={estimatedCatCount !== "" ? String(estimatedCatCount) : "0"}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {/* Row 3: Access booleans */}
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <TriStateRadio
              name="staffTrapsOvernight"
              label="Traps overnight safe?"
              value={value.trapsOvernightSafe}
              onChange={(v) => update({ trapsOvernightSafe: v })}
            />
            <TriStateRadio
              name="staffAccessWithout"
              label="Access without contact?"
              value={value.accessWithoutContact}
              onChange={(v) => update({ accessWithoutContact: v })}
            />
          </div>

          {/* Row 4: Trap savvy + Previous TNR */}
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Trap-savvy?
              </label>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }, { v: "unknown", l: "Unknown" }].map((o) => (
                  <label key={o.v} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", fontSize: "0.85rem" }}>
                    <input type="radio" name="staffTrapSavvy" checked={value.trapSavvy === o.v} onChange={() => update({ trapSavvy: o.v })} />
                    {o.l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
                Previous TNR?
              </label>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }, { v: "partial", l: "Partial" }].map((o) => (
                  <label key={o.v} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", fontSize: "0.85rem" }}>
                    <input type="radio" name="staffPreviousTnr" checked={value.previousTnr === o.v} onChange={() => update({ previousTnr: o.v })} />
                    {o.l}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Cat descriptions */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.85rem" }}>
              Cat descriptions
            </label>
            <textarea
              value={value.catDescription}
              onChange={(e) => update({ catDescription: e.target.value })}
              placeholder="Colors, markings, names — describe individual cats"
              rows={2}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>

          {/* Important notes toggle chips */}
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, fontSize: "0.85rem" }}>
              Important notes
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {IMPORTANT_NOTE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.35rem 0.6rem",
                    border: `1px solid ${value.importantNotes.includes(opt.value) ? "var(--primary)" : "var(--border)"}`,
                    borderRadius: "6px",
                    cursor: "pointer",
                    background: value.importantNotes.includes(opt.value) ? "var(--primary)" : "transparent",
                    color: value.importantNotes.includes(opt.value) ? "#fff" : "inherit",
                    fontSize: "0.8rem",
                    transition: "all 150ms",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={value.importantNotes.includes(opt.value)}
                    onChange={() => toggleNote(opt.value)}
                    style={{ display: "none" }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
