"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { formatPhone } from "@/lib/formatters";

interface PersonPrint {
  person_id: string;
  display_name: string;
  entity_type: string | null;
  primary_address: string | null;
  primary_address_locality: string | null;
  identifiers: Array<{
    id_type: string;
    id_value: string;
    source_system: string | null;
  }> | null;
  cats: Array<{
    cat_id: string;
    cat_name: string;
    relationship_type: string;
    microchip: string | null;
  }> | null;
  places: Array<{
    place_id: string;
    place_name: string;
    formatted_address: string | null;
    role: string;
  }> | null;
  cat_count: number;
  place_count: number;
  created_at: string;
}

export default function PersonPrintPage() {
  const params = useParams();
  const id = params.id as string;

  const [person, setPerson] = useState<PersonPrint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPerson() {
      try {
        const response = await fetch(`/api/people/${id}`);
        if (!response.ok) throw new Error("Failed to load person");
        const data = await response.json();
        setPerson(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading person");
      } finally {
        setLoading(false);
      }
    }
    fetchPerson();
  }, [id]);

  useEffect(() => {
    if (person && !loading) {
      setTimeout(() => window.print(), 500);
    }
  }, [person, loading]);

  if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "red" }}>{error}</div>;
  if (!person) return <div style={{ padding: "2rem" }}>Person not found</div>;

  // Extract phone and email from identifiers
  const phones = person.identifiers?.filter(i => i.id_type === "phone") || [];
  const emails = person.identifiers?.filter(i => i.id_type === "email") || [];

  return (
    <div style={{
      fontFamily: "Arial, sans-serif",
      maxWidth: "800px",
      margin: "0 auto",
      padding: "1rem",
      fontSize: "12px",
      lineHeight: "1.4"
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "2px solid #000",
        paddingBottom: "0.5rem",
        marginBottom: "1rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start"
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "20px" }}>{person.display_name}</h1>
          <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "10px" }}>
            ID: {person.person_id}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          {person.entity_type && person.entity_type !== "person" && (
            <div style={{
              display: "inline-block",
              padding: "0.25rem 0.5rem",
              background: "#dc3545",
              color: "#fff",
              fontSize: "10px"
            }}>
              {person.entity_type.toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Two column layout */}
      <div style={{ display: "flex", gap: "1.5rem" }}>
        {/* Left column */}
        <div style={{ flex: 1 }}>
          {/* Contact Info */}
          <Section title="Contact Information">
            {phones.length > 0 ? (
              phones.map((phone, idx) => (
                <Row key={idx} label="Phone" value={formatPhone(phone.id_value)} />
              ))
            ) : (
              <Row label="Phone" value={null} />
            )}
            {emails.length > 0 ? (
              emails.map((email, idx) => (
                <Row key={idx} label="Email" value={email.id_value} />
              ))
            ) : (
              <Row label="Email" value={null} />
            )}
          </Section>

          {/* Address */}
          <Section title="Address">
            {person.primary_address ? (
              <>
                <p style={{ margin: 0, fontWeight: 500 }}>{person.primary_address}</p>
                {person.primary_address_locality && (
                  <p style={{ margin: "0.25rem 0 0", color: "#666" }}>
                    {person.primary_address_locality}
                  </p>
                )}
              </>
            ) : (
              <p style={{ margin: 0, color: "#666" }}>No address on file</p>
            )}
          </Section>

          {/* Stats */}
          <Section title="Summary">
            <Row label="Cats" value={person.cat_count.toString()} />
            <Row label="Places" value={person.place_count.toString()} />
            <Row label="Record Created" value={new Date(person.created_at).toLocaleDateString()} />
          </Section>
        </div>

        {/* Right column */}
        <div style={{ flex: 1 }}>
          {/* Associated Places */}
          <Section title="Associated Places">
            {person.places && person.places.length > 0 ? (
              person.places.map(place => (
                <div key={place.place_id} style={{ marginBottom: "0.5rem" }}>
                  <div style={{ fontWeight: 500 }}>{place.place_name}</div>
                  {place.formatted_address && (
                    <div style={{ fontSize: "10px", color: "#666" }}>
                      {place.formatted_address}
                    </div>
                  )}
                  <div style={{ fontSize: "10px", color: "#999" }}>
                    Role: {place.role}
                  </div>
                </div>
              ))
            ) : (
              <p style={{ margin: 0, color: "#666" }}>No places associated</p>
            )}
          </Section>
        </div>
      </div>

      {/* Cats Table */}
      {person.cats && person.cats.length > 0 && (
        <Section title="Associated Cats">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #000" }}>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Name</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Microchip</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Relationship</th>
              </tr>
            </thead>
            <tbody>
              {person.cats.map(cat => (
                <tr key={cat.cat_id} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "0.25rem 0" }}>{cat.cat_name}</td>
                  <td style={{ padding: "0.25rem 0", fontFamily: "monospace" }}>
                    {cat.microchip || "—"}
                  </td>
                  <td style={{ padding: "0.25rem 0" }}>{cat.relationship_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Footer */}
      <div style={{
        borderTop: "1px solid #ccc",
        marginTop: "1rem",
        paddingTop: "0.5rem",
        fontSize: "9px",
        color: "#666",
        display: "flex",
        justifyContent: "space-between"
      }}>
        <span>Printed from Atlas - FFSC FFR Management</span>
        <span>{new Date().toLocaleString()}</span>
      </div>

      <style>{`
        @media print {
          body { margin: 0; }
          @page { margin: 0.5in; }
        }
        @media screen {
          body { background: #f0f0f0; }
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <h2 style={{
        margin: "0 0 0.5rem",
        fontSize: "12px",
        fontWeight: "bold",
        borderBottom: "1px solid #ccc",
        paddingBottom: "0.25rem"
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", marginBottom: "0.25rem" }}>
      <span style={{ width: "100px", color: "#666", flexShrink: 0 }}>{label}:</span>
      <span style={{ fontWeight: 500 }}>{value || "—"}</span>
    </div>
  );
}
