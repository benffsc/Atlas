"use client";

import { useState, useEffect } from "react";

interface RedirectRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  originalSummary: string;
  originalAddress: string | null;
  originalRequesterName: string | null;
  onSuccess?: (newRequestId: string) => void;
}

const REDIRECT_REASONS = [
  { value: "different_address", label: "Cats are at a different address" },
  { value: "different_contact", label: "Different person is responsible" },
  { value: "location_changed", label: "Colony location changed" },
  { value: "duplicate_area", label: "Duplicate - combine with existing request" },
  { value: "property_access", label: "Cannot access original property" },
  { value: "other", label: "Other reason" },
];

export function RedirectRequestModal({
  isOpen,
  onClose,
  requestId,
  originalSummary,
  originalAddress,
  originalRequesterName,
  onSuccess,
}: RedirectRequestModalProps) {
  const [redirectReason, setRedirectReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newRequesterName, setNewRequesterName] = useState("");
  const [newRequesterPhone, setNewRequesterPhone] = useState("");
  const [newRequesterEmail, setNewRequesterEmail] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [estimatedCatCount, setEstimatedCatCount] = useState<number | "">("");

  // Kitten assessment state
  const [hasKittens, setHasKittens] = useState(false);
  const [kittenCount, setKittenCount] = useState<number | "">("");
  const [kittenAgeWeeks, setKittenAgeWeeks] = useState<number | "">("");
  const [kittenAssessmentStatus, setKittenAssessmentStatus] = useState("");
  const [kittenAssessmentOutcome, setKittenAssessmentOutcome] = useState("");
  const [kittenNotNeededReason, setKittenNotNeededReason] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setRedirectReason("");
      setCustomReason("");
      setNewAddress("");
      setNewRequesterName("");
      setNewRequesterPhone("");
      setNewRequesterEmail("");
      setSummary("");
      setNotes("");
      setEstimatedCatCount("");
      setHasKittens(false);
      setKittenCount("");
      setKittenAgeWeeks("");
      setKittenAssessmentStatus("");
      setKittenAssessmentOutcome("");
      setKittenNotNeededReason("");
      setError("");
      setSuccess(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (!redirectReason) {
      setError("Please select a redirect reason");
      return;
    }

    if (redirectReason === "other" && !customReason.trim()) {
      setError("Please provide a custom reason");
      return;
    }

    if (!newAddress.trim()) {
      setError("Please enter the new address");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/requests/${requestId}/redirect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_reason:
            redirectReason === "other"
              ? customReason
              : REDIRECT_REASONS.find((r) => r.value === redirectReason)?.label,
          new_address: newAddress,
          new_requester_name: newRequesterName || null,
          new_requester_phone: newRequesterPhone || null,
          new_requester_email: newRequesterEmail || null,
          summary: summary || null,
          notes: notes || null,
          estimated_cat_count: estimatedCatCount === "" ? null : estimatedCatCount,
          // Kitten assessment fields
          has_kittens: hasKittens,
          kitten_count: kittenCount === "" ? null : kittenCount,
          kitten_age_weeks: kittenAgeWeeks === "" ? null : kittenAgeWeeks,
          kitten_assessment_status: kittenAssessmentStatus || null,
          kitten_assessment_outcome: kittenAssessmentOutcome || null,
          kitten_not_needed_reason: kittenNotNeededReason || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to redirect request");
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
        onSuccess?.(data.new_request_id);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to redirect request");
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
          maxWidth: "550px",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>
              Redirect Request
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
              Create a new request and close this one
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "var(--muted)",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Original Request Info */}
        <div
          style={{
            padding: "12px 24px",
            background: "var(--section-bg, #f8f9fa)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "4px" }}>
            Original Request
          </div>
          <div style={{ fontSize: "0.9rem" }}>
            {originalSummary || "No summary"}
          </div>
          {originalAddress && (
            <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "2px" }}>
              {originalAddress}
            </div>
          )}
          {originalRequesterName && (
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Contact: {originalRequesterName}
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px" }}>
          {/* Redirect Reason */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Why are you redirecting this request? *
            </label>
            <select
              value={redirectReason}
              onChange={(e) => setRedirectReason(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
            >
              <option value="">Select a reason...</option>
              {REDIRECT_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom reason if "other" selected */}
          {redirectReason === "other" && (
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Describe the reason *
              </label>
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Enter the redirect reason"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
          )}

          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" }} />

          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px" }}>
            New Request Details
          </h3>

          {/* New Address */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              New Address *
            </label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="Enter the correct address"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
            />
          </div>

          {/* New Contact Info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Contact Name
              </label>
              <input
                type="text"
                value={newRequesterName}
                onChange={(e) => setNewRequesterName(e.target.value)}
                placeholder="Name"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Phone
              </label>
              <input
                type="tel"
                value={newRequesterPhone}
                onChange={(e) => setNewRequesterPhone(e.target.value)}
                placeholder="Phone number"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={newRequesterEmail}
              onChange={(e) => setNewRequesterEmail(e.target.value)}
              placeholder="Email address"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
            />
          </div>

          {/* Cat Count & Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
                title="Adult cats at this location that still need spay/neuter (not kittens, not total colony)"
              >
                Adult Cats Needing TNR
              </label>
              <input
                type="number"
                min="0"
                value={estimatedCatCount}
                onChange={(e) =>
                  setEstimatedCatCount(e.target.value === "" ? "" : parseInt(e.target.value))
                }
                placeholder="#"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
              <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "4px" }}>
                Adults only - kittens below
              </div>
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Summary
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Brief summary for new request"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
          </div>

          {/* Kitten Assessment */}
          <div style={{ marginBottom: "16px", padding: "12px", background: "var(--card-bg, #f8f9fa)", borderRadius: "8px", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: hasKittens ? "12px" : "0" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasKittens}
                  onChange={(e) => setHasKittens(e.target.checked)}
                />
                <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Has Kittens (under 8 weeks)</span>
              </label>
            </div>

            {hasKittens && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px" }}>
                    Count
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={kittenCount}
                    onChange={(e) => setKittenCount(e.target.value === "" ? "" : parseInt(e.target.value))}
                    placeholder="#"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      background: "var(--input-bg, #fff)",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px" }}>
                    Age (weeks)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="8"
                    value={kittenAgeWeeks}
                    onChange={(e) => setKittenAgeWeeks(e.target.value === "" ? "" : parseInt(e.target.value))}
                    placeholder="0-8"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      background: "var(--input-bg, #fff)",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px" }}>
                    Assessment Status
                  </label>
                  <select
                    value={kittenAssessmentStatus}
                    onChange={(e) => setKittenAssessmentStatus(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      background: "var(--input-bg, #fff)",
                    }}
                  >
                    <option value="">Not assessed</option>
                    <option value="not_needed">Assessment not needed</option>
                    <option value="pending">Pending</option>
                    <option value="assessed">Assessed</option>
                    <option value="placed">Placed in foster</option>
                  </select>
                </div>
                {kittenAssessmentStatus === "not_needed" && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "0.8rem",
                        fontWeight: 500,
                        color: "var(--text-secondary)",
                      }}
                    >
                      Reason not needed
                    </label>
                    <input
                      type="text"
                      value={kittenNotNeededReason}
                      onChange={(e) => setKittenNotNeededReason(e.target.value)}
                      placeholder="e.g., Kittens already 8+ weeks, TNR candidates"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                      }}
                    />
                    <p style={{ fontSize: "0.7rem", color: "#666", marginTop: "4px" }}>
                      Can be changed later if circumstances change
                    </p>
                  </div>
                )}
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, marginBottom: "4px" }}>
                    Outcome
                  </label>
                  <select
                    value={kittenAssessmentOutcome}
                    onChange={(e) => setKittenAssessmentOutcome(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      background: "var(--input-bg, #fff)",
                    }}
                  >
                    <option value="">Not decided</option>
                    <option value="tnr_candidate">TNR candidate (8+ weeks)</option>
                    <option value="foster_intake">Foster intake</option>
                    <option value="pending_space">Pending foster space</option>
                    <option value="declined">Declined</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Additional Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context about the redirect..."
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
                resize: "vertical",
              }}
            />
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div
              style={{
                padding: "10px 14px",
                background: "#fee2e2",
                color: "#b91c1c",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "0.9rem",
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              style={{
                padding: "10px 14px",
                background: "#dcfce7",
                color: "#166534",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "0.9rem",
              }}
            >
              Request redirected successfully! Redirecting to new request...
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: "10px 20px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                background: "transparent",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || success}
              style={{
                padding: "10px 20px",
                border: "none",
                borderRadius: "8px",
                background: "var(--primary, #2563eb)",
                color: "#fff",
                cursor: "pointer",
                fontSize: "0.9rem",
                opacity: isSubmitting || success ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Redirecting..." : "Create New Request & Close Original"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
