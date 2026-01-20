"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

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
  end_date: string | null;
  ai_access_level: string | null;
  created_at: string;
  updated_at: string;
}

const AI_ACCESS_LEVELS = [
  { value: "none", label: "None", description: "No AI assistant access" },
  { value: "read_only", label: "Read Only", description: "Can query data only" },
  { value: "read_write", label: "Read + Write", description: "Can query and create reminders, messages, etc." },
  { value: "full", label: "Full Access", description: "All capabilities including admin tools" },
];

const DEPARTMENTS = [
  "Administration",
  "Clinic",
  "Trapping",
  "Adoptions",
  "Volunteers",
  "Marketing",
  "Other",
];

export default function StaffProfilePage() {
  const params = useParams();
  const router = useRouter();
  const staffId = params.id as string;

  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<Staff>>({});

  useEffect(() => {
    fetchStaff();
  }, [staffId]);

  const fetchStaff = async () => {
    try {
      const res = await fetch(`/api/staff/${staffId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Staff member not found");
        } else {
          setError("Failed to load profile");
        }
        return;
      }
      const data = await res.json();
      setStaff(data.staff);
      setFormData(data.staff);
    } catch (err) {
      console.error("Error fetching staff:", err);
      setError("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        throw new Error("Failed to save");
      }

      await fetchStaff();
      setEditMode(false);
    } catch (err) {
      console.error("Error saving:", err);
      alert("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        Loading profile...
      </div>
    );
  }

  if (error || !staff) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <h2 style={{ color: "var(--danger-text)" }}>{error || "Not found"}</h2>
        <button
          onClick={() => router.back()}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            background: "var(--primary)",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>
            {staff.display_name}
          </h1>
          <p style={{ color: "var(--muted)", marginTop: "0.25rem" }}>
            {staff.role} {staff.department && `• ${staff.department}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {editMode ? (
            <>
              <button
                onClick={() => {
                  setFormData(staff);
                  setEditMode(false);
                }}
                style={{
                  padding: "0.5rem 1rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--primary)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              style={{
                padding: "0.5rem 1rem",
                background: "var(--primary)",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Edit Profile
            </button>
          )}
        </div>
      </div>

      {/* Status Badge */}
      <div style={{ marginBottom: "1.5rem" }}>
        <span
          style={{
            display: "inline-block",
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            fontSize: "0.8rem",
            fontWeight: 500,
            background: staff.is_active ? "#dcfce7" : "#fee2e2",
            color: staff.is_active ? "#166534" : "#b91c1c",
          }}
        >
          {staff.is_active ? "Active" : "Inactive"}
        </span>
      </div>

      {/* Profile Sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* Contact Information */}
        <section
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
            Contact Information
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>
                Email
              </label>
              {editMode ? (
                <input
                  type="email"
                  value={formData.email || ""}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.5rem",
                    marginTop: "0.25rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    background: "var(--input-bg)",
                  }}
                />
              ) : (
                <p style={{ marginTop: "0.25rem" }}>{staff.email || "—"}</p>
              )}
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>
                Phone
              </label>
              {editMode ? (
                <input
                  type="tel"
                  value={formData.phone || ""}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.5rem",
                    marginTop: "0.25rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    background: "var(--input-bg)",
                  }}
                />
              ) : (
                <p style={{ marginTop: "0.25rem" }}>{staff.phone || "—"}</p>
              )}
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>
                Work Extension
              </label>
              {editMode ? (
                <input
                  type="text"
                  value={formData.work_extension || ""}
                  onChange={(e) => setFormData({ ...formData, work_extension: e.target.value })}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.5rem",
                    marginTop: "0.25rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    background: "var(--input-bg)",
                  }}
                />
              ) : (
                <p style={{ marginTop: "0.25rem" }}>{staff.work_extension || "—"}</p>
              )}
            </div>
          </div>
        </section>

        {/* Role & Department */}
        <section
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
            Role & Department
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>
                Role
              </label>
              {editMode ? (
                <input
                  type="text"
                  value={formData.role || ""}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.5rem",
                    marginTop: "0.25rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    background: "var(--input-bg)",
                  }}
                />
              ) : (
                <p style={{ marginTop: "0.25rem" }}>{staff.role}</p>
              )}
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>
                Department
              </label>
              {editMode ? (
                <select
                  value={formData.department || ""}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.5rem",
                    marginTop: "0.25rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    background: "var(--input-bg)",
                  }}
                >
                  <option value="">Select department</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : (
                <p style={{ marginTop: "0.25rem" }}>{staff.department || "—"}</p>
              )}
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>
                Hired Date
              </label>
              <p style={{ marginTop: "0.25rem" }}>{formatDate(staff.hired_date)}</p>
            </div>
          </div>
        </section>

        {/* AI Access */}
        <section
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
            Tippy AI Access
          </h2>
          <div>
            <label style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>
              Access Level
            </label>
            {editMode ? (
              <select
                value={formData.ai_access_level || "read_only"}
                onChange={(e) => setFormData({ ...formData, ai_access_level: e.target.value })}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "0.5rem",
                  marginTop: "0.25rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  background: "var(--input-bg)",
                }}
              >
                {AI_ACCESS_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label} - {level.description}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ marginTop: "0.25rem" }}>
                <p style={{ fontWeight: 500 }}>
                  {AI_ACCESS_LEVELS.find((l) => l.value === staff.ai_access_level)?.label || "Read Only"}
                </p>
                <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                  {AI_ACCESS_LEVELS.find((l) => l.value === staff.ai_access_level)?.description ||
                    "Can query data only"}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Account Info */}
        <section
          style={{
            background: "var(--section-bg)",
            borderRadius: "12px",
            padding: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem", color: "var(--muted)" }}>
            Account Information
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.9rem" }}>
            <div>
              <span style={{ color: "var(--muted)" }}>Staff ID:</span>{" "}
              <code style={{ fontSize: "0.8rem" }}>{staff.staff_id.slice(0, 8)}...</code>
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>Created:</span> {formatDate(staff.created_at)}
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>Updated:</span> {formatDate(staff.updated_at)}
            </div>
            {staff.person_id && (
              <div>
                <span style={{ color: "var(--muted)" }}>Linked Person:</span>{" "}
                <a href={`/people/${staff.person_id}`} style={{ color: "var(--primary)" }}>
                  View
                </a>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Back Link */}
      <div style={{ marginTop: "2rem" }}>
        <button
          onClick={() => router.back()}
          style={{
            padding: "0.5rem 1rem",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            cursor: "pointer",
            color: "var(--foreground)",
          }}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}
