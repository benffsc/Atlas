"use client";

import { useState } from "react";
import { AdminSidebar } from "@/components/SidebarLayout";
import { usePermissions } from "@/hooks/usePermission";
import { postApi } from "@/lib/api-client";

export default function RolesPage() {
  return (
    <AdminSidebar>
      <RolesContent />
    </AdminSidebar>
  );
}

function RolesContent() {
  const { permissions, matrix, roles, categories, isLoading, mutate } = usePermissions();
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function togglePermission(role: string, permissionKey: string) {
    const isGranted = matrix[role]?.includes(permissionKey);
    const cellKey = `${role}:${permissionKey}`;
    setSaving(cellKey);

    try {
      await postApi(
        "/api/admin/roles",
        { role, permission_key: permissionKey, granted: !isGranted },
        { method: "PUT" }
      );
      await mutate();
      showToast(`${!isGranted ? "Granted" : "Revoked"} ${permissionKey} for ${role}`, "success");
    } catch {
      showToast("Failed to update permission", "error");
    } finally {
      setSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        Loading permissions...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "900px" }}>
      {toast && (
        <div
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            padding: "0.75rem 1.25rem",
            borderRadius: "8px",
            background: toast.type === "success" ? "var(--success-bg, #dcfce7)" : "var(--danger-bg, #fef2f2)",
            color: toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)",
            border: `1px solid ${toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)"}`,
            zIndex: 1000,
            fontSize: "0.875rem",
          }}
        >
          {toast.message}
        </div>
      )}

      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Roles & Permissions</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Configure what each role can access. Changes take effect immediately.
        </p>
      </div>

      {categories.map((category) => {
        const categoryPerms = permissions.filter((p) => p.category === category);
        return (
          <div
            key={category}
            style={{
              marginBottom: "1.5rem",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            {/* Category header */}
            <div
              style={{
                padding: "0.5rem 1rem",
                background: "var(--card-bg, #f9fafb)",
                borderBottom: "1px solid var(--card-border)",
                fontSize: "0.8rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
              }}
            >
              {category}
            </div>

            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr repeat(3, 80px)",
                padding: "0.5rem 1rem",
                borderBottom: "1px solid var(--card-border)",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--text-muted)",
              }}
            >
              <div>Permission</div>
              {roles.map((role) => (
                <div key={role} style={{ textAlign: "center", textTransform: "capitalize" }}>
                  {role}
                </div>
              ))}
            </div>

            {/* Permission rows */}
            {categoryPerms.map((perm, idx) => (
              <div
                key={perm.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr repeat(3, 80px)",
                  padding: "0.5rem 1rem",
                  borderBottom: idx < categoryPerms.length - 1 ? "1px solid var(--card-border)" : "none",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{perm.label}</div>
                  {perm.description && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {perm.description}
                    </div>
                  )}
                </div>
                {roles.map((role) => {
                  const granted = matrix[role]?.includes(perm.key);
                  const cellKey = `${role}:${perm.key}`;
                  const isSaving = saving === cellKey;

                  return (
                    <div key={role} style={{ textAlign: "center" }}>
                      <button
                        onClick={() => togglePermission(role, perm.key)}
                        disabled={isSaving}
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "6px",
                          border: `2px solid ${granted ? "var(--success, #16a34a)" : "var(--card-border)"}`,
                          background: granted ? "var(--success-bg, #dcfce7)" : "transparent",
                          cursor: isSaving ? "wait" : "pointer",
                          fontSize: "1rem",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: isSaving ? 0.5 : 1,
                        }}
                        title={`${granted ? "Revoke" : "Grant"} ${perm.key} for ${role}`}
                      >
                        {granted ? "✓" : ""}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
