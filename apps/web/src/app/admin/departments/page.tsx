"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Department {
  org_id: string;
  org_code: string;
  display_name: string;
  org_type: string;
  description: string | null;
  parent_org_id: string | null;
  parent_name: string | null;
  created_at: string;
  updated_at: string;
}

interface Hierarchy {
  ffsc: Department | null;
  departments: Department[];
  teams: Department[];
}

interface Stats {
  total: number;
  departments: number;
  teams: number;
}

const ORG_TYPE_LABELS: Record<string, string> = {
  parent: "Organization",
  department: "Department",
  team: "Team",
};

const ORG_TYPE_COLORS: Record<string, string> = {
  parent: "#6f42c1",
  department: "#17a2b8",
  team: "#28a745",
};

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/departments");
      if (response.ok) {
        const data = await response.json();
        setDepartments(data.departments || []);
        setHierarchy(data.hierarchy || null);
        setStats(data.stats || null);
      }
    } catch (err) {
      console.error("Failed to fetch departments:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  // Group teams by parent department
  const teamsByDept = hierarchy?.teams.reduce(
    (acc, team) => {
      const parentId = team.parent_org_id || "none";
      if (!acc[parentId]) acc[parentId] = [];
      acc[parentId].push(team);
      return acc;
    },
    {} as Record<string, Department[]>
  ) || {};

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>FFSC Departments</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.875rem" }}>
            Forgotten Felines of Sonoma County internal structure
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <Link
            href="/admin/organizations"
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              color: "var(--muted)",
              textDecoration: "none",
              border: "1px solid var(--border)",
              borderRadius: "6px",
            }}
          >
            Organizations →
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
            + Add Department
          </button>
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.5rem", maxWidth: "450px" }}>
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Departments" value={stats.departments} />
          <StatCard label="Teams" value={stats.teams} />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          Loading...
        </div>
      ) : !hierarchy ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No departments found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* FFSC Parent */}
          {hierarchy.ffsc && (
            <div
              className="card"
              style={{
                padding: "1.25rem",
                background: "linear-gradient(135deg, var(--card-bg, rgba(111,66,193,0.1)), transparent)",
                borderLeft: `4px solid ${ORG_TYPE_COLORS.parent}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div>
                  <span style={{
                    fontSize: "0.65rem",
                    padding: "0.125rem 0.5rem",
                    background: ORG_TYPE_COLORS.parent,
                    color: "#fff",
                    borderRadius: "4px",
                    marginBottom: "0.5rem",
                    display: "inline-block",
                  }}>
                    Organization
                  </span>
                  <h2 style={{ margin: "0.25rem 0 0", fontSize: "1.25rem" }}>{hierarchy.ffsc.display_name}</h2>
                  <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "monospace" }}>
                    {hierarchy.ffsc.org_code}
                  </div>
                </div>
              </div>
              {hierarchy.ffsc.description && (
                <p style={{ margin: "0.75rem 0 0", fontSize: "0.875rem", color: "var(--muted)" }}>
                  {hierarchy.ffsc.description}
                </p>
              )}
            </div>
          )}

          {/* Departments with their teams */}
          {hierarchy.departments.length > 0 && (
            <div>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 500, color: "var(--muted)" }}>
                Departments ({hierarchy.departments.length})
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {hierarchy.departments.map((dept) => (
                  <div key={dept.org_id}>
                    <DeptCard
                      dept={dept}
                      onClick={() => setSelectedDept(dept)}
                    />
                    {/* Teams under this department */}
                    {teamsByDept[dept.org_id]?.length > 0 && (
                      <div style={{ marginLeft: "1.5rem", marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {teamsByDept[dept.org_id].map((team) => (
                          <TeamCard
                            key={team.org_id}
                            team={team}
                            onClick={() => setSelectedDept(team)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Orphan teams (no parent department) */}
          {teamsByDept["none"]?.length > 0 && (
            <div>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 500, color: "var(--muted)" }}>
                Other Teams ({teamsByDept["none"].length})
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {teamsByDept["none"].map((team) => (
                  <TeamCard
                    key={team.org_id}
                    team={team}
                    onClick={() => setSelectedDept(team)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedDept && (
        <DeptDetailModal
          dept={selectedDept}
          departments={hierarchy?.departments || []}
          onClose={() => setSelectedDept(null)}
          onUpdate={fetchDepartments}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateDeptModal
          departments={hierarchy?.departments || []}
          ffsc={hierarchy?.ffsc || null}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            fetchDepartments();
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
      <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function DeptCard({ dept, onClick }: { dept: Department; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="card"
      style={{
        padding: "1rem",
        cursor: "pointer",
        borderLeft: `3px solid ${ORG_TYPE_COLORS.department}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{dept.display_name}</div>
          <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "monospace" }}>
            {dept.org_code}
          </div>
        </div>
        <span style={{
          fontSize: "0.65rem",
          padding: "0.125rem 0.375rem",
          background: ORG_TYPE_COLORS.department,
          color: "#fff",
          borderRadius: "4px",
        }}>
          Department
        </span>
      </div>
      {dept.description && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          {dept.description}
        </div>
      )}
    </div>
  );
}

function TeamCard({ team, onClick }: { team: Department; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="card"
      style={{
        padding: "0.75rem 1rem",
        cursor: "pointer",
        borderLeft: `3px solid ${ORG_TYPE_COLORS.team}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{team.display_name}</div>
          <div style={{ color: "var(--muted)", fontSize: "0.75rem", fontFamily: "monospace" }}>
            {team.org_code}
          </div>
        </div>
        <span style={{
          fontSize: "0.6rem",
          padding: "0.125rem 0.375rem",
          background: ORG_TYPE_COLORS.team,
          color: "#fff",
          borderRadius: "4px",
        }}>
          Team
        </span>
      </div>
    </div>
  );
}

function DeptDetailModal({
  dept,
  departments,
  onClose,
  onUpdate,
}: {
  dept: Department;
  departments: Department[];
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    display_name: dept.display_name,
    description: dept.description || "",
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: dept.org_id,
          ...form,
        }),
      });
      if (response.ok) {
        setEditing(false);
        onUpdate();
        onClose();
      }
    } catch (err) {
      console.error("Failed to save:", err);
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
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "500px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
          <div>
            <span style={{
              fontSize: "0.65rem",
              padding: "0.125rem 0.5rem",
              background: ORG_TYPE_COLORS[dept.org_type] || "#6c757d",
              color: "#fff",
              borderRadius: "4px",
              marginBottom: "0.25rem",
              display: "inline-block",
            }}>
              {ORG_TYPE_LABELS[dept.org_type] || dept.org_type}
            </span>
            <h2 style={{ margin: "0.25rem 0 0" }}>{dept.display_name}</h2>
            <div style={{ color: "var(--muted)", fontSize: "0.875rem", fontFamily: "monospace" }}>
              {dept.org_code}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--muted)" }}>
            ×
          </button>
        </div>

        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Display Name</label>
              <input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                  setForm({ display_name: dept.display_name, description: dept.description || "" });
                  setEditing(false);
                }}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: "var(--background)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {dept.parent_name && (
              <div style={{ marginBottom: "1rem", fontSize: "0.875rem", color: "var(--muted)" }}>
                Part of: {dept.parent_name}
              </div>
            )}

            {dept.description && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>Description</h4>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--muted)" }}>{dept.description}</p>
              </div>
            )}

            <div style={{ marginBottom: "1rem", fontSize: "0.8rem", color: "var(--muted)" }}>
              Created: {new Date(dept.created_at).toLocaleDateString()}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <button
                onClick={() => setEditing(true)}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: "var(--background)",
                }}
              >
                Edit
              </button>
              <button
                onClick={onClose}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: "var(--background)",
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

function CreateDeptModal({
  departments,
  ffsc,
  onClose,
  onCreated,
}: {
  departments: Department[];
  ffsc: Department | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    org_code: "",
    display_name: "",
    org_type: "department" as "department" | "team",
    description: "",
    parent_org_id: "",
  });

  const handleCreate = async () => {
    if (!form.org_code.trim() || !form.display_name.trim()) return;

    setSaving(true);
    try {
      const response = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          parent_org_id: form.parent_org_id || undefined,
        }),
      });
      if (response.ok) {
        onCreated();
      } else {
        const error = await response.json();
        alert(error.error || "Failed to create");
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
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "500px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 1rem" }}>Add Department/Team</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Type *</label>
              <select
                value={form.org_type}
                onChange={(e) => setForm({ ...form, org_type: e.target.value as "department" | "team" })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--background)" }}
              >
                <option value="department">Department</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Code *</label>
              <input
                value={form.org_code}
                onChange={(e) => setForm({ ...form, org_code: e.target.value.toUpperCase() })}
                placeholder="e.g., TNR, FOSTER"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Display Name *</label>
            <input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="e.g., TNR Program, Foster Team"
              style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            />
          </div>

          {form.org_type === "team" && departments.length > 0 && (
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Parent Department</label>
              <select
                value={form.parent_org_id}
                onChange={(e) => setForm({ ...form, parent_org_id: e.target.value })}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--background)" }}
              >
                <option value="">Select parent...</option>
                {departments.map((d) => (
                  <option key={d.org_id} value={d.org_id}>
                    {d.display_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Optional description"
              style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "6px" }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button
              onClick={handleCreate}
              disabled={saving || !form.org_code.trim() || !form.display_name.trim()}
              style={{
                padding: "0.5rem 1rem",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                opacity: saving || !form.org_code.trim() || !form.display_name.trim() ? 0.5 : 1,
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
