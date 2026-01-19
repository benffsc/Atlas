"use client";

import { useState, useEffect, useCallback } from "react";

interface AuthStats {
  total_staff: number;
  active_staff: number;
  with_password: number;
  without_password: number;
  password_change_required: number;
  pending_reset: number;
  admins: number;
  staff_role: number;
  volunteers: number;
}

interface StaffAuth {
  staff_id: string;
  display_name: string;
  email: string;
  auth_role: string;
  is_active: boolean;
  has_password: boolean;
  password_change_required: boolean;
  password_set_at: string | null;
  has_pending_reset: boolean;
  last_login: string | null;
}

export default function AdminAuthPage() {
  const [stats, setStats] = useState<AuthStats | null>(null);
  const [staff, setStaff] = useState<StaffAuth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/auth/status");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setStats(data.stats);
      setStaff(data.staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setDefaultPasswords = async () => {
    if (!confirm("This will set the default password for all staff without passwords. They will be required to change it on first login. (Password is configured in STAFF_DEFAULT_PASSWORD env var) Continue?")) {
      return;
    }

    setActionLoading("default");
    setMessage(null);

    try {
      const res = await fetch("/api/admin/auth/set-default-passwords", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setMessage({
        type: "success",
        text: `${data.updated_count} staff members updated with default password.`,
      });
      fetchData();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to set passwords",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const resetStaffPassword = async (staffId: string, displayName: string) => {
    if (!confirm(`Reset password for ${displayName}? They will need to change it on next login.`)) {
      return;
    }

    setActionLoading(staffId);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/auth/reset-staff/${staffId}`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setMessage({
        type: "success",
        text: `Password reset for ${displayName}. Communicate the default password to them securely.`,
      });
      fetchData();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to reset password",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const getRoleBadge = (role: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      admin: { bg: "var(--info-bg)", text: "var(--info-text)" },
      staff: { bg: "var(--success-bg)", text: "var(--success-text)" },
      volunteer: { bg: "var(--warning-bg)", text: "var(--warning-text)" },
    };
    const c = colors[role] || { bg: "var(--section-bg)", text: "var(--muted)" };
    return (
      <span
        style={{
          padding: "2px 8px",
          background: c.bg,
          color: c.text,
          borderRadius: "4px",
          fontSize: "0.7rem",
          fontWeight: 500,
          textTransform: "capitalize",
        }}
      >
        {role}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>
        Loading auth status...
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 0" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "8px" }}>
            Staff Authentication
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Manage staff passwords and login status
          </p>
        </div>
        <button
          onClick={setDefaultPasswords}
          disabled={actionLoading !== null}
          style={{
            padding: "10px 20px",
            background: actionLoading === "default" ? "#9ca3af" : "var(--primary)",
            color: "var(--primary-foreground)",
            border: "none",
            borderRadius: "8px",
            cursor: actionLoading !== null ? "not-allowed" : "pointer",
            fontWeight: 500,
          }}
        >
          {actionLoading === "default" ? "Setting..." : "Set Default Passwords"}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          style={{
            padding: "12px 16px",
            background: message.type === "success" ? "var(--success-bg)" : "var(--danger-bg)",
            color: message.type === "success" ? "var(--success-text)" : "var(--danger-text)",
            borderRadius: "8px",
            marginBottom: "24px",
          }}
        >
          {message.text}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--danger-bg)",
            color: "var(--danger-text)",
            borderRadius: "8px",
            marginBottom: "24px",
          }}
        >
          {error}
        </div>
      )}

      {/* Stats Grid */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <StatCard label="Active Staff" value={stats.active_staff} />
          <StatCard
            label="With Password"
            value={stats.with_password}
            color="var(--success-text)"
          />
          <StatCard
            label="Without Password"
            value={stats.without_password}
            color={stats.without_password > 0 ? "var(--warning-text)" : "var(--muted)"}
          />
          <StatCard
            label="Change Required"
            value={stats.password_change_required}
            color={stats.password_change_required > 0 ? "var(--info-text)" : "var(--muted)"}
          />
          <StatCard label="Admins" value={stats.admins} />
          <StatCard label="Staff" value={stats.staff_role} />
          <StatCard label="Volunteers" value={stats.volunteers} />
        </div>
      )}

      {/* Staff List */}
      <div>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "16px" }}>
          Staff Members
        </h2>
        <div
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--section-bg)" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Password</th>
                <th style={thStyle}>Last Login</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.staff_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 500 }}>{s.display_name}</div>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                      {s.email}
                    </span>
                  </td>
                  <td style={tdStyle}>{getRoleBadge(s.auth_role)}</td>
                  <td style={tdStyle}>
                    {s.has_password ? (
                      s.password_change_required ? (
                        <span
                          style={{
                            padding: "2px 8px",
                            background: "var(--warning-bg)",
                            color: "var(--warning-text)",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                          }}
                        >
                          Change Required
                        </span>
                      ) : (
                        <span
                          style={{
                            padding: "2px 8px",
                            background: "var(--success-bg)",
                            color: "var(--success-text)",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                          }}
                        >
                          Set
                        </span>
                      )
                    ) : (
                      <span
                        style={{
                          padding: "2px 8px",
                          background: "var(--danger-bg)",
                          color: "var(--danger-text)",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                        }}
                      >
                        Not Set
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      {s.last_login
                        ? new Date(s.last_login).toLocaleDateString()
                        : "Never"}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => resetStaffPassword(s.staff_id, s.display_name)}
                      disabled={actionLoading !== null}
                      style={{
                        padding: "4px 12px",
                        background: "var(--section-bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        fontSize: "0.8rem",
                        cursor: actionLoading !== null ? "not-allowed" : "pointer",
                      }}
                    >
                      {actionLoading === s.staff_id ? "..." : "Reset"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Box */}
      <div
        style={{
          marginTop: "24px",
          padding: "16px",
          background: "var(--info-bg)",
          borderRadius: "8px",
          fontSize: "0.9rem",
        }}
      >
        <strong>How authentication works:</strong>
        <ul style={{ marginTop: "8px", paddingLeft: "20px", color: "var(--info-text)" }}>
          <li>Click "Set Default Passwords" to assign the configured default password to all staff without passwords</li>
          <li>The default password is configured via STAFF_DEFAULT_PASSWORD environment variable</li>
          <li>Staff will be required to change their password on first login</li>
          <li>Use the "Reset" button to restore a staff member's password to default</li>
          <li>Communicate passwords securely (in person or via secure channel, never in Atlas)</li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: "16px",
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: "8px",
      }}
    >
      <div
        style={{
          fontSize: "2rem",
          fontWeight: 600,
          color: color || "var(--foreground)",
          marginBottom: "4px",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "left",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
};
