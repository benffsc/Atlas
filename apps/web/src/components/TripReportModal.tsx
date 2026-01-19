"use client";

import { useState, useEffect } from "react";

interface TripReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  trapperPersonId: string;
  trapperName: string;
  isFinalVisit?: boolean;
  onSuccess?: () => void;
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

export function TripReportModal({
  isOpen,
  onClose,
  requestId,
  trapperPersonId,
  trapperName,
  isFinalVisit = false,
  onSuccess,
}: TripReportModalProps) {
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
  const [success, setSuccess] = useState(false);

  // Reset isFinal when modal opens with isFinalVisit prop
  useEffect(() => {
    if (isOpen) {
      setIsFinal(isFinalVisit);
    }
  }, [isOpen, isFinalVisit]);

  const toggleIssue = (issueValue: string) => {
    setIssues((prev) =>
      prev.includes(issueValue)
        ? prev.filter((i) => i !== issueValue)
        : [...prev, issueValue]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/requests/${requestId}/trip-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trapper_person_id: trapperPersonId,
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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit report");
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
        onSuccess?.();
        // Reset form
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
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report");
    } finally {
      setIsSubmitting(false);
    }
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
              {isFinal ? "Final Trip Report" : "Trip Report"}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              {trapperName}
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

        {success ? (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "12px" }}>
              Report Submitted!
            </div>
            <div style={{ color: "var(--muted)" }}>
              {isFinal
                ? "Final report recorded. Request can now be completed."
                : "Trip report recorded successfully."}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: "20px" }}>
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
