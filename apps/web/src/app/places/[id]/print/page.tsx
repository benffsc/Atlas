"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface PlacePrint {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  created_at: string;
  updated_at: string;
  cats: Array<{
    cat_id: string;
    cat_name: string;
    relationship_type: string;
  }> | null;
  people: Array<{
    person_id: string;
    person_name: string;
    role: string;
  }> | null;
  place_relationships: Array<{
    place_id: string;
    place_name: string;
    relationship_type: string;
    relationship_label: string;
  }> | null;
  cat_count: number;
  person_count: number;
}

export default function PlacePrintPage() {
  const params = useParams();
  const id = params.id as string;

  const [place, setPlace] = useState<PlacePrint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlace() {
      try {
        const response = await fetch(`/api/places/${id}`);
        if (!response.ok) throw new Error("Failed to load place");
        const data = await response.json();
        setPlace(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading place");
      } finally {
        setLoading(false);
      }
    }
    fetchPlace();
  }, [id]);

  useEffect(() => {
    if (place && !loading) {
      setTimeout(() => window.print(), 500);
    }
  }, [place, loading]);

  if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "red" }}>{error}</div>;
  if (!place) return <div style={{ padding: "2rem" }}>Place not found</div>;

  const placeKindLabels: Record<string, string> = {
    residential_house: "Residential House",
    apartment_unit: "Apartment Unit",
    apartment_building: "Apartment Building",
    business: "Business",
    clinic: "Clinic",
    neighborhood: "Neighborhood",
    outdoor_site: "Outdoor Site",
    unknown: "Unknown",
  };

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
          <h1 style={{ margin: 0, fontSize: "20px" }}>{place.display_name}</h1>
          {place.formatted_address && place.formatted_address !== place.display_name && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "11px" }}>
              {place.formatted_address}
            </p>
          )}
          <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "10px" }}>
            ID: {place.place_id}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          {place.place_kind && place.place_kind !== "unknown" && (
            <div style={{
              display: "inline-block",
              padding: "0.25rem 0.5rem",
              background: "#6c757d",
              color: "#fff",
              fontSize: "10px"
            }}>
              {placeKindLabels[place.place_kind] || place.place_kind}
            </div>
          )}
        </div>
      </div>

      {/* Two column layout */}
      <div style={{ display: "flex", gap: "1.5rem" }}>
        {/* Left column */}
        <div style={{ flex: 1 }}>
          {/* Location Details */}
          <Section title="Location Details">
            <Row label="Address" value={place.formatted_address} />
            <Row label="City" value={place.locality} />
            <Row label="State" value={place.state_province} />
            <Row label="Postal Code" value={place.postal_code} />
            {place.coordinates && (
              <Row
                label="Coordinates"
                value={`${place.coordinates.lat.toFixed(6)}, ${place.coordinates.lng.toFixed(6)}`}
                mono
              />
            )}
            <Row
              label="Geocoded"
              value={place.is_address_backed ? "Yes (Google verified)" : "Approximate"}
            />
          </Section>

          {/* Activity Summary */}
          <Section title="Activity Summary">
            <Row label="Associated Cats" value={place.cat_count.toString()} />
            <Row label="Associated People" value={place.person_count.toString()} />
            <Row
              label="Cat Activity"
              value={place.has_cat_activity ? "Active" : "None"}
            />
          </Section>

          {/* Metadata */}
          <Section title="Record Info">
            <Row label="Created" value={new Date(place.created_at).toLocaleDateString()} />
            <Row label="Updated" value={new Date(place.updated_at).toLocaleDateString()} />
          </Section>
        </div>

        {/* Right column */}
        <div style={{ flex: 1 }}>
          {/* Associated Cats */}
          <Section title="Associated Cats">
            {place.cats && place.cats.length > 0 ? (
              place.cats.map(cat => (
                <div key={cat.cat_id} style={{ marginBottom: "0.5rem" }}>
                  <div style={{ fontWeight: 500 }}>{cat.cat_name}</div>
                  <div style={{ fontSize: "10px", color: "#666" }}>
                    {cat.relationship_type.replace(/_/g, " ")}
                  </div>
                </div>
              ))
            ) : (
              <p style={{ margin: 0, color: "#666" }}>No cats associated</p>
            )}
          </Section>

          {/* Associated People */}
          <Section title="Associated People">
            {place.people && place.people.length > 0 ? (
              place.people.map(person => (
                <div key={person.person_id} style={{ marginBottom: "0.5rem" }}>
                  <div style={{ fontWeight: 500 }}>{person.person_name}</div>
                  <div style={{ fontSize: "10px", color: "#666" }}>
                    {person.role.replace(/_/g, " ")}
                  </div>
                </div>
              ))
            ) : (
              <p style={{ margin: 0, color: "#666" }}>No people associated</p>
            )}
          </Section>

          {/* Related Places */}
          {place.place_relationships && place.place_relationships.length > 0 && (
            <Section title="Related Places">
              {place.place_relationships.map(rel => (
                <div key={rel.place_id} style={{ marginBottom: "0.5rem" }}>
                  <div style={{ fontWeight: 500 }}>{rel.place_name}</div>
                  <div style={{ fontSize: "10px", color: "#666" }}>
                    {rel.relationship_label}
                  </div>
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>

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
  mono
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", marginBottom: "0.25rem" }}>
      <span style={{ width: "100px", color: "#666", flexShrink: 0 }}>{label}:</span>
      <span style={{
        fontWeight: 500,
        fontFamily: mono ? "monospace" : "inherit"
      }}>
        {value || "—"}
      </span>
    </div>
  );
}
