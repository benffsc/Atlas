"use client";

import { useState, useEffect, useCallback } from "react";
import { formatPhone } from "@/lib/formatters";

interface Staff {
  staff_id: string;
  person_id: string | null;
  first_name: string;
  last_name: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  work_extension: string | null;
  role: string;
  department: string | null;
  is_active: boolean;
  hired_date: string | null;
  source_record_id: string | null;
  ai_access_level: string | null;
}

const DEPARTMENTS = [
  "Administration",
  "Clinic",
  "Trapping",
  "Adoptions",
  "Volunteers",
  "Marketing",
  "Other",
];

const AI_ACCESS_LEVELS = [
  { value: "none", label: "None", description: "No AI assistant access" },
  { value: "read_only", label: "Read Only", description: "Can query data, cannot create or modify" },
  { value: "read_write", label: "Read + Write", description: "Can query data and create reminders, feedback, etc." },
  { value: "full", label: "Full Access", description: "All capabilities including admin tools" },
];

export default function StaffManagementPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    work_extension: "",
    role: "",
    department: "",
    hired_date: "",
    ai_access_level: "read_only",
  });

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (showInactive) params.set("active", "false");
      if (departmentFilter) params.set("department", departmentFilter);

      const response = await fetch(`/api/staff?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setStaff(data.staff || []);
        setDepartments(data.departments || []);
      }
    } catch (err) {
      console.error("Failed to fetch staff:", err);
    } finally {
      setLoading(false);
    }
  }, [showInactive, departmentFilter]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const openEdit = (s: Staff) => {
    setSelectedStaff(s);
    setFormData({
      first_name: s.first_name,
      last_name: s.last_name || "",
      email: s.email || "",
      phone: s.phone || "",
      work_extension: s.work_extension || "",
      role: s.role,
      department: s.department || "",
      hired_date: s.hired_date || "",
      ai_access_level: s.ai_access_level || "read_only",
    });
    setEditMode(true);
  };

  const openAdd = () => {
    setFormData({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      work_extension: "",
      role: "",
      department: "",
      hired_date: "",
      ai_access_level: "read_only",
    });
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (!formData.first_name || !formData.role) {
      alert("First name and role are required");
      return;
    }

    setSaving(true);
    try {
      if (selectedStaff && editMode) {
        // Update existing
        const response = await fetch(`/api/staff/${selectedStaff.staff_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        if (response.ok) {
          setEditMode(false);
          setSelectedStaff(null);
          fetchStaff();
        }
      } else {
        // Create new
        const response = await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        if (response.ok) {
          setShowAddModal(false);
          fetchStaff();
        }
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (staffId: string) => {
    if (!confirm("Are you sure you want to deactivate this staff member?")) {
      return;
    }

    try {
      await fetch(`/api/staff/${staffId}`, { method: "DELETE" });
      fetchStaff();
      setSelectedStaff(null);
      setEditMode(false);
    } catch (err) {
      console.error("Failed to deactivate:", err);
    }
  };

  // Group staff by department
  const groupedStaff = staff.reduce((acc, s) => {
    const dept = s.department || "Other";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(s);
    return acc;
  }, {} as Record<string, Staff[]>);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Staff Directory</h1>
        <button
          onClick={openAdd}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--foreground)",
            color: "var(--background)",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          + Add Staff
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center" }}>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          style={{ padding: "0.5rem", minWidth: "150px" }}
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>

        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.875rem" }}>
          {staff.length} staff members
        </span>
      </div>

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          Loading...
        </div>
      ) : staff.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No staff found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {Object.entries(groupedStaff)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([dept, members]) => (
              <div key={dept}>
                <h3 style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.9rem", fontWeight: 500 }}>
                  {dept} ({members.length})
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
                  {members.map((s) => (
                    <div
                      key={s.staff_id}
                      onClick={() => openEdit(s)}
                      style={{
                        padding: "1rem",
                        background: "var(--card-bg, rgba(0,0,0,0.05))",
                        borderRadius: "8px",
                        cursor: "pointer",
                        opacity: s.is_active ? 1 : 0.6,
                        border: "1px solid transparent",
                        transition: "border-color 0.2s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "1rem" }}>{s.display_name}</div>
                          <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{s.role}</div>
                        </div>
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {s.ai_access_level && s.ai_access_level !== "none" && (
                            <span style={{
                              fontSize: "0.65rem",
                              padding: "0.125rem 0.4rem",
                              background: s.ai_access_level === "full" ? "#6f42c1" :
                                s.ai_access_level === "read_write" ? "#198754" : "#0d6efd",
                              color: "#fff",
                              borderRadius: "3px",
                            }}>
                              AI: {s.ai_access_level === "read_write" ? "R/W" : s.ai_access_level === "read_only" ? "RO" : s.ai_access_level}
                            </span>
                          )}
                          {!s.is_active && (
                            <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.5rem", background: "#dc3545", color: "#fff", borderRadius: "4px" }}>
                              Inactive
                            </span>
                          )}
                        </div>
                      </div>
                      {s.email && (
                        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                          {s.email}
                        </div>
                      )}
                      {s.phone && (
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          {formatPhone(s.phone)}
                          {s.work_extension && ` ext. ${s.work_extension}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Edit Modal */}
      {editMode && selectedStaff && (
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
          onClick={() => { setEditMode(false); setSelectedStaff(null); }}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem" }}>Edit Staff Member</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  First Name *
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Phone
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Work Extension
                </label>
                <input
                  type="text"
                  value={formData.work_extension}
                  onChange={(e) => setFormData({ ...formData, work_extension: e.target.value })}
                  placeholder="(707) 756-7999 ext."
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Role *
                </label>
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Department
                </label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  <option value="">Select...</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Hire Date
                </label>
                <input
                  type="date"
                  value={formData.hired_date}
                  onChange={(e) => setFormData({ ...formData, hired_date: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
            </div>

            {/* AI Access Level - Full width */}
            <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--card-bg, rgba(0,0,0,0.03))", borderRadius: "8px" }}>
              <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                Tippy AI Access Level
              </label>
              <select
                value={formData.ai_access_level}
                onChange={(e) => setFormData({ ...formData, ai_access_level: e.target.value })}
                style={{ width: "100%", padding: "0.5rem" }}
              >
                {AI_ACCESS_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>{level.label}</option>
                ))}
              </select>
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                {AI_ACCESS_LEVELS.find(l => l.value === formData.ai_access_level)?.description}
              </p>
            </div>

            {selectedStaff.source_record_id && (
              <p style={{ margin: "1rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                Synced from Airtable. Changes here will be overwritten on next sync.
              </p>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#198754",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
              {selectedStaff.is_active && (
                <button
                  onClick={() => handleDeactivate(selectedStaff.staff_id)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#dc3545",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Deactivate
                </button>
              )}
              <button
                onClick={() => { setEditMode(false); setSelectedStaff(null); }}
                style={{
                  padding: "0.5rem 1rem",
                  marginLeft: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
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
          onClick={() => setShowAddModal(false)}
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
            <h2 style={{ margin: "0 0 1rem" }}>Add Staff Member</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  First Name *
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Phone
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Role *
                </label>
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="e.g. Clinic Coordinator"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Department
                </label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  <option value="">Select...</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem" }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#198754",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                {saving ? "Creating..." : "Create Staff"}
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  padding: "0.5rem 1rem",
                  marginLeft: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
