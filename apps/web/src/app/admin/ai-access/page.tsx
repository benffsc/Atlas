"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";

interface Staff {
  staff_id: string;
  display_name: string;
  email: string;
  auth_role: string;
  ai_access_level: string;
  is_active: boolean;
}

interface AccessLevel {
  value: string;
  label: string;
  description: string;
}

const ACCESS_LEVEL_COLORS: Record<string, { bg: string; text: string }> = {
  none: { bg: "#dc354520", text: "#dc3545" },
  read_only: { bg: "#6c757d20", text: "#6c757d" },
  read_write: { bg: "#0d6efd20", text: "#0d6efd" },
  full: { bg: "#19875420", text: "#198754" },
};

export default function AIAccessManagementPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ staff: Staff[]; access_levels: AccessLevel[] }>("/api/admin/ai-access");
      setStaff(data.staff || []);
      setAccessLevels(data.access_levels || []);
    } catch (err) {
      console.error("Failed to fetch AI access data:", err);
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to connect to server" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Clear message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const updateAccessLevel = async (staffId: string, newLevel: string) => {
    setSaving(staffId);
    try {
      const data = await postApi<{ message: string }>("/api/admin/ai-access", { staff_id: staffId, ai_access_level: newLevel }, { method: "PATCH" });
      setMessage({ type: "success", text: data.message });
      // Update local state
      setStaff((prev) =>
        prev.map((s) =>
          s.staff_id === staffId ? { ...s, ai_access_level: newLevel } : s
        )
      );
    } catch (err) {
      console.error("Failed to update access level:", err);
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to connect to server" });
    } finally {
      setSaving(null);
    }
  };

  // Filter staff
  const filteredStaff = staff.filter((s) => {
    if (!showInactive && !s.is_active) return false;
    if (filterLevel && s.ai_access_level !== filterLevel) return false;
    return true;
  });

  // Group by access level
  const groupedByLevel = filteredStaff.reduce((acc, s) => {
    const level = s.ai_access_level || "read_only";
    if (!acc[level]) acc[level] = [];
    acc[level].push(s);
    return acc;
  }, {} as Record<string, Staff[]>);

  const levelOrder = ["full", "read_write", "read_only", "none"];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Tippy AI Access</h1>
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
            Manage what staff can do with Tippy AI assistant
          </p>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            borderRadius: "8px",
            background: message.type === "success" ? "#19875420" : "#dc354520",
            color: message.type === "success" ? "#198754" : "#dc3545",
            fontSize: "0.9rem",
          }}
        >
          {message.text}
        </div>
      )}

      {/* Access Level Legend */}
      <div
        style={{
          padding: "1rem",
          background: "var(--card-bg, rgba(0,0,0,0.05))",
          borderRadius: "8px",
          marginBottom: "1.5rem",
        }}
      >
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Access Levels</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
          {accessLevels.map((level) => (
            <div
              key={level.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <span
                style={{
                  padding: "0.25rem 0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  background: ACCESS_LEVEL_COLORS[level.value]?.bg || "#6c757d20",
                  color: ACCESS_LEVEL_COLORS[level.value]?.text || "#6c757d",
                  minWidth: "80px",
                  textAlign: "center",
                }}
              >
                {level.label}
              </span>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                {level.description}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center" }}>
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          style={{ padding: "0.5rem", minWidth: "150px" }}
        >
          <option value="">All Access Levels</option>
          {accessLevels.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}
            </option>
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
          {filteredStaff.length} staff members
        </span>
      </div>

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          Loading...
        </div>
      ) : filteredStaff.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          No staff found
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {levelOrder
            .filter((level) => groupedByLevel[level]?.length > 0)
            .map((level) => {
              const levelInfo = accessLevels.find((l) => l.value === level);
              const members = groupedByLevel[level] || [];

              return (
                <div key={level}>
                  <h3
                    style={{
                      margin: "0 0 0.75rem",
                      fontSize: "0.9rem",
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span
                      style={{
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        background: ACCESS_LEVEL_COLORS[level]?.bg || "#6c757d20",
                        color: ACCESS_LEVEL_COLORS[level]?.text || "#6c757d",
                      }}
                    >
                      {levelInfo?.label || level}
                    </span>
                    <span style={{ color: "var(--muted)" }}>({members.length})</span>
                  </h3>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                      gap: "0.75rem",
                    }}
                  >
                    {members.map((s) => (
                      <div
                        key={s.staff_id}
                        style={{
                          padding: "1rem",
                          background: "var(--card-bg, rgba(0,0,0,0.05))",
                          borderRadius: "8px",
                          opacity: s.is_active ? 1 : 0.6,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "1rem",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "1rem" }}>
                            {s.display_name}
                            {!s.is_active && (
                              <span
                                style={{
                                  fontSize: "0.65rem",
                                  padding: "0.125rem 0.4rem",
                                  background: "#dc3545",
                                  color: "#fff",
                                  borderRadius: "4px",
                                  marginLeft: "0.5rem",
                                  verticalAlign: "middle",
                                }}
                              >
                                Inactive
                              </span>
                            )}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                            {s.email}
                          </div>
                          {s.auth_role === "admin" && (
                            <div style={{ fontSize: "0.75rem", color: "#0d6efd", marginTop: "0.25rem" }}>
                              System Admin
                            </div>
                          )}
                        </div>

                        <select
                          value={s.ai_access_level}
                          onChange={(e) => updateAccessLevel(s.staff_id, e.target.value)}
                          disabled={saving === s.staff_id}
                          style={{
                            padding: "0.4rem 0.5rem",
                            borderRadius: "6px",
                            fontSize: "0.85rem",
                            minWidth: "110px",
                            cursor: saving === s.staff_id ? "wait" : "pointer",
                            opacity: saving === s.staff_id ? 0.6 : 1,
                          }}
                        >
                          {accessLevels.map((level) => (
                            <option key={level.value} value={level.value}>
                              {level.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Help text */}
      <div
        style={{
          marginTop: "2rem",
          padding: "1rem",
          background: "var(--card-bg, rgba(0,0,0,0.05))",
          borderRadius: "8px",
          fontSize: "0.85rem",
          color: "var(--muted)",
        }}
      >
        <strong>About Tippy Access Levels:</strong>
        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
          <li><strong>None:</strong> User cannot access Tippy at all</li>
          <li><strong>Read Only:</strong> Can ask questions and query data, but cannot log events or make changes</li>
          <li><strong>Read/Write:</strong> Can query data and log field events (colony observations, etc.)</li>
          <li><strong>Full:</strong> Complete access including appointment lookups and admin operations</li>
        </ul>
      </div>
    </div>
  );
}
