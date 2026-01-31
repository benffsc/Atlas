"use client";

import { useState, useEffect } from "react";
import { formatDateLocal } from "@/lib/formatters";
import { BackButton } from "@/components/BackButton";
import { useParams } from "next/navigation";

interface PartnerOrg {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  org_name_patterns: string[];
  org_type: string;
  place_id: string | null;
  facility_address: string | null;
  address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  relationship_type: string;
  is_active: boolean;
  appointments_count: number;
  cats_processed: number;
  first_appointment_date: string | null;
  last_appointment_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const ORG_TYPE_COLORS: Record<string, string> = {
  shelter: "#dc3545",
  rescue: "#198754",
  clinic: "#0d6efd",
  municipal: "#6f42c1",
  partner: "#fd7e14",
  other: "#6c757d",
};

export default function PartnerOrgDetailPage() {
  const params = useParams();
  const orgId = params.id as string;

  const [org, setOrg] = useState<PartnerOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/partner-orgs/${orgId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !data.error) {
          setOrg(data);
          setEditNotes(data.notes || "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/partner-orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: editNotes }),
      });
      if (res.ok) {
        setOrg((prev) => prev ? { ...prev, notes: editNotes } : null);
        setEditing(false);
      }
    } catch {
      alert("Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading organization...</div>;
  if (!org) return <div className="empty">Organization not found</div>;

  return (
    <div>
      <BackButton fallbackHref="/admin/partner-orgs" />

      <div style={{ marginTop: "1rem" }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          {org.org_name}
          {org.org_name_short && (
            <span style={{ fontSize: "0.6em", color: "var(--text-muted)", fontWeight: 400 }}>
              ({org.org_name_short})
            </span>
          )}
          <span
            className="badge"
            style={{
              fontSize: "0.5em",
              background: ORG_TYPE_COLORS[org.org_type] || "#6c757d",
            }}
          >
            {org.org_type}
          </span>
          {!org.is_active && (
            <span className="badge" style={{ fontSize: "0.5em", background: "#dc3545" }}>
              Inactive
            </span>
          )}
        </h1>
      </div>

      {/* Stats Row */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div className="card" style={{ padding: "1rem", textAlign: "center", flex: "1 1 140px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#0d6efd" }}>
            {org.appointments_count}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Appointments</div>
        </div>
        <div className="card" style={{ padding: "1rem", textAlign: "center", flex: "1 1 140px" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#198754" }}>
            {org.cats_processed}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Cats Processed</div>
        </div>
        <div className="card" style={{ padding: "1rem", textAlign: "center", flex: "1 1 140px" }}>
          <div style={{ fontSize: "1rem", fontWeight: 600 }}>
            {org.first_appointment_date ? formatDateLocal(org.first_appointment_date) : "--"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>First Appointment</div>
        </div>
        <div className="card" style={{ padding: "1rem", textAlign: "center", flex: "1 1 140px" }}>
          <div style={{ fontSize: "1rem", fontWeight: 600 }}>
            {org.last_appointment_date ? formatDateLocal(org.last_appointment_date) : "--"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Last Appointment</div>
        </div>
      </div>

      {/* Details Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.5rem" }}>
        {/* Contact Info */}
        <div className="card" style={{ padding: "1.25rem" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem" }}>Contact Information</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem" }}>
            {org.contact_name && (
              <div><strong>Contact:</strong> {org.contact_name}</div>
            )}
            {org.contact_email && (
              <div><strong>Email:</strong> <a href={`mailto:${org.contact_email}`}>{org.contact_email}</a></div>
            )}
            {org.contact_phone && (
              <div><strong>Phone:</strong> {org.contact_phone}</div>
            )}
            {org.website && (
              <div><strong>Website:</strong> <a href={org.website} target="_blank" rel="noopener noreferrer">{org.website}</a></div>
            )}
            {(org.facility_address || org.address) && (
              <div><strong>Address:</strong> {org.facility_address || org.address}</div>
            )}
            {org.place_id && (
              <div>
                <a href={`/places/${org.place_id}`} style={{ fontSize: "0.85rem" }}>
                  View linked place
                </a>
              </div>
            )}
            {!org.contact_name && !org.contact_email && !org.contact_phone && (
              <div className="text-muted">No contact information on file</div>
            )}
          </div>
        </div>

        {/* Organization Details */}
        <div className="card" style={{ padding: "1.25rem" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem" }}>Organization Details</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem" }}>
            <div><strong>Relationship:</strong> {org.relationship_type}</div>
            <div><strong>Status:</strong> {org.is_active ? "Active" : "Inactive"}</div>
            {org.org_name_patterns && org.org_name_patterns.length > 0 && (
              <div>
                <strong>Name Patterns:</strong>
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                  {org.org_name_patterns.map((p, i) => (
                    <span key={i} style={{
                      fontSize: "0.75rem",
                      padding: "2px 6px",
                      background: "var(--card-bg)",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      fontFamily: "monospace",
                    }}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
              Created: {formatDateLocal(org.created_at)}
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="card" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Notes</h3>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.8rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <div>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={4}
              style={{ width: "100%", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button
                onClick={handleSaveNotes}
                disabled={saving}
                className="btn btn-primary"
                style={{ fontSize: "0.85rem" }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => { setEditing(false); setEditNotes(org.notes || ""); }}
                style={{
                  padding: "0.25rem 0.75rem",
                  fontSize: "0.85rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, color: org.notes ? "inherit" : "var(--text-muted)", whiteSpace: "pre-wrap" }}>
            {org.notes || "No notes"}
          </p>
        )}
      </div>
    </div>
  );
}
