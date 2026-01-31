"use client";

import { useState, useEffect, useRef } from "react";
import PlaceResolver from "@/components/PlaceResolver";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";

interface HandoffRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  originalSummary: string;
  originalAddress: string | null;
  originalRequesterName: string | null;
  onSuccess?: (newRequestId: string) => void;
}

interface PersonSearchResult {
  entity_id: string;
  entity_type: "person";
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

const HANDOFF_REASONS = [
  { value: "caretaker_moving", label: "Original caretaker is moving" },
  { value: "new_caretaker", label: "New person taking over colony care" },
  { value: "cats_relocated", label: "Cats are being relocated to new site" },
  { value: "neighbor_takeover", label: "Neighbor assuming responsibility" },
  { value: "health_reasons", label: "Original caretaker cannot continue (health/personal)" },
  { value: "other", label: "Other reason" },
];

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

  // Person search state
  const [personSearch, setPersonSearch] = useState("");
  const [personResults, setPersonResults] = useState<PersonSearchResult[]>([]);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PersonSearchResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Manual entry fields (used when no person selected)
  const [newRequesterFirstName, setNewRequesterFirstName] = useState("");
  const [newRequesterLastName, setNewRequesterLastName] = useState("");
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setHandoffReason("");
      setCustomReason("");
      setResolvedPlace(null);
      setPersonSearch("");
      setPersonResults([]);
      setSelectedPerson(null);
      setNewRequesterFirstName("");
      setNewRequesterLastName("");
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

  const searchPeople = async (query: string) => {
    if (query.length < 2) {
      setPersonResults([]);
      setShowResults(false);
      return;
    }
    setSearchingPeople(true);
    setShowResults(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=person&limit=8`);
      if (response.ok) {
        const data = await response.json();
        setPersonResults(data.results || []);
      }
    } catch (err) {
      console.error("Failed to search people:", err);
    } finally {
      setSearchingPeople(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setPersonSearch(value);
    setSelectedPerson(null); // Clear selection when typing

    // Debounce search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      searchPeople(value);
    }, 300);
  };

  const handleSelectPerson = (person: PersonSearchResult) => {
    setSelectedPerson(person);
    setPersonSearch(person.display_name);
    setShowResults(false);

    // Auto-fill fields from selected person
    setNewRequesterFirstName(person.first_name || "");
    setNewRequesterLastName(person.last_name || "");
    setNewRequesterPhone(person.phone || "");
    setNewRequesterEmail(person.email || "");
  };

  const clearSelection = () => {
    setSelectedPerson(null);
    setPersonSearch("");
    setNewRequesterFirstName("");
    setNewRequesterLastName("");
    setNewRequesterPhone("");
    setNewRequesterEmail("");
  };

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

    if (!resolvedPlace) {
      setError("Please select the new caretaker's address");
      return;
    }

    // Need either a selected person or first+last name
    if (!selectedPerson && (!newRequesterFirstName.trim() || !newRequesterLastName.trim())) {
      setError("Please search for an existing person or enter their first and last name");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/requests/${requestId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoff_reason:
            handoffReason === "other"
              ? customReason
              : HANDOFF_REASONS.find((r) => r.value === handoffReason)?.label,
          new_address: resolvedPlace?.formatted_address || resolvedPlace?.display_name || "",
          new_place_id: resolvedPlace?.place_id || null,
          // If person selected, pass their ID; otherwise pass name fields
          existing_person_id: selectedPerson?.entity_id || null,
          new_requester_first_name: newRequesterFirstName || null,
          new_requester_last_name: newRequesterLastName || null,
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
        throw new Error(data.error || "Failed to hand off request");
      }

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

          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px", color: "#0d9488" }}>
            New Caretaker Details
          </h3>

          {/* Person Search */}
          <div style={{ marginBottom: "16px" }} ref={searchContainerRef}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Search for Existing Person
            </label>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                value={personSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => personResults.length > 0 && setShowResults(true)}
                placeholder="Type a name to search..."
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  paddingRight: selectedPerson ? "36px" : "12px",
                  border: `1px solid ${selectedPerson ? "#0d9488" : "var(--border)"}`,
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: selectedPerson ? "#f0fdfa" : "var(--input-bg, #fff)",
                }}
              />
              {selectedPerson && (
                <button
                  type="button"
                  onClick={clearSelection}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#666",
                    fontSize: "1.2rem",
                    lineHeight: 1,
                  }}
                >
                  &times;
                </button>
              )}

              {/* Search Results Dropdown */}
              {showResults && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "var(--card-bg, #fff)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    marginTop: "4px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    zIndex: 10,
                    maxHeight: "200px",
                    overflow: "auto",
                  }}
                >
                  {searchingPeople ? (
                    <div style={{ padding: "12px", color: "var(--muted)", fontSize: "0.9rem" }}>
                      Searching...
                    </div>
                  ) : personResults.length > 0 ? (
                    personResults.map((person) => (
                      <div
                        key={person.entity_id}
                        onClick={() => handleSelectPerson(person)}
                        style={{
                          padding: "10px 12px",
                          cursor: "pointer",
                          borderBottom: "1px solid var(--border)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f0fdfa")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>
                          {person.display_name}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          {[person.email, person.phone, person.address]
                            .filter(Boolean)
                            .join(" • ")}
                        </div>
                      </div>
                    ))
                  ) : personSearch.length >= 2 ? (
                    <div style={{ padding: "12px", color: "var(--muted)", fontSize: "0.9rem" }}>
                      No people found. Enter details below to create new.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            {selectedPerson && (
              <div style={{ marginTop: "6px", fontSize: "0.8rem", color: "#0d9488" }}>
                Selected existing person - fields auto-filled below
              </div>
            )}
          </div>

          {/* First Name / Last Name */}
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
                First Name *
              </label>
              <input
                type="text"
                value={newRequesterFirstName}
                onChange={(e) => setNewRequesterFirstName(e.target.value)}
                placeholder="First name"
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
                Last Name *
              </label>
              <input
                type="text"
                value={newRequesterLastName}
                onChange={(e) => setNewRequesterLastName(e.target.value)}
                placeholder="Last name"
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

          {/* Contact Info */}
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
            <div>
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
              disabled={isSubmitting || success}
              style={{
                padding: "10px 20px",
                border: "none",
                borderRadius: "8px",
                background: "#0d9488",
                color: "#fff",
                cursor: "pointer",
                fontSize: "0.9rem",
                opacity: isSubmitting || success ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Handing Off..." : "Hand Off to New Caretaker"}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
