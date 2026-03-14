"use client";

import { useState, useEffect } from "react";
import { PlaceResolver } from "@/components/forms";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { fetchApi, postApi } from "@/lib/api-client";
import { PersonSection } from "@/components/request-sections";
import type { PersonSectionValue } from "@/components/request-sections";
import { HANDOFF_REASON, HANDOFF_REASON_LABELS, PERSON_PLACE_ROLE } from "@/lib/enums";

interface HandoffRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  originalSummary: string;
  originalAddress: string | null;
  originalRequesterName: string | null;
  onSuccess?: (newRequestId: string) => void;
}

const HANDOFF_REASONS = HANDOFF_REASON.map((value) => ({
  value,
  label: HANDOFF_REASON_LABELS[value],
}));

const PERSON_ROLE_OPTIONS = PERSON_PLACE_ROLE.map((value) => ({
  value,
  label: value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
}));

export function HandoffRequestModal({
  isOpen,
  onClose,
  requestId,
  originalSummary,
  originalAddress,
  originalRequesterName,
  onSuccess,
}: HandoffRequestModalProps) {
  const [handoffReason, setHandoffReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | null>(null);

  // Person selection via PersonSection
  const [personValue, setPersonValue] = useState<PersonSectionValue>({
    person_id: null,
    display_name: "",
    is_resolved: false,
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });

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

  // New person's relationship to property
  const [newPersonRole, setNewPersonRole] = useState("");
  const [isPropertyOwner, setIsPropertyOwner] = useState<boolean | null>(null);
  const [newPersonIsSiteContact, setNewPersonIsSiteContact] = useState(true);

  // Link to existing request state
  const [linkToExisting, setLinkToExisting] = useState(false);
  const [targetRequestId, setTargetRequestId] = useState<string | null>(null);
  const [targetRequest, setTargetRequest] = useState<{ request_id: string; summary: string | null; place_address: string | null; requester_name: string | null; status: string } | null>(null);
  const [requestSearchQuery, setRequestSearchQuery] = useState("");
  const [requestSearchResults, setRequestSearchResults] = useState<{ request_id: string; summary: string | null; place_address: string | null; requester_name: string | null; status: string; created_at: string }[]>([]);
  const [searchingRequests, setSearchingRequests] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setHandoffReason("");
      setCustomReason("");
      setResolvedPlace(null);
      setPersonValue({ person_id: null, display_name: "", is_resolved: false, first_name: "", last_name: "", email: "", phone: "" });
      setSummary("");
      setNotes("");
      setEstimatedCatCount("");
      setHasKittens(false);
      setKittenCount("");
      setKittenAgeWeeks("");
      setKittenAssessmentStatus("");
      setKittenAssessmentOutcome("");
      setKittenNotNeededReason("");
      setNewPersonRole("");
      setIsPropertyOwner(null);
      setNewPersonIsSiteContact(true);
      setLinkToExisting(false);
      setTargetRequestId(null);
      setTargetRequest(null);
      setRequestSearchQuery("");
      setRequestSearchResults([]);
      setSearchingRequests(false);
      setError("");
      setSuccess(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Debounced request search for "Link to Existing" mode
  useEffect(() => {
    if (!linkToExisting || requestSearchQuery.length < 2) {
      setRequestSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingRequests(true);
      try {
        const data = await fetchApi<typeof requestSearchResults>(`/api/requests/search?q=${encodeURIComponent(requestSearchQuery)}&exclude=${requestId}`);
        setRequestSearchResults(data);
      } catch { /* optional: request search is best-effort autocomplete */ }
      setSearchingRequests(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [requestSearchQuery, linkToExisting, requestId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (!handoffReason) {
      setError("Please select a handoff reason");
      return;
    }

    if (handoffReason === "other" && !customReason.trim()) {
      setError("Please provide a custom reason");
      return;
    }

    if (linkToExisting) {
      if (!targetRequestId) {
        setError("Please select an existing request to link to");
        return;
      }
    } else {
      if (!resolvedPlace) {
        setError("Please select the new caretaker's address");
        return;
      }

      // Need either a resolved person or first+last name
      if (!personValue.is_resolved && (!personValue.first_name.trim() || !personValue.last_name.trim())) {
        setError("Please search for an existing person, create a new one, or enter their first and last name");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const data = await postApi<{ new_request_id: string }>(`/api/requests/${requestId}/handoff`, {
        handoff_reason:
          handoffReason === "other"
            ? customReason
            : HANDOFF_REASONS.find((r) => r.value === handoffReason)?.label,
        existing_target_request_id: linkToExisting ? targetRequestId : undefined,
        new_address: resolvedPlace?.formatted_address || resolvedPlace?.display_name || "",
        new_place_id: resolvedPlace?.place_id || null,
        // If person resolved (via search or inline create), pass their ID
        existing_person_id: personValue.person_id || null,
        new_requester_first_name: personValue.first_name || null,
        new_requester_last_name: personValue.last_name || null,
        new_requester_phone: personValue.phone || null,
        new_requester_email: personValue.email || null,
        summary: summary || null,
        notes: notes || null,
        estimated_cat_count: estimatedCatCount === "" ? null : estimatedCatCount,
        // Person role & property context
        new_person_role: newPersonRole || null,
        is_property_owner: isPropertyOwner,
        new_person_is_site_contact: newPersonIsSiteContact,
        // Kitten assessment fields
        has_kittens: hasKittens,
        kitten_count: kittenCount === "" ? null : kittenCount,
        kitten_age_weeks: kittenAgeWeeks === "" ? null : kittenAgeWeeks,
        kitten_assessment_status: kittenAssessmentStatus || null,
        kitten_assessment_outcome: kittenAssessmentOutcome || null,
        kitten_not_needed_reason: kittenNotNeededReason || null,
      });

      setSuccess(true);
      setTimeout(() => {
        onClose();
        onSuccess?.(data.new_request_id);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to hand off request");
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
            background: "linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)",
            borderRadius: "12px 12px 0 0",
            color: "#fff",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>
              Hand Off Request
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.85rem", opacity: 0.9 }}>
              Transfer responsibility to a new caretaker
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "#fff",
              lineHeight: 1,
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
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
            Current Request
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
              Current caretaker: {originalRequesterName}
            </div>
          )}
        </div>

        {/* Info Banner */}
        <div
          style={{
            padding: "12px 24px",
            background: "#f0fdfa",
            borderBottom: "1px solid #99f6e4",
            fontSize: "0.85rem",
            color: "#0f766e",
          }}
        >
          <strong>Note:</strong> This will close the current request and create a new one
          for the new caretaker. Both requests will be linked together.
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px" }}>
          {/* Handoff Reason */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Why is this being handed off? *
            </label>
            <select
              value={handoffReason}
              onChange={(e) => setHandoffReason(e.target.value)}
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
              {HANDOFF_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom reason if "other" selected */}
          {handoffReason === "other" && (
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
                placeholder="Enter the handoff reason"
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

          {/* Mode toggle: Create new vs Link to existing */}
          <div style={{ display: "flex", gap: "8px", margin: "16px 0" }}>
            <button
              type="button"
              onClick={() => { setLinkToExisting(false); setTargetRequestId(null); setTargetRequest(null); setRequestSearchQuery(""); }}
              style={{
                flex: 1, padding: "8px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                background: !linkToExisting ? "#0d9488" : "transparent",
                color: !linkToExisting ? "#fff" : "#0d9488",
                border: `1px solid #0d9488`,
              }}
            >
              Create New Request
            </button>
            <button
              type="button"
              onClick={() => setLinkToExisting(true)}
              style={{
                flex: 1, padding: "8px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                background: linkToExisting ? "#0d9488" : "transparent",
                color: linkToExisting ? "#fff" : "#0d9488",
                border: `1px solid #0d9488`,
              }}
            >
              Link to Existing
            </button>
          </div>

          {!linkToExisting && (
          <>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px", color: "#0d9488" }}>
            New Caretaker Details
          </h3>

          {/* Person search, name, contact, dedup — via PersonSection */}
          <PersonSection
            role="caretaker"
            value={personValue}
            onChange={setPersonValue}
            allowCreate
            compact
            required
            onAddressSelected={(addr) => setResolvedPlace({
              place_id: addr.place_id,
              display_name: addr.formatted_address,
              formatted_address: addr.formatted_address,
              locality: null,
            })}
          />

          {/* Warning: no person record will be created without contact info */}
          {!personValue.is_resolved && !personValue.phone.trim() && !personValue.email.trim() && (personValue.first_name.trim() || personValue.last_name.trim()) && (
            <div
              style={{
                padding: "10px 14px",
                background: "#fffbeb",
                border: "1px solid #fcd34d",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "0.85rem",
                color: "#92400e",
              }}
            >
              <strong>No phone or email:</strong> Without contact info, no person record will be linked to this request.
              The handoff will still work, but the new caretaker won&apos;t be trackable in the system.
              Add a phone or email if available.
            </div>
          )}

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
              New Location/Address *
            </label>
            <PlaceResolver
              value={resolvedPlace}
              onChange={setResolvedPlace}
              placeholder="Start typing an address..."
            />
          </div>

          {/* Person Role & Property Context */}
          <div style={{ marginBottom: "16px", padding: "12px", background: "var(--card-bg, #f8f9fa)", borderRadius: "8px", border: "1px solid var(--border)" }}>
            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                New person&apos;s relationship to the property
              </label>
              <select
                value={newPersonRole}
                onChange={(e) => {
                  setNewPersonRole(e.target.value);
                  if (e.target.value === "owner" || e.target.value === "landlord") {
                    setIsPropertyOwner(true);
                  } else {
                    setIsPropertyOwner(null);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              >
                <option value="">Select role...</option>
                {PERSON_ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            {newPersonRole && newPersonRole !== "owner" && newPersonRole !== "landlord" && (
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "8px" }}>
                <input
                  type="checkbox"
                  checked={isPropertyOwner === true}
                  onChange={(e) => setIsPropertyOwner(e.target.checked)}
                />
                <span style={{ fontSize: "0.85rem" }}>This person is the property owner</span>
              </label>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={newPersonIsSiteContact}
                onChange={(e) => setNewPersonIsSiteContact(e.target.checked)}
              />
              <span style={{ fontSize: "0.85rem" }}>This person is the on-site contact for trapping</span>
            </label>
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
              placeholder="Any additional context about the handoff..."
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
          </>
          )}

          {linkToExisting && (
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
                Search for existing request
              </label>
              {!targetRequest ? (
                <>
                  <input
                    type="text"
                    value={requestSearchQuery}
                    onChange={(e) => setRequestSearchQuery(e.target.value)}
                    placeholder="Search by address, summary, or requester name..."
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "13px" }}
                  />
                  {searchingRequests && <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>Searching...</div>}
                  {requestSearchResults.length > 0 && (
                    <div style={{ marginTop: "8px", maxHeight: "240px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {requestSearchResults.map((r) => (
                        <button
                          key={r.request_id}
                          type="button"
                          onClick={() => { setTargetRequestId(r.request_id); setTargetRequest(r); setRequestSearchResults([]); }}
                          style={{
                            textAlign: "left", padding: "10px 12px", background: "#f9fafb", border: "1px solid #e5e7eb",
                            borderRadius: "8px", cursor: "pointer", fontSize: "12px",
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "2px" }}>{r.summary || "Untitled request"}</div>
                          {r.place_address && <div style={{ color: "#6b7280" }}>{r.place_address}</div>}
                          <div style={{ color: "#9ca3af", marginTop: "2px" }}>
                            {r.requester_name && <span>{r.requester_name} &middot; </span>}
                            <span style={{
                              padding: "1px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 600,
                              background: r.status === "in_progress" ? "#dbeafe" : r.status === "new" ? "#fef3c7" : "#f3f4f6",
                              color: r.status === "in_progress" ? "#1d4ed8" : r.status === "new" ? "#92400e" : "#374151",
                            }}>{r.status}</span>
                            <span> &middot; {new Date(r.created_at).toLocaleDateString()}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {requestSearchQuery.length >= 2 && !searchingRequests && requestSearchResults.length === 0 && (
                    <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>No matching requests found</div>
                  )}
                </>
              ) : (
                <div style={{ padding: "12px", background: "#f0fdfa", border: "1px solid #99f6e4", borderRadius: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "13px" }}>{targetRequest.summary || "Untitled request"}</div>
                      {targetRequest.place_address && <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>{targetRequest.place_address}</div>}
                      {targetRequest.requester_name && <div style={{ fontSize: "12px", color: "#6b7280" }}>{targetRequest.requester_name}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setTargetRequestId(null); setTargetRequest(null); setRequestSearchQuery(""); }}
                      style={{ background: "none", border: "none", color: "#0d9488", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}
                    >
                      Change
                    </button>
                  </div>
                </div>
              )}

              {/* Property context for linked request */}
              <div style={{ marginTop: "12px", padding: "10px", background: "var(--card-bg, #f8f9fa)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "6px" }}>
                  <input
                    type="checkbox"
                    checked={isPropertyOwner === true}
                    onChange={(e) => setIsPropertyOwner(e.target.checked)}
                  />
                  <span style={{ fontSize: "0.85rem" }}>Property owner is now the requester</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={newPersonIsSiteContact}
                    onChange={(e) => setNewPersonIsSiteContact(e.target.checked)}
                  />
                  <span style={{ fontSize: "0.85rem" }}>Requester is the on-site contact</span>
                </label>
              </div>

              {/* Optional notes */}
              <div style={{ marginTop: "12px" }}>
                <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any additional context for the handoff..."
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "13px", resize: "vertical" }}
                />
              </div>
            </div>
          )}

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
                background: "#d1fae5",
                color: "#065f46",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "0.9rem",
              }}
            >
              Request handed off successfully! Redirecting to new request...
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
              disabled={isSubmitting || success || (linkToExisting && !targetRequestId)}
              style={{
                padding: "10px 20px",
                border: "none",
                borderRadius: "8px",
                background: "#0d9488",
                color: "#fff",
                cursor: "pointer",
                fontSize: "0.9rem",
                opacity: isSubmitting || success || (linkToExisting && !targetRequestId) ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Handing Off..." : linkToExisting ? "Link & Hand Off" : "Hand Off to New Caretaker"}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
