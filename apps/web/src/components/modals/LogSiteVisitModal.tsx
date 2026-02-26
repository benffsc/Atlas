"use client";

import { useState, useEffect } from "react";

interface LogSiteVisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  placeId: string;
  placeName: string;
  requestId?: string; // Optional - link observation to request
  staffId?: string; // Auto-filled from session
  staffName?: string; // Display name for attribution
  onSuccess?: (result: ObservationResult) => void;
  isCompletionFlow?: boolean; // If true, show as completion prompt
  onSkip?: () => void; // Callback for skipping observation
  defaultMode?: "quick" | "full"; // Which mode to start in
}

interface ObservationResult {
  success: boolean;
  observation_id: string;
  total_cats_observed: number;
  eartipped_observed: number;
  observation_date: string;
  chapman_estimate: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  is_final_visit: boolean;
}

const TIME_OF_DAY_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "dawn", label: "Dawn (5-7am)" },
  { value: "morning", label: "Morning (7am-12pm)" },
  { value: "midday", label: "Midday (12-2pm)" },
  { value: "afternoon", label: "Afternoon (2-5pm)" },
  { value: "dusk", label: "Dusk (5-7pm)" },
  { value: "evening", label: "Evening (7-9pm)" },
  { value: "night", label: "Night (9pm-5am)" },
];

const ISSUE_OPTIONS = [
  { code: "no_access", label: "Could not access property" },
  { code: "cat_hiding", label: "Cat(s) hiding" },
  { code: "trap_shy", label: "Trap shy cat(s)" },
  { code: "bad_weather", label: "Bad weather" },
  { code: "equipment_issue", label: "Equipment issue" },
  { code: "owner_absent", label: "Owner/contact not available" },
  { code: "aggressive_cat", label: "Aggressive cat" },
  { code: "cats_not_present", label: "No cats present" },
  { code: "other", label: "Other issue" },
];

export function LogSiteVisitModal({
  isOpen,
  onClose,
  placeId,
  placeName,
  requestId,
  staffId,
  staffName,
  onSuccess,
  isCompletionFlow = false,
  onSkip,
  defaultMode = "quick",
}: LogSiteVisitModalProps) {
  // Mode toggle
  const [mode, setMode] = useState<"quick" | "full">(defaultMode);

  // Quick mode fields (always shown)
  const [catsSeen, setCatsSeen] = useState<number | "">("");
  const [eartipsSeen, setEartipsSeen] = useState<number | "">("");
  const [timeOfDay, setTimeOfDay] = useState("");
  const [atFeedingStation, setAtFeedingStation] = useState(false);
  const [notes, setNotes] = useState("");

  // Full mode fields (shown when mode === 'full')
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split("T")[0]);
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [catsTrapped, setCatsTrapped] = useState<number | "">(0);
  const [catsReturned, setCatsReturned] = useState<number | "">(0);
  const [trapsSet, setTrapsSet] = useState<number | "">("");
  const [trapsRetrieved, setTrapsRetrieved] = useState<number | "">("");
  const [issuesEncountered, setIssuesEncountered] = useState<string[]>([]);
  const [issueDetails, setIssueDetails] = useState("");
  const [isFinalVisit, setIsFinalVisit] = useState(isCompletionFlow);

  // State
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ObservationResult | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(defaultMode);
      setCatsSeen("");
      setEartipsSeen("");
      setTimeOfDay("");
      setAtFeedingStation(false);
      setNotes("");
      setVisitDate(new Date().toISOString().split("T")[0]);
      setArrivalTime("");
      setDepartureTime("");
      setCatsTrapped(0);
      setCatsReturned(0);
      setTrapsSet("");
      setTrapsRetrieved("");
      setIssuesEncountered([]);
      setIssueDetails("");
      setIsFinalVisit(isCompletionFlow);
      setError(null);
      setResult(null);
    }
  }, [isOpen, defaultMode, isCompletionFlow]);

  const toggleIssue = (code: string) => {
    setIssuesEncountered((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (catsSeen === "" || Number(catsSeen) < 0) {
      setError("Please enter the number of cats seen");
      return;
    }
    if (eartipsSeen === "" || Number(eartipsSeen) < 0) {
      setError("Please enter the number of ear-tipped cats seen");
      return;
    }
    if (Number(eartipsSeen) > Number(catsSeen)) {
      setError("Ear-tipped cats cannot exceed total cats seen");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: placeId,
          request_id: requestId || null,
          observer_staff_id: staffId || null,
          observer_type: "trapper_field",
          // Quick fields
          cats_seen_total: Number(catsSeen),
          eartipped_seen: Number(eartipsSeen),
          time_of_day: timeOfDay || null,
          is_at_feeding_station: atFeedingStation,
          notes: notes.trim() || null,
          // Full fields (only if in full mode)
          ...(mode === "full" && {
            observation_date: visitDate,
            arrival_time: arrivalTime || null,
            departure_time: departureTime || null,
            cats_trapped: catsTrapped === "" ? 0 : Number(catsTrapped),
            cats_returned: catsReturned === "" ? 0 : Number(catsReturned),
            traps_set: trapsSet === "" ? null : Number(trapsSet),
            traps_retrieved: trapsRetrieved === "" ? null : Number(trapsRetrieved),
            issues_encountered: issuesEncountered.length > 0 ? issuesEncountered : null,
            issue_details: issueDetails.trim() || null,
            is_final_visit: isFinalVisit,
          }),
          // If quick mode but is completion flow, still mark as final
          ...(mode === "quick" && isCompletionFlow && {
            is_final_visit: true,
          }),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to log site visit");
      }

      const data: ObservationResult = await response.json();
      setResult(data);
      onSuccess?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log site visit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setResult(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: mode === "full" ? "600px" : "480px",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--card-border, #e5e7eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "sticky",
            top: 0,
            background: "var(--card-bg, #fff)",
            zIndex: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>
              {isCompletionFlow ? "Final Site Visit" : "Log Site Visit"}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              {placeName}
            </div>
            {staffName && (
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "2px" }}>
                Recording as: {staffName}
              </div>
            )}
          </div>
          <button
            onClick={handleClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "var(--text-muted)",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Success State */}
        {result ? (
          <div style={{ padding: "20px" }}>
            <div
              style={{
                background: "#d4edda",
                border: "1px solid #c3e6cb",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div style={{ fontWeight: 600, color: "#155724", marginBottom: "0.5rem" }}>
                Site Visit Logged
              </div>
              <div style={{ color: "#155724", fontSize: "0.9rem" }}>
                Recorded {result.total_cats_observed} cats seen, {result.eartipped_observed} with ear tips
                {result.is_final_visit && " (Final Visit)"}
              </div>
            </div>

            {result.chapman_estimate !== null && (
              <div
                style={{
                  background: "#e3f2fd",
                  border: "1px solid #90caf9",
                  borderRadius: "8px",
                  padding: "1rem",
                  marginBottom: "1rem",
                }}
              >
                <div style={{ fontWeight: 600, color: "#1565c0", marginBottom: "0.25rem" }}>
                  Chapman Population Estimate
                </div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1565c0" }}>
                  ~{Math.round(result.chapman_estimate)} cats
                </div>
                {result.confidence_low !== null && result.confidence_high !== null && (
                  <div style={{ color: "#1976d2", fontSize: "0.8rem", marginTop: "0.25rem" }}>
                    95% CI: {Math.round(result.confidence_low)} - {Math.round(result.confidence_high)}
                  </div>
                )}
                <div style={{ color: "#1976d2", fontSize: "0.75rem", marginTop: "0.5rem" }}>
                  Based on mark-resight calculation using clinic data
                </div>
              </div>
            )}

            <button
              onClick={handleClose}
              style={{
                width: "100%",
                padding: "14px",
                background: isCompletionFlow ? "#198754" : "var(--primary, #0d6efd)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "1rem",
              }}
            >
              {isCompletionFlow ? "Continue to Complete Request" : "Done"}
            </button>
          </div>
        ) : (
          /* Form State */
          <form onSubmit={handleSubmit} style={{ padding: "20px" }}>
            {/* Mode Toggle */}
            {!isCompletionFlow && (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "16px",
                  background: "var(--section-bg, #f5f5f5)",
                  padding: "4px",
                  borderRadius: "8px",
                }}
              >
                <button
                  type="button"
                  onClick={() => setMode("quick")}
                  style={{
                    flex: 1,
                    padding: "8px 16px",
                    background: mode === "quick" ? "var(--card-bg, #fff)" : "transparent",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: mode === "quick" ? 600 : 400,
                    boxShadow: mode === "quick" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  Quick
                </button>
                <button
                  type="button"
                  onClick={() => setMode("full")}
                  style={{
                    flex: 1,
                    padding: "8px 16px",
                    background: mode === "full" ? "var(--card-bg, #fff)" : "transparent",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: mode === "full" ? 600 : 400,
                    boxShadow: mode === "full" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  Full Details
                </button>
              </div>
            )}

            {error && (
              <div
                style={{
                  background: "#f8d7da",
                  border: "1px solid #f5c6cb",
                  color: "#721c24",
                  padding: "12px",
                  borderRadius: "8px",
                  marginBottom: "16px",
                  fontSize: "0.9rem",
                }}
              >
                {error}
              </div>
            )}

            {isCompletionFlow && (
              <div
                style={{
                  background: "#d4edda",
                  border: "1px solid #c3e6cb",
                  color: "#155724",
                  padding: "12px",
                  borderRadius: "8px",
                  marginBottom: "16px",
                  fontSize: "0.85rem",
                }}
              >
                Log a final observation to capture the post-TNR colony state.
              </div>
            )}

            {/* ===== QUICK MODE FIELDS (always shown) ===== */}

            {/* Cat Counts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={labelStyle}>
                  Total Cats Seen <span style={{ color: "#dc3545" }}>*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={catsSeen}
                  onChange={(e) => setCatsSeen(e.target.value === "" ? "" : parseInt(e.target.value))}
                  style={inputStyle}
                  placeholder="0"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>
                  Ear-Tipped <span style={{ color: "#dc3545" }}>*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={eartipsSeen}
                  onChange={(e) => setEartipsSeen(e.target.value === "" ? "" : parseInt(e.target.value))}
                  style={inputStyle}
                  placeholder="0"
                  required
                />
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "4px" }}>
                  Already fixed (left ear tip)
                </div>
              </div>
            </div>

            {/* Time & Context */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={labelStyle}>Time of Day</label>
                <select value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} style={inputStyle}>
                  {TIME_OF_DAY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: "8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={atFeedingStation}
                    onChange={(e) => setAtFeedingStation(e.target.checked)}
                    style={{ width: "18px", height: "18px" }}
                  />
                  <span style={{ fontSize: "0.85rem" }}>At feeding time</span>
                </label>
              </div>
            </div>

            {/* ===== FULL MODE FIELDS (shown when mode === 'full') ===== */}
            {mode === "full" && (
              <>
                {/* Visit Date & Times */}
                <div
                  style={{
                    background: "var(--section-bg, #f9f9f9)",
                    borderRadius: "8px",
                    padding: "12px",
                    marginBottom: "16px",
                  }}
                >
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "12px", color: "var(--muted)" }}>
                    Visit Details
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={labelStyle}>Visit Date</label>
                      <input
                        type="date"
                        value={visitDate}
                        onChange={(e) => setVisitDate(e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Arrival</label>
                      <input
                        type="time"
                        value={arrivalTime}
                        onChange={(e) => setArrivalTime(e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Departure</label>
                      <input
                        type="time"
                        value={departureTime}
                        onChange={(e) => setDepartureTime(e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>

                {/* Trapping Activity */}
                <div
                  style={{
                    background: "var(--section-bg, #f9f9f9)",
                    borderRadius: "8px",
                    padding: "12px",
                    marginBottom: "16px",
                  }}
                >
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "12px", color: "var(--muted)" }}>
                    Trapping Activity
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={labelStyle}>Trapped</label>
                      <input
                        type="number"
                        min="0"
                        value={catsTrapped}
                        onChange={(e) => setCatsTrapped(e.target.value === "" ? "" : parseInt(e.target.value))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Returned</label>
                      <input
                        type="number"
                        min="0"
                        value={catsReturned}
                        onChange={(e) => setCatsReturned(e.target.value === "" ? "" : parseInt(e.target.value))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Traps Set</label>
                      <input
                        type="number"
                        min="0"
                        value={trapsSet}
                        onChange={(e) => setTrapsSet(e.target.value === "" ? "" : parseInt(e.target.value))}
                        style={inputStyle}
                        placeholder="—"
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Retrieved</label>
                      <input
                        type="number"
                        min="0"
                        value={trapsRetrieved}
                        onChange={(e) => setTrapsRetrieved(e.target.value === "" ? "" : parseInt(e.target.value))}
                        style={inputStyle}
                        placeholder="—"
                      />
                    </div>
                  </div>
                </div>

                {/* Issues */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={labelStyle}>Issues Encountered</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {ISSUE_OPTIONS.map((issue) => (
                      <button
                        key={issue.code}
                        type="button"
                        onClick={() => toggleIssue(issue.code)}
                        style={{
                          padding: "6px 12px",
                          background: issuesEncountered.includes(issue.code)
                            ? "#fff3cd"
                            : "var(--section-bg, #f5f5f5)",
                          border: `1px solid ${
                            issuesEncountered.includes(issue.code) ? "#ffc107" : "var(--border, #ddd)"
                          }`,
                          borderRadius: "20px",
                          fontSize: "0.8rem",
                          cursor: "pointer",
                          color: issuesEncountered.includes(issue.code) ? "#856404" : "inherit",
                        }}
                      >
                        {issue.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Issue Details */}
                {issuesEncountered.length > 0 && (
                  <div style={{ marginBottom: "16px" }}>
                    <label style={labelStyle}>Issue Details</label>
                    <textarea
                      value={issueDetails}
                      onChange={(e) => setIssueDetails(e.target.value)}
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                      placeholder="Describe the issues..."
                    />
                  </div>
                )}

                {/* Final Visit Checkbox */}
                {requestId && (
                  <div
                    style={{
                      marginBottom: "16px",
                      padding: "12px",
                      background: isFinalVisit ? "#d4edda" : "var(--section-bg, #f5f5f5)",
                      borderRadius: "8px",
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isFinalVisit}
                        onChange={(e) => setIsFinalVisit(e.target.checked)}
                        style={{ width: "18px", height: "18px" }}
                      />
                      <span style={{ fontWeight: 500, color: isFinalVisit ? "#155724" : "inherit" }}>
                        This is the final visit for this request
                      </span>
                    </label>
                  </div>
                )}
              </>
            )}

            {/* Notes (always shown) */}
            <div style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
                placeholder="Any observations or notes about the site..."
              />
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "12px", flexDirection: isCompletionFlow ? "column" : "row" }}>
              {isCompletionFlow ? (
                <>
                  <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>
                    {submitting ? "Saving..." : "Log Visit & Continue"}
                  </button>
                  {onSkip && (
                    <button type="button" onClick={onSkip} disabled={submitting} style={secondaryButtonStyle}>
                      Skip Observation
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button type="button" onClick={handleClose} disabled={submitting} style={secondaryButtonStyle}>
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>
                    {submitting ? "Saving..." : "Log Site Visit"}
                  </button>
                </>
              )}
            </div>

            {/* Help Text */}
            <div
              style={{
                marginTop: "16px",
                padding: "12px",
                background: "var(--info-bg, #e3f2fd)",
                borderRadius: "8px",
                fontSize: "0.75rem",
                color: "var(--muted)",
              }}
            >
              <strong>Why this matters:</strong> Observation data feeds the Chapman population estimator.
              Clinic data provides verified altered counts (M), your observation provides cats seen (C)
              and ear-tipped seen (R) for the formula: N = ((M+1)(C+1)/(R+1)) - 1
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// Styles
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  fontWeight: 500,
  marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--card-border, #e5e7eb)",
  borderRadius: "8px",
  fontSize: "0.9rem",
  background: "var(--background, #fff)",
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "14px",
  background: disabled ? "#9ca3af" : "var(--primary, #198754)",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  cursor: disabled ? "not-allowed" : "pointer",
  fontWeight: 600,
  fontSize: "1rem",
});

const secondaryButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "14px",
  background: "var(--bg-tertiary, #f5f5f5)",
  color: "var(--text, #333)",
  border: "1px solid var(--border, #ddd)",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 500,
  fontSize: "0.95rem",
};

export default LogSiteVisitModal;
