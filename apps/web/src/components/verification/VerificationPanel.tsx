"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import RoleSelector, { RelationshipType } from "./RoleSelector";
import VerificationStatusBadge from "./VerificationStatusBadge";
import FinancialCommitmentBadge, { FINANCIAL_COMMITMENTS, FinancialCommitment } from "./FinancialCommitmentBadge";

interface PlaceForPerson {
  person_place_id: string;
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  relationship_type: string;
  is_staff_verified: boolean;
  verified_at: string | null;
  verification_method: string | null;
  financial_commitment: string | null;
  is_primary_contact: boolean;
  source_system: string;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
}

interface VerificationPanelProps {
  personId: string;
  personName?: string;
  onVerify?: (personPlaceId: string) => void;
}

export default function VerificationPanel({
  personId,
  personName,
  onVerify,
}: VerificationPanelProps) {
  const [places, setPlaces] = useState<PlaceForPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    verified: number;
    unverified: number;
    by_type: Record<string, number>;
  } | null>(null);

  useEffect(() => {
    fetchPlaces();
  }, [personId]);

  const fetchPlaces = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/people/${personId}/places`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to fetch places");
        return;
      }

      setPlaces(data.places || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError("Failed to fetch places");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (
    personPlaceId: string,
    currentType: string,
    financialCommitment?: string,
    notes?: string
  ) => {
    setVerifyingId(personPlaceId);
    try {
      const response = await fetch(`/api/person-place/${personPlaceId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verification_method: "ui_button",
          relationship_type: currentType,
          financial_commitment: financialCommitment || null,
          notes: notes || null,
        }),
      });

      if (response.ok) {
        await fetchPlaces();
        setExpandedId(null);
        onVerify?.(personPlaceId);
      }
    } catch (err) {
      console.error("Verification failed:", err);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleRoleChange = async (personPlaceId: string, newRole: RelationshipType) => {
    try {
      const response = await fetch(`/api/person-place/${personPlaceId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationship_type: newRole }),
      });

      if (response.ok) {
        setPlaces(prev => prev.map(p =>
          p.person_place_id === personPlaceId
            ? { ...p, relationship_type: newRole }
            : p
        ));
      }
    } catch (err) {
      console.error("Role update failed:", err);
    }
  };

  const getPlaceDisplayName = (place: PlaceForPerson) => {
    if (place.display_name) return place.display_name;
    if (place.formatted_address) return place.formatted_address;
    return "Unknown Location";
  };

  if (loading) {
    return (
      <div style={{ padding: "1rem", background: "var(--card-bg, #fff)", borderRadius: "8px", border: "1px solid var(--border)" }}>
        <div style={{ color: "var(--muted)" }}>Loading places...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "1rem", background: "var(--card-bg, #fff)", borderRadius: "8px", border: "1px solid var(--border)" }}>
        <div style={{ color: "#ef4444" }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--card-bg, #fff)", borderRadius: "8px", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div style={{ padding: "1rem", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
            Verification Status
          </h3>
          {summary && (
            <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.85rem" }}>
              <span style={{ color: "#10b981" }}>{summary.verified} verified</span>
              <span style={{ color: "var(--muted)" }}>·</span>
              <span style={{ color: "#d97706" }}>{summary.unverified} unverified</span>
            </div>
          )}
        </div>
        {personName && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            Places for {personName}
          </div>
        )}
      </div>

      {/* Places List */}
      {places.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No places associated with this person
        </div>
      ) : (
        <div>
          {places.map((place, idx) => (
            <div
              key={place.person_place_id}
              style={{
                borderBottom: idx < places.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              {/* Main row */}
              <div
                style={{
                  padding: "0.75rem 1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
                {/* Primary indicator */}
                {place.is_primary_contact && (
                  <span title="Primary Address" style={{ color: "#3b82f6" }}>★</span>
                )}

                {/* Place info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <Link
                      href={`/places/${place.place_id}`}
                      style={{ fontWeight: 500, color: "inherit", textDecoration: "none" }}
                    >
                      {getPlaceDisplayName(place)}
                    </Link>
                    <VerificationStatusBadge
                      isVerified={place.is_staff_verified}
                      verifiedAt={place.verified_at}
                      verificationMethod={place.verification_method}
                      size="sm"
                    />
                    {place.financial_commitment && (
                      <FinancialCommitmentBadge commitment={place.financial_commitment} size="sm" />
                    )}
                  </div>
                  {place.formatted_address && place.display_name && (
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      {place.formatted_address}
                    </div>
                  )}
                </div>

                {/* Role selector */}
                <RoleSelector
                  value={place.relationship_type}
                  onChange={(newRole) => handleRoleChange(place.person_place_id, newRole)}
                  size="sm"
                />

                {/* Verify button or expand button */}
                {!place.is_staff_verified && (
                  <button
                    onClick={() => setExpandedId(expandedId === place.person_place_id ? null : place.person_place_id)}
                    style={{
                      padding: "0.25rem 0.75rem",
                      background: expandedId === place.person_place_id ? "#f3f4f6" : "#10b981",
                      color: expandedId === place.person_place_id ? "#374151" : "#fff",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {expandedId === place.person_place_id ? "Cancel" : "Verify"}
                  </button>
                )}
              </div>

              {/* Expanded verification form */}
              {expandedId === place.person_place_id && (
                <VerificationForm
                  personPlaceId={place.person_place_id}
                  currentType={place.relationship_type}
                  onVerify={handleVerify}
                  verifying={verifyingId === place.person_place_id}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline verification form component
function VerificationForm({
  personPlaceId,
  currentType,
  onVerify,
  verifying,
}: {
  personPlaceId: string;
  currentType: string;
  onVerify: (id: string, type: string, financial?: string, notes?: string) => void;
  verifying: boolean;
}) {
  const [selectedType, setSelectedType] = useState(currentType);
  const [financialCommitment, setFinancialCommitment] = useState<string>("");
  const [notes, setNotes] = useState("");

  return (
    <div
      style={{
        padding: "1rem",
        background: "var(--muted-bg, #f9fafb)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {/* Role selection */}
        <div>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 500 }}>
            Relationship Type
          </label>
          <RoleSelector
            value={selectedType}
            onChange={setSelectedType}
            showDescription
            size="md"
          />
        </div>

        {/* Financial commitment */}
        <div>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 500 }}>
            Financial Commitment (optional)
          </label>
          <select
            value={financialCommitment}
            onChange={(e) => setFinancialCommitment(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontSize: "0.9rem",
            }}
          >
            <option value="">Select if known...</option>
            {Object.entries(FINANCIAL_COMMITMENTS).map(([key, info]) => (
              <option key={key} value={key}>
                {info.label} - {info.description}
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem", fontWeight: 500 }}>
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional context about this relationship..."
            rows={2}
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontSize: "0.9rem",
              resize: "vertical",
            }}
          />
        </div>

        {/* Submit button */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => onVerify(personPlaceId, selectedType, financialCommitment || undefined, notes || undefined)}
            disabled={verifying}
            style={{
              padding: "0.5rem 1rem",
              background: verifying ? "#9ca3af" : "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: verifying ? "not-allowed" : "pointer",
            }}
          >
            {verifying ? "Verifying..." : "Confirm Verification"}
          </button>
        </div>
      </div>
    </div>
  );
}
