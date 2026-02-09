"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Org {
  id: string;
  name: string;
  short_name: string | null;
  org_type: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  place_id: string | null;
  facility_address: string | null;
  name_patterns: string[];
  aliases: string[];
  is_active: boolean;
  appointments_count: number;
  cats_count: number;
  first_appointment_date: string | null;
  last_appointment_date: string | null;
  notes: string | null;
}

interface OrgType {
  type_code: string;
  display_name: string;
}

interface Stats {
  total_orgs: number;
  active_orgs: number;
  orgs_with_place: number;
  orgs_with_patterns: number;
  total_linked_appointments: number;
  total_linked_cats: number;
}

const ORG_TYPE_COLORS: Record<string, string> = {
  shelter: "#dc3545",
  rescue: "#28a745",
  clinic: "#17a2b8",
  vet: "#6f42c1",
  municipal: "#fd7e14",
  community_group: "#20c997",
  other: "#6c757d",
};

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgTypes, setOrgTypes] = useState<OrgType[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [filterType, setFilterType] = useState<string>("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (showInactive) params.set("include_inactive", "true");
      if (filterType) params.set("type", filterType);

      const response = await fetch(`/api/admin/orgs?${params}`);
      if (response.ok) {
        const data = await response.json();
        setOrgs(data.organizations || []);
        setOrgTypes(data.org_types || []);
        setStats(data.stats || null);
      }
    } catch (err) {
      console.error("Failed to fetch organizations:", err);
    } finally {
      setLoading(false);
    }
  }, [showInactive, filterType]);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  // Group by type
  const grouped = orgs.reduce(
    (acc, org) => {
      const type = org.org_type || "other";
      if (!acc[type]) acc[type] = [];
      acc[type].push(org);
      return acc;
    },
    {} as Record<string, Org[]>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Organizations</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.875rem" }}>
            External partner organizations (shelters, rescues, clinics, community groups)
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <Link
            href="/admin/departments"
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              color: "var(--muted)",
              textDecoration: "none",
              border: "1px solid var(--border)",
              borderRadius: "6px",
            }}
          >
            FFSC Departments →
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            + Add Organization
          </button>
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <StatCard label="Total Orgs" value={stats.total_orgs} />
          <StatCard label="Active" value={stats.active_orgs} />
          <StatCard label="With Place" value={stats.orgs_with_place} />
          <StatCard label="With Patterns" value={stats.orgs_with_patterns} />
          <StatCard label="Linked Appts" value={stats.total_linked_appointments} />
          <StatCard label="Linked Cats" value={stats.total_linked_cats} />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: "0.875rem",
          }}
        >
          <option value="">All Types</option>
          {orgTypes.map((t) => (
            <option key={t.type_code} value={t.type_code}>
              {t.display_name}
            </option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>

        <span style={{ color: "var(--muted)", fontSize: "0.875rem", marginLeft: "auto" }}>
          {orgs.length} organizations
        </span>
      </div>

      {/* Org List */}
      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          Loading...
        </div>
      ) : orgs.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No organizations found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {Object.entries(grouped).map(([type, typeOrgs]) => (
            <section key={type}>
              <h3 style={{
                margin: "0 0 0.75rem",
                fontSize: "0.9rem",
                fontWeight: 500,
                color: ORG_TYPE_COLORS[type] || "var(--foreground)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}>
                <span style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: ORG_TYPE_COLORS[type] || "#6c757d",
                }} />
                {orgTypes.find((t) => t.type_code === type)?.display_name || type}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>({typeOrgs.length})</span>
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "0.75rem" }}>
                {typeOrgs.map((org) => (
                  <OrgCard key={org.id} org={org} onClick={() => setSelectedOrg(org)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedOrg && (
        <OrgDetailModal
          org={selectedOrg}
          onClose={() => setSelectedOrg(null)}
          onUpdate={fetchOrgs}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateOrgModal
          orgTypes={orgTypes}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            fetchOrgs();
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      padding: "0.75rem",
      background: "var(--card-bg, rgba(0,0,0,0.05))",
      borderRadius: "8px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function OrgCard({ org, onClick }: { org: Org; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="card"
      style={{
        padding: "1rem",
        cursor: "pointer",
        opacity: org.is_active ? 1 : 0.6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{org.name}</div>
          {org.short_name && (
            <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "monospace" }}>
              {org.short_name}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
          <span style={{
            fontSize: "0.65rem",
            padding: "0.125rem 0.375rem",
            background: ORG_TYPE_COLORS[org.org_type] || "#6c757d",
            color: "#fff",
            borderRadius: "4px",
          }}>
            {org.org_type}
          </span>
          {!org.is_active && (
            <span style={{
              fontSize: "0.65rem",
              padding: "0.125rem 0.375rem",
              background: "#6c757d",
              color: "#fff",
              borderRadius: "4px",
            }}>
              Inactive
            </span>
          )}
        </div>
      </div>

      {org.facility_address && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          {org.facility_address}
        </div>
      )}

      <div style={{ display: "flex", gap: "1rem", marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>
        <span>{org.appointments_count} appointments</span>
        {org.cats_count > 0 && <span>{org.cats_count} cats</span>}
        {org.name_patterns.length > 0 && (
          <span>{org.name_patterns.length} patterns</span>
        )}
      </div>
    </div>
  );
}

function OrgDetailModal({
  org,
  onClose,
  onUpdate,
}: {
  org: Org;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(org);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/orgs/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (response.ok) {
        setEditing(false);
        onUpdate();
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    try {
      const response = await fetch(`/api/admin/orgs/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !org.is_active }),
      });
      if (response.ok) {
        onUpdate();
        onClose();
      }
    } catch (err) {
      console.error("Failed to toggle active:", err);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--background)",
          color: "var(--foreground)",
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "85vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
          <div>
            <h2 style={{ margin: 0 }}>{org.name}</h2>
            {org.short_name && (
              <div style={{ color: "var(--muted)", fontSize: "0.875rem" }}>{org.short_name}</div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--muted)" }}>
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <span style={{
            fontSize: "0.7rem",
            padding: "0.125rem 0.5rem",
            background: ORG_TYPE_COLORS[org.org_type] || "#6c757d",
            color: "#fff",
            borderRadius: "4px",
          }}>
            {org.org_type}
          </span>
          <span style={{
            fontSize: "0.7rem",
            padding: "0.125rem 0.5rem",
            background: org.is_active ? "#28a745" : "#6c757d",
            color: "#fff",
            borderRadius: "4px",
          }}>
            {org.is_active ? "Active" : "Inactive"}
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <StatCard label="Appointments" value={org.appointments_count} />
          <StatCard label="Cats" value={org.cats_count} />
          <StatCard label="Patterns" value={org.name_patterns.length} />
        </div>

        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Short Name</label>
              <input
                value={form.short_name || ""}
                onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Email</label>
                <input
                  value={form.email || ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Phone</label>
                <input
                  value={form.phone || ""}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Website</label>
              <input
                value={form.website || ""}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Notes</label>
              <textarea
                value={form.notes || ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--primary)",
                  color: "var(--primary-foreground)",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setForm(org);
                  setEditing(false);
                }}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: "var(--background)",
                  color: "var(--foreground)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Contact Info */}
            <div style={{ marginBottom: "1.5rem" }}>
              <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>Contact</h4>
              <div style={{ fontSize: "0.875rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {org.email && <div>Email: {org.email}</div>}
                {org.phone && <div>Phone: {org.phone}</div>}
                {org.website && (
                  <div>
                    Website:{" "}
                    <a href={org.website} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>
                      {org.website}
                    </a>
                  </div>
                )}
                {!org.email && !org.phone && !org.website && (
                  <span style={{ color: "var(--muted)" }}>No contact info</span>
                )}
              </div>
            </div>

            {/* Location */}
            {org.facility_address && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>Location</h4>
                <div style={{ fontSize: "0.875rem" }}>{org.facility_address}</div>
                {org.place_id && (
                  <Link href={`/places/${org.place_id}`} style={{ fontSize: "0.8rem", color: "var(--primary)" }}>
                    View Place →
                  </Link>
                )}
              </div>
            )}

            {/* Patterns */}
            {org.name_patterns.length > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
                  Name Patterns ({org.name_patterns.length})
                </h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {org.name_patterns.map((p, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: "0.75rem",
                        padding: "0.125rem 0.5rem",
                        background: "var(--card-bg, rgba(0,0,0,0.05))",
                        borderRadius: "4px",
                        fontFamily: "monospace",
                      }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {org.notes && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>Notes</h4>
                <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>{org.notes}</div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <button
                onClick={() => setEditing(true)}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: "var(--background)",
                  color: "var(--foreground)",
                }}
              >
                Edit
              </button>
              <button
                onClick={handleToggleActive}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: "var(--background)",
                  color: "var(--foreground)",
                }}
              >
                {org.is_active ? "Deactivate" : "Activate"}
              </button>
              <button
                onClick={onClose}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: "var(--background)",
                  color: "var(--foreground)",
                  marginLeft: "auto",
                }}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CreateOrgModal({
  orgTypes,
  onClose,
  onCreated,
}: {
  orgTypes: OrgType[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    short_name: "",
    org_type: "rescue",
    email: "",
    phone: "",
    website: "",
    address: "",
    notes: "",
  });

  const handleCreate = async () => {
    if (!form.name.trim()) return;

    setSaving(true);
    try {
      const response = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (response.ok) {
        onCreated();
      }
    } catch (err) {
      console.error("Failed to create:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--background)",
          color: "var(--foreground)",
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "500px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 1rem" }}>Add Organization</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Sonoma County Animal Services"
              style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Short Name</label>
              <input
                value={form.short_name}
                onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                placeholder="e.g., SCAS"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Type *</label>
              <select
                value={form.org_type}
                onChange={(e) => setForm({ ...form, org_type: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--background)", color: "var(--foreground)" }}
              >
                {orgTypes.map((t) => (
                  <option key={t.type_code} value={t.type_code}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Address</label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Street address (will create place)"
              style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Email</label>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Website</label>
            <input
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            />
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button
              onClick={handleCreate}
              disabled={saving || !form.name.trim()}
              style={{
                padding: "0.5rem 1rem",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                opacity: saving || !form.name.trim() ? 0.5 : 1,
              }}
            >
              {saving ? "Creating..." : "Create"}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
                background: "var(--background)",
                color: "var(--foreground)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
