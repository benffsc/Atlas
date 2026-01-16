"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface RequestPrint {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  cats_are_friendly: boolean | null;
  preferred_contact_method: string | null;
  scheduled_date: string | null;
  scheduled_time_range: string | null;
  created_at: string;
  // Location
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  // Requester
  requester_name: string | null;
  requester_phone: string | null;
  requester_email: string | null;
  // Enhanced intake
  permission_status: string | null;
  property_owner_contact: string | null;
  access_notes: string | null;
  traps_overnight_safe: boolean | null;
  access_without_contact: boolean | null;
  property_type: string | null;
  colony_duration: string | null;
  location_description: string | null;
  eartip_count: number | null;
  is_being_fed: boolean | null;
  feeder_name: string | null;
  feeding_schedule: string | null;
  best_times_seen: string | null;
  urgency_reasons: string[] | null;
  urgency_deadline: string | null;
  // Linked cats
  cats: Array<{
    cat_id: string;
    cat_name: string;
    microchip: string | null;
  }> | null;
  // Kitten info
  kitten_count: number | null;
  kitten_age_weeks: number | null;
}

export default function RequestPrintPage() {
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<RequestPrint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRequest() {
      try {
        const response = await fetch(`/api/requests/${id}`);
        if (!response.ok) throw new Error("Failed to load request");
        const data = await response.json();
        setRequest(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading request");
      } finally {
        setLoading(false);
      }
    }
    fetchRequest();
  }, [id]);

  useEffect(() => {
    // Auto-print when loaded
    if (request && !loading) {
      setTimeout(() => window.print(), 500);
    }
  }, [request, loading]);

  if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "red" }}>{error}</div>;
  if (!request) return <div style={{ padding: "2rem" }}>Request not found</div>;

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
          <h1 style={{ margin: 0, fontSize: "18px" }}>TNR Request</h1>
          <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "10px" }}>
            ID: {request.request_id}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            display: "inline-block",
            padding: "0.25rem 0.5rem",
            background: "#000",
            color: "#fff",
            fontSize: "11px",
            fontWeight: "bold"
          }}>
            {request.status.toUpperCase().replace(/_/g, " ")}
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "10px" }}>
            Priority: {request.priority.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Two column layout */}
      <div style={{ display: "flex", gap: "1.5rem" }}>
        {/* Left column */}
        <div style={{ flex: 1 }}>
          {/* Location Section */}
          <Section title="Location">
            <Row label="Address" value={request.place_address} />
            <Row label="City" value={request.place_city} />
            <Row label="Postal Code" value={request.place_postal_code} />
            {request.location_description && (
              <Row label="Description" value={request.location_description} />
            )}
            {request.property_type && (
              <Row label="Property Type" value={request.property_type.replace(/_/g, " ")} />
            )}
          </Section>

          {/* Requester Section */}
          <Section title="Requester">
            <Row label="Name" value={request.requester_name} />
            <Row label="Phone" value={request.requester_phone} />
            <Row label="Email" value={request.requester_email} />
            {request.preferred_contact_method && (
              <Row label="Preferred Contact" value={request.preferred_contact_method} />
            )}
          </Section>

          {/* Cat Information */}
          <Section title="Cat Information">
            <Row label="Estimated Count" value={request.estimated_cat_count?.toString()} />
            <Row label="Has Kittens" value={request.has_kittens ? "Yes" : "No"} />
            {request.has_kittens && request.kitten_count && (
              <Row label="Kitten Count" value={request.kitten_count.toString()} />
            )}
            {request.has_kittens && request.kitten_age_weeks && (
              <Row label="Kitten Age" value={`${request.kitten_age_weeks} weeks`} />
            )}
            <Row label="Cats Friendly" value={
              request.cats_are_friendly === true ? "Yes" :
              request.cats_are_friendly === false ? "No" : "Unknown"
            } />
            {request.eartip_count !== null && request.eartip_count > 0 && (
              <Row label="Already Eartipped" value={request.eartip_count.toString()} />
            )}
            {request.colony_duration && (
              <Row label="Colony Duration" value={request.colony_duration.replace(/_/g, " ")} />
            )}
          </Section>
        </div>

        {/* Right column */}
        <div style={{ flex: 1 }}>
          {/* Access & Logistics */}
          <Section title="Access & Logistics">
            <Row label="Permission Status" value={request.permission_status?.replace(/_/g, " ")} />
            {request.property_owner_contact && (
              <Row label="Owner Contact" value={request.property_owner_contact} />
            )}
            <Row label="Traps Safe Overnight" value={
              request.traps_overnight_safe === true ? "Yes" :
              request.traps_overnight_safe === false ? "No" : "Unknown"
            } />
            <Row label="Access w/o Contact" value={
              request.access_without_contact === true ? "Yes" :
              request.access_without_contact === false ? "No" : "Unknown"
            } />
            {request.best_times_seen && (
              <Row label="Best Times Seen" value={request.best_times_seen} />
            )}
            {request.access_notes && (
              <Row label="Access Notes" value={request.access_notes} />
            )}
          </Section>

          {/* Feeding Info */}
          {(request.is_being_fed || request.feeder_name) && (
            <Section title="Feeding">
              <Row label="Being Fed" value={request.is_being_fed ? "Yes" : "No"} />
              {request.feeder_name && <Row label="Feeder" value={request.feeder_name} />}
              {request.feeding_schedule && <Row label="Schedule" value={request.feeding_schedule} />}
            </Section>
          )}

          {/* Schedule */}
          <Section title="Schedule">
            <Row label="Scheduled Date" value={
              request.scheduled_date
                ? new Date(request.scheduled_date).toLocaleDateString()
                : "Not scheduled"
            } />
            {request.scheduled_time_range && (
              <Row label="Time Range" value={request.scheduled_time_range} />
            )}
            <Row label="Created" value={new Date(request.created_at).toLocaleDateString()} />
          </Section>

          {/* Urgency */}
          {request.urgency_reasons && request.urgency_reasons.length > 0 && (
            <Section title="Urgency">
              <Row label="Reasons" value={request.urgency_reasons.map(r => r.replace(/_/g, " ")).join(", ")} />
              {request.urgency_deadline && (
                <Row label="Deadline" value={new Date(request.urgency_deadline).toLocaleDateString()} />
              )}
            </Section>
          )}
        </div>
      </div>

      {/* Linked Cats */}
      {request.cats && request.cats.length > 0 && (
        <Section title="Linked Cats">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #000" }}>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Name</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0" }}>Microchip</th>
              </tr>
            </thead>
            <tbody>
              {request.cats.map(cat => (
                <tr key={cat.cat_id} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "0.25rem 0" }}>{cat.cat_name}</td>
                  <td style={{ padding: "0.25rem 0", fontFamily: "monospace" }}>
                    {cat.microchip || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Request Title */}
      {request.summary && (
        <Section title="Request Title">
          <p style={{ margin: 0 }}>{request.summary}</p>
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
        <span>Printed from Atlas - FFSC TNR Management</span>
        <span>{new Date().toLocaleString()}</span>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { margin: 0; }
          @page { margin: 0.5in; }
        }
        @media screen {
          body { background: #f0f0f0; }
          div:first-child {
            background: white;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
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
      <span style={{ width: "120px", color: "#666", flexShrink: 0 }}>{label}:</span>
      <span style={{ fontWeight: 500 }}>{value || "—"}</span>
    </div>
  );
}
