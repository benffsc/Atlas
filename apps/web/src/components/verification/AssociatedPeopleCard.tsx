"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";
import RoleSelector, { RELATIONSHIP_TYPES, RelationshipType } from "./RoleSelector";
import VerificationStatusBadge from "./VerificationStatusBadge";
import FinancialCommitmentBadge from "./FinancialCommitmentBadge";

interface PersonAtPlace {
  person_place_id: string;
  person_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  relationship_type: string;
  is_staff_verified: boolean;
  verified_at: string | null;
  verification_method: string | null;
  financial_commitment: string | null;
  is_primary_contact: boolean;
  cat_count: number;
  source_system: string;
  created_at: string;
}

interface AssociatedPeopleCardProps {
  placeId: string;
  placeName?: string;
  onVerify?: (personPlaceId: string) => void;
}

export default function AssociatedPeopleCard({
  placeId,
  placeName,
  onVerify,
}: AssociatedPeopleCardProps) {
  const [people, setPeople] = useState<PersonAtPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ total: number; verified: number; unverified: number } | null>(null);

  useEffect(() => {
    fetchPeople();
  }, [placeId]);

  const fetchPeople = async () => {
    try {
      setLoading(true);
      const data = await fetchApi<{
        people: PersonAtPlace[];
        summary: { total: number; verified: number; unverified: number } | null;
      }>(`/api/places/${placeId}/people`);

      setPeople(data.people || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch people");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (personPlaceId: string, currentType: string) => {
    setVerifyingId(personPlaceId);
    try {
      await postApi(`/api/person-place/${personPlaceId}/verify`, {
        verification_method: "ui_button",
        relationship_type: currentType,
      });

      // Refresh the list
      await fetchPeople();
      onVerify?.(personPlaceId);
    } catch (err) {
      console.error("Verification failed:", err);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleRoleChange = async (personPlaceId: string, newRole: RelationshipType) => {
    try {
      await postApi(`/api/person-place/${personPlaceId}/role`, {
        relationship_type: newRole,
      }, { method: "PATCH" });

      // Update local state
      setPeople(prev => prev.map(p =>
        p.person_place_id === personPlaceId
          ? { ...p, relationship_type: newRole }
          : p
      ));
    } catch (err) {
      console.error("Role update failed:", err);
    }
  };

  const getPersonDisplayName = (person: PersonAtPlace) => {
    if (person.display_name) return person.display_name;
    if (person.first_name && person.last_name) return `${person.first_name} ${person.last_name}`;
    if (person.first_name) return person.first_name;
    return "Unknown";
  };

  if (loading) {
    return (
      <div style={{ padding: "1rem", background: "var(--card-bg, #fff)", borderRadius: "8px", border: "1px solid var(--border)" }}>
        <div style={{ color: "var(--muted)" }}>Loading people...</div>
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
            Associated People
          </h3>
          {summary && (
            <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.85rem" }}>
              <span style={{ color: "#10b981" }}>{summary.verified} verified</span>
              <span style={{ color: "var(--muted)" }}>·</span>
              <span style={{ color: "#d97706" }}>{summary.unverified} unverified</span>
            </div>
          )}
        </div>
        {placeName && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            {placeName}
          </div>
        )}
      </div>

      {/* People List */}
      {people.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No people associated with this place
        </div>
      ) : (
        <div>
          {people.map((person, idx) => (
            <div
              key={person.person_place_id}
              style={{
                padding: "0.75rem 1rem",
                borderBottom: idx < people.length - 1 ? "1px solid var(--border)" : "none",
                display: "flex",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              {/* Primary contact indicator */}
              {person.is_primary_contact && (
                <span title="Primary Contact" style={{ color: "#3b82f6" }}>★</span>
              )}

              {/* Person info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <Link
                    href={`/people/${person.person_id}`}
                    style={{ fontWeight: 500, color: "inherit", textDecoration: "none" }}
                  >
                    {getPersonDisplayName(person)}
                  </Link>
                  <VerificationStatusBadge
                    isVerified={person.is_staff_verified}
                    verifiedAt={person.verified_at}
                    verificationMethod={person.verification_method}
                    size="sm"
                  />
                  {person.financial_commitment && (
                    <FinancialCommitmentBadge commitment={person.financial_commitment} size="sm" />
                  )}
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  {person.cat_count > 0 && <span>{person.cat_count} cat{person.cat_count !== 1 ? "s" : ""} · </span>}
                  <span>{person.source_system}</span>
                </div>
              </div>

              {/* Role selector */}
              <RoleSelector
                value={person.relationship_type}
                onChange={(newRole) => handleRoleChange(person.person_place_id, newRole)}
                size="sm"
              />

              {/* Verify button */}
              {!person.is_staff_verified && (
                <button
                  onClick={() => handleVerify(person.person_place_id, person.relationship_type)}
                  disabled={verifyingId === person.person_place_id}
                  style={{
                    padding: "0.25rem 0.75rem",
                    background: verifyingId === person.person_place_id ? "#9ca3af" : "#10b981",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    cursor: verifyingId === person.person_place_id ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {verifyingId === person.person_place_id ? "..." : "Verify"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
