"use client";

import { useState, useEffect } from "react";
import { postApi } from "@/lib/api-client";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";

interface TripReportResult {
  report_id: string;
  journal_entry_id: string | null;
  remaining_estimate: number | null;
  chapman_estimate: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  message: string;
}

interface TripReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  trapperPersonId?: string | null;
  trapperName?: string | null;
  isFinalVisit?: boolean;
  estimatedCatCount?: number | null;
  placeId?: string | null;
  placeName?: string | null;
  onSuccess?: (result: TripReportResult) => void;
}

const ISSUE_OPTIONS = [
  { value: "no_access", label: "Could not access property" },
  { value: "cat_hiding", label: "Cat(s) hiding" },
  { value: "trap_shy", label: "Trap shy cat(s)" },
  { value: "bad_weather", label: "Bad weather" },
  { value: "equipment_issue", label: "Equipment issue" },
  { value: "owner_absent", label: "Owner/contact not available" },
  { value: "aggressive_cat", label: "Aggressive cat" },
  { value: "other", label: "Other issue" },
];

const CONFIDENCE_OPTIONS = [
  { value: "counted", label: "Counted" },
  { value: "good_guess", label: "Good guess" },
  { value: "rough_guess", label: "Rough guess" },
] as const;

const MORE_SESSIONS_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unsure" },
] as const;

export function TripReportModal({
  isOpen,
  onClose,
  requestId,
  trapperPersonId,
  trapperName,
  isFinalVisit = false,
  estimatedCatCount,
  placeId,
  placeName,
  onSuccess,
}: TripReportModalProps) {
  const hasTrapper = !!(trapperPersonId && trapperName);
  const [reporter, setReporter] = useState<PersonReference>({
    person_id: hasTrapper ? trapperPersonId! : null,
    display_name: trapperName || "",
    is_resolved: hasTrapper,
  });
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split("T")[0]);
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [catsTrapped, setCatsTrapped] = useState(0);
  const [catsReturned, setCatsReturned] = useState(0);
  const [trapsSet, setTrapsSet] = useState<number | "">("");
  const [trapsRetrieved, setTrapsRetrieved] = useState<number | "">("");
  const [catsSeen, setCatsSeen] = useState<number | "">("");
  const [eartippedSeen, setEartippedSeen] = useState<number | "">("");
  const [issues, setIssues] = useState<string[]>([]);
  const [issueDetails, setIssueDetails] = useState("");
  const [siteNotes, setSiteNotes] = useState("");
  const [isFinal, setIsFinal] = useState(isFinalVisit);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  // FFS-143: New state
  const [remainingEstimate, setRemainingEstimate] = useState<number | "">("");
  const [estimateConfidence, setEstimateConfidence] = useState<string>("good_guess");
  const [updateRequestEstimate, setUpdateRequestEstimate] = useState(true);
  const [trapperTotalEstimate, setTrapperTotalEstimate] = useState<number | "">("");
  const [moreSessionsNeeded, setMoreSessionsNeeded] = useState<string>("unknown");
  const [result, setResult] = useState<TripReportResult | null>(null);

  // Reset isFinal when modal opens with isFinalVisit prop
  useEffect(() => {
    if (isOpen) {
      setIsFinal(isFinalVisit);
    }
  }, [isOpen, isFinalVisit]);

  // Auto-calculate remaining estimate when cats trapped changes
  useEffect(() => {
    if (estimatedCatCount != null && estimatedCatCount > 0 && catsTrapped > 0) {
      setRemainingEstimate(Math.max(0, estimatedCatCount - catsTrapped));
    }
  }, [catsTrapped, estimatedCatCount]);

  const toggleIssue = (issueValue: string) => {
    setIssues((prev) =>
      prev.includes(issueValue)
        ? prev.filter((i) => i !== issueValue)
        : [...prev, issueValue]
    );
  };

  const resetForm = () => {
    setReporter({
      person_id: hasTrapper ? trapperPersonId! : null,
      display_name: trapperName || "",
      is_resolved: hasTrapper,
    });
    setVisitDate(new Date().toISOString().split("T")[0]);
    setArrivalTime("");
    setDepartureTime("");
    setCatsTrapped(0);
    setCatsReturned(0);
    setTrapsSet("");
    setTrapsRetrieved("");
    setCatsSeen("");
    setEartippedSeen("");
    setIssues([]);
    setIssueDetails("");
    setSiteNotes("");
    setRemainingEstimate("");
    setEstimateConfidence("good_guess");
    setUpdateRequestEstimate(true);
    setTrapperTotalEstimate("");
    setMoreSessionsNeeded("unknown");
    setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await postApi<TripReportResult>(`/api/requests/${requestId}/trip-report`, {
        trapper_person_id: reporter.person_id,
        trapper_name: reporter.is_resolved ? reporter.display_name : null,
        reported_by_name: reporter.display_name || null,
        visit_date: visitDate,
        arrival_time: arrivalTime || null,
        departure_time: departureTime || null,
        cats_trapped: catsTrapped,
        cats_returned: catsReturned,
        traps_set: trapsSet === "" ? null : trapsSet,
        traps_retrieved: trapsRetrieved === "" ? null : trapsRetrieved,
        cats_seen: catsSeen === "" ? null : catsSeen,
        eartipped_seen: eartippedSeen === "" ? null : eartippedSeen,
        issues_encountered: issues,
        issue_details: issueDetails || null,
        site_notes: siteNotes || null,
        is_final_visit: isFinal,
        // FFS-143 fields
        remaining_estimate: remainingEstimate === "" ? null : remainingEstimate,
        estimate_confidence: estimateConfidence,
        update_request_estimate: updateRequestEstimate,
        trapper_total_estimate: trapperTotalEstimate === "" ? null : trapperTotalEstimate,
        more_sessions_needed: moreSessionsNeeded,
      });

      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDone = () => {
    onClose();
    if (result) {
      onSuccess?.(result);
    }
    resetForm();
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
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "500px",
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
              {isFinal ? "Final Trip Report" : "Session / Field Report"}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              {hasTrapper ? trapperName : placeName || "New report"}{hasTrapper && placeName ? ` — ${placeName}` : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.25rem",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
          >
            x
          </button>
        </div>

        {result ? (
          /* Enhanced success state */
          <div style={{ padding: "20px" }}>
            <div style={{ textAlign: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "4px" }}>
                Report Submitted
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                {result.message}
              </div>
            </div>

            {/* Summary card */}
            <div
              style={{
                background: "var(--section-bg, #f9fafb)",
                border: "1px solid var(--card-border, #e5e7eb)",
                borderRadius: "8px",
                padding: "12px 16px",
                marginBottom: "12px",
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: "6px", fontSize: "0.85rem" }}>Session Summary</div>
              <div style={{ display: "flex", gap: "16px", fontSize: "0.9rem" }}>
                <span>Trapped: <strong>{catsTrapped}</strong></span>
                <span>Returned: <strong>{catsReturned}</strong></span>
              </div>
              {result.remaining_estimate != null && (
                <div style={{ marginTop: "4px", fontSize: "0.9rem" }}>
                  Estimated remaining: <strong>{result.remaining_estimate}</strong>
                </div>
              )}
            </div>

            {/* Chapman estimate card */}
            {result.chapman_estimate != null && (
              <div
                style={{
                  background: "#e3f2fd",
                  border: "1px solid #90caf9",
                  borderRadius: "8px",
                  padding: "1rem",
                  marginBottom: "12px",
                }}
              >
                <div style={{ fontWeight: 600, color: "#1565c0", marginBottom: "0.25rem" }}>
                  Chapman Population Estimate
                </div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1565c0" }}>
                  ~{Math.round(result.chapman_estimate)} cats
                </div>
                {result.confidence_low != null && result.confidence_high != null && (
                  <div style={{ color: "#1976d2", fontSize: "0.8rem", marginTop: "0.25rem" }}>
                    95% CI: {Math.round(result.confidence_low)} - {Math.round(result.confidence_high)}
                  </div>
                )}
                <div style={{ color: "#1976d2", fontSize: "0.75rem", marginTop: "0.5rem" }}>
                  Based on mark-resight calculation using clinic data
                </div>
              </div>
            )}

            {/* Journal entry confirmation */}
            {result.journal_entry_id && (
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", textAlign: "center", marginBottom: "12px" }}>
                Journal entry created
              </div>
            )}

            <button
              onClick={handleDone}
              style={{
                width: "100%",
                padding: "14px",
                background: "var(--primary)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: "20px" }}>
            {/* Reported By */}
            <div style={{ marginBottom: "16px" }}>
              <PersonReferencePicker
                value={reporter}
                onChange={setReporter}
                label="Reported by"
                placeholder="Search for a person or type a name..."
                required={!hasTrapper}
                requireResolved={true}
                allowCreate={true}
                inputStyle={inputStyle}
              />
            </div>

            {/* Visit Date */}
            <div style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>Visit Date *</label>
              <input
                type="date"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                required
                style={inputStyle}
              />
            </div>

            {/* Time Range */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Arrival Time</label>
                <input
                  type="time"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Departure Time</label>
                <input
                  type="time"
                  value={departureTime}
                  onChange={(e) => setDepartureTime(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Cat Counts */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Cats Trapped</label>
                <input
                  type="number"
                  min="0"
                  value={catsTrapped}
                  onChange={(e) => setCatsTrapped(parseInt(e.target.value) || 0)}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Cats Returned</label>
                <input
                  type="number"
                  min="0"
                  value={catsReturned}
                  onChange={(e) => setCatsReturned(parseInt(e.target.value) || 0)}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Trap Counts */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Traps Set</label>
                <input
                  type="number"
                  min="0"
                  value={trapsSet}
                  onChange={(e) =>
                    setTrapsSet(e.target.value === "" ? "" : parseInt(e.target.value) || 0)
                  }
                  placeholder="Optional"
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Traps Retrieved</label>
                <input
                  type="number"
                  min="0"
                  value={trapsRetrieved}
                  onChange={(e) =>
                    setTrapsRetrieved(e.target.value === "" ? "" : parseInt(e.target.value) || 0)
                  }
                  placeholder="Optional"
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Observation Counts */}
            <div
              style={{
                padding: "12px",
                background: "var(--info-bg, #e0f2fe)",
                borderRadius: "8px",
                marginBottom: "16px",
              }}
            >
              <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "8px" }}>
                Colony Observation (for Beacon)
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, fontSize: "0.75rem" }}>Total Cats Seen</label>
                  <input
                    type="number"
                    min="0"
                    value={catsSeen}
                    onChange={(e) =>
                      setCatsSeen(e.target.value === "" ? "" : parseInt(e.target.value) || 0)
                    }
                    placeholder="How many?"
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ ...labelStyle, fontSize: "0.75rem" }}>Eartipped Seen</label>
                  <input
                    type="number"
                    min="0"
                    value={eartippedSeen}
                    onChange={(e) =>
                      setEartippedSeen(e.target.value === "" ? "" : parseInt(e.target.value) || 0)
                    }
                    placeholder="Already fixed"
                    style={inputStyle}
                  />
                </div>
              </div>
              {/* Trapper total estimate */}
              <div style={{ marginTop: "8px" }}>
                <label style={{ ...labelStyle, fontSize: "0.75rem" }}>Trapper&apos;s total colony estimate</label>
                <input
                  type="number"
                  min="0"
                  value={trapperTotalEstimate}
                  onChange={(e) =>
                    setTrapperTotalEstimate(e.target.value === "" ? "" : parseInt(e.target.value) || 0)
                  }
                  placeholder="Optional — trapper's best guess of total cats at site"
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Estimate Strip — only shown when we have a previous estimate */}
            {estimatedCatCount != null && estimatedCatCount > 0 && (
              <div
                style={{
                  padding: "12px 16px",
                  background: "#fef3c7",
                  border: "1px solid #fbbf24",
                  borderRadius: "8px",
                  marginBottom: "16px",
                }}
              >
                <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "8px", color: "#92400e" }}>
                  Remaining Cats Estimate
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", fontSize: "0.85rem" }}>
                  <span>Previous: <strong>{estimatedCatCount}</strong></span>
                  <span style={{ color: "#92400e" }}>-</span>
                  <span>Trapped: <strong>{catsTrapped}</strong></span>
                  <span style={{ color: "#92400e" }}>=</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 500, whiteSpace: "nowrap" }}>Remaining:</label>
                  <input
                    type="number"
                    min="0"
                    value={remainingEstimate}
                    onChange={(e) =>
                      setRemainingEstimate(e.target.value === "" ? "" : parseInt(e.target.value) || 0)
                    }
                    style={{ ...inputStyle, width: "80px", textAlign: "center", fontWeight: 600 }}
                  />
                </div>
                {/* Confidence selector */}
                <div style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 500, display: "block", marginBottom: "4px" }}>Confidence</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {CONFIDENCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setEstimateConfidence(opt.value)}
                        style={{
                          padding: "4px 10px",
                          background: estimateConfidence === opt.value ? "#f59e0b" : "white",
                          color: estimateConfidence === opt.value ? "white" : "#78716c",
                          border: `1px solid ${estimateConfidence === opt.value ? "#f59e0b" : "#d6d3d1"}`,
                          borderRadius: "16px",
                          fontSize: "0.75rem",
                          cursor: "pointer",
                          fontWeight: estimateConfidence === opt.value ? 600 : 400,
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Update request checkbox */}
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={updateRequestEstimate}
                    onChange={(e) => setUpdateRequestEstimate(e.target.checked)}
                    style={{ width: "16px", height: "16px" }}
                  />
                  Update request cat count to {remainingEstimate === "" ? "..." : remainingEstimate}
                </label>
              </div>
            )}

            {/* More Sessions Needed */}
            <div style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>More sessions needed?</label>
              <div style={{ display: "flex", gap: "6px" }}>
                {MORE_SESSIONS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMoreSessionsNeeded(opt.value)}
                    style={{
                      padding: "6px 14px",
                      background: moreSessionsNeeded === opt.value ? "var(--primary)" : "var(--section-bg)",
                      color: moreSessionsNeeded === opt.value ? "white" : "inherit",
                      border: `1px solid ${moreSessionsNeeded === opt.value ? "var(--primary)" : "var(--border)"}`,
                      borderRadius: "20px",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      fontWeight: moreSessionsNeeded === opt.value ? 600 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Issues */}
            <div style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>Issues Encountered</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {ISSUE_OPTIONS.map((issue) => (
                  <button
                    key={issue.value}
                    type="button"
                    onClick={() => toggleIssue(issue.value)}
                    style={{
                      padding: "6px 12px",
                      background: issues.includes(issue.value)
                        ? "var(--warning-bg)"
                        : "var(--section-bg)",
                      border: `1px solid ${
                        issues.includes(issue.value) ? "var(--warning-border)" : "var(--border)"
                      }`,
                      borderRadius: "20px",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      color: issues.includes(issue.value) ? "var(--warning-text)" : "inherit",
                    }}
                  >
                    {issue.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Issue Details */}
            {issues.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Issue Details</label>
                <textarea
                  value={issueDetails}
                  onChange={(e) => setIssueDetails(e.target.value)}
                  placeholder="Describe the issues..."
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>
            )}

            {/* Site Notes */}
            <div style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>Site Notes</label>
              <textarea
                value={siteNotes}
                onChange={(e) => setSiteNotes(e.target.value)}
                placeholder="Any observations or notes about the site..."
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            {/* Final Visit Toggle */}
            <div
              style={{
                marginBottom: "16px",
                padding: "12px",
                background: isFinal ? "var(--success-bg)" : "var(--section-bg)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <input
                type="checkbox"
                id="is-final"
                checked={isFinal}
                onChange={(e) => setIsFinal(e.target.checked)}
                style={{ width: "18px", height: "18px" }}
              />
              <label
                htmlFor="is-final"
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  color: isFinal ? "var(--success-text)" : "inherit",
                  cursor: "pointer",
                }}
              >
                This is the final visit for this request
              </label>
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  padding: "10px 12px",
                  background: "var(--danger-bg)",
                  color: "var(--danger-text)",
                  borderRadius: "8px",
                  fontSize: "0.85rem",
                  marginBottom: "16px",
                }}
              >
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                width: "100%",
                padding: "14px",
                background: isSubmitting
                  ? "#9ca3af"
                  : isFinal
                  ? "var(--success-text)"
                  : "var(--primary)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting
                ? "Submitting..."
                : isFinal
                ? "Submit Final Report"
                : "Submit Trip Report"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

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
