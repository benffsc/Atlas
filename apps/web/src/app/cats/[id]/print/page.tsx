"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface CatPrint {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  ownership_type: string | null;
  identifiers: Array<{ type: string; value: string }> | null;
  owners: Array<{
    person_id: string;
    display_name: string;
    role: string;
  }> | null;
  places: Array<{
    place_id: string;
    label: string;
    place_kind: string | null;
  }> | null;
  tests: Array<{
    test_type: string;
    test_date: string;
    result: string;
  }> | null;
  procedures: Array<{
    procedure_type: string;
    procedure_date: string;
    is_spay: boolean;
    is_neuter: boolean;
  }> | null;
  vitals: Array<{
    recorded_at: string;
    weight_lbs: number | null;
  }> | null;
  first_visit_date: string | null;
  total_visits: number;
  created_at: string;
}

export default function CatPrintPage() {
  const params = useParams();
  const id = params.id as string;

  const [cat, setCat] = useState<CatPrint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCat() {
      try {
        const response = await fetch(`/api/cats/${id}`);
        if (!response.ok) throw new Error("Failed to load cat");
        const data = await response.json();
        setCat(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading cat");
      } finally {
        setLoading(false);
      }
    }
    fetchCat();
  }, [id]);

  useEffect(() => {
    if (cat && !loading) {
      setTimeout(() => window.print(), 500);
    }
  }, [cat, loading]);

  if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "red" }}>{error}</div>;
  if (!cat) return <div style={{ padding: "2rem" }}>Cat not found</div>;

  const latestVital = cat.vitals?.[0];
  const felvFivTest = cat.tests?.find(t => t.test_type === "felv_fiv");
  const spayNeuterProc = cat.procedures?.find(p => p.is_spay || p.is_neuter);

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
          <h1 style={{ margin: 0, fontSize: "20px" }}>{cat.display_name}</h1>
          <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "10px" }}>
            ID: {cat.cat_id}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          {cat.ownership_type && (
            <div style={{
              display: "inline-block",
              padding: "0.25rem 0.5rem",
              background: cat.ownership_type.toLowerCase().includes("community") ? "#dc3545" : "#0d6efd",
              color: "#fff",
              fontSize: "10px"
            }}>
              {cat.ownership_type}
            </div>
          )}
        </div>
      </div>

      {/* Two column layout */}
      <div style={{ display: "flex", gap: "1.5rem" }}>
        {/* Left column */}
        <div style={{ flex: 1 }}>
          {/* Basic Info */}
          <Section title="Basic Information">
            <Row label="Sex" value={cat.sex || "Unknown"} />
            <Row label="Altered" value={cat.altered_status || "Unknown"} />
            <Row label="Breed" value={cat.breed || "Unknown"} />
            <Row label="Color" value={cat.color || "Unknown"} />
            {cat.coat_pattern && <Row label="Pattern" value={cat.coat_pattern} />}
            {latestVital?.weight_lbs && (
              <Row label="Weight" value={`${latestVital.weight_lbs} lbs`} />
            )}
          </Section>

          {/* Identifiers */}
          <Section title="Identifiers">
            <Row label="Microchip" value={cat.microchip} highlight />
            {cat.identifiers?.filter(i => i.type !== "microchip").map((ident, idx) => (
              <Row key={idx} label={ident.type} value={ident.value} />
            ))}
          </Section>

          {/* Medical Status */}
          <Section title="Medical Status">
            <Row
              label="FeLV/FIV"
              value={felvFivTest
                ? `${felvFivTest.result.toUpperCase()} (${new Date(felvFivTest.test_date).toLocaleDateString()})`
                : "Not tested"
              }
            />
            <Row
              label="Spay/Neuter"
              value={spayNeuterProc
                ? `${spayNeuterProc.is_spay ? "Spayed" : "Neutered"} (${new Date(spayNeuterProc.procedure_date).toLocaleDateString()})`
                : cat.altered_status === "Yes" ? "Yes (pre-existing)" : "Not on record"
              }
            />
          </Section>
        </div>

        {/* Right column */}
        <div style={{ flex: 1 }}>
          {/* Owners/People */}
          <Section title="Associated People">
            {cat.owners && cat.owners.length > 0 ? (
              cat.owners.map(owner => (
                <Row
                  key={owner.person_id}
                  label={owner.role}
                  value={owner.display_name}
                />
              ))
            ) : (
              <p style={{ margin: 0, color: "#666" }}>No people associated</p>
            )}
          </Section>

          {/* Places */}
          <Section title="Associated Places">
            {cat.places && cat.places.length > 0 ? (
              cat.places.map(place => (
                <Row
                  key={place.place_id}
                  label={place.place_kind || "Location"}
                  value={place.label}
                />
              ))
            ) : (
              <p style={{ margin: 0, color: "#666" }}>No places associated</p>
            )}
          </Section>

          {/* Clinic History */}
          <Section title="Clinic History">
            <Row label="First Visit" value={
              cat.first_visit_date
                ? new Date(cat.first_visit_date).toLocaleDateString()
                : "No visits"
            } />
            <Row label="Total Visits" value={cat.total_visits.toString()} />
            <Row label="Record Created" value={new Date(cat.created_at).toLocaleDateString()} />
          </Section>
        </div>
      </div>

      {/* Test Results Table */}
      {cat.tests && cat.tests.length > 0 && (
        <Section title="Test Results">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #000" }}>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Date</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Test</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {cat.tests.map((test, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "0.25rem 0" }}>
                    {new Date(test.test_date).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "0.25rem 0" }}>{test.test_type.replace(/_/g, " ")}</td>
                  <td style={{
                    padding: "0.25rem 0",
                    fontWeight: "bold",
                    color: test.result === "negative" ? "#198754" : test.result === "positive" ? "#dc3545" : "inherit"
                  }}>
                    {test.result.toUpperCase()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Procedures Table */}
      {cat.procedures && cat.procedures.length > 0 && (
        <Section title="Procedures">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #000" }}>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Date</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Procedure</th>
              </tr>
            </thead>
            <tbody>
              {cat.procedures.map((proc, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "0.25rem 0" }}>
                    {new Date(proc.procedure_date).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "0.25rem 0" }}>
                    {proc.procedure_type.replace(/_/g, " ")}
                  </td>
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

function Row({
  label,
  value,
  highlight
}: {
  label: string;
  value: string | null | undefined;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: "flex", marginBottom: "0.25rem" }}>
      <span style={{ width: "100px", color: "#666", flexShrink: 0 }}>{label}:</span>
      <span style={{
        fontWeight: highlight ? "bold" : 500,
        fontFamily: highlight ? "monospace" : "inherit"
      }}>
        {value || "—"}
      </span>
    </div>
  );
}
