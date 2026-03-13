"use client";

import { useState, useEffect } from "react";
import { AdminSidebar } from "@/components/SidebarLayout";
import { fetchApi, postApi } from "@/lib/api-client";

interface TriageFlag {
  id: string;
  key: string;
  label: string;
  color: string;
  text_color: string;
  icon: string | null;
  description: string | null;
  condition_type: string;
  condition_config: Record<string, unknown>;
  entity_type: string;
  sort_order: number;
  active: boolean;
}

export default function TriageFlagsPage() {
  return (
    <AdminSidebar>
      <TriageFlagsContent />
    </AdminSidebar>
  );
}

function TriageFlagsContent() {
  const [flags, setFlags] = useState<TriageFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<TriageFlag>>({});
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function loadFlags() {
    try {
      const data = await fetchApi<{ flags: TriageFlag[] }>("/api/admin/triage-flags?entity_type=request");
      setFlags(data.flags);
    } catch {
      showToast("Failed to load flags", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFlags();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleActive(flag: TriageFlag) {
    try {
      await postApi("/api/admin/triage-flags", { id: flag.id, active: !flag.active }, { method: "PUT" });
      await loadFlags();
      showToast(`${flag.label} ${flag.active ? "disabled" : "enabled"}`, "success");
    } catch {
      showToast("Failed to update", "error");
    }
  }

  function startEdit(flag: TriageFlag) {
    setEditingId(flag.id);
    setEditForm({ label: flag.label, color: flag.color, text_color: flag.text_color, description: flag.description });
  }

  async function saveEdit(id: string) {
    try {
      await postApi("/api/admin/triage-flags", { id, ...editForm }, { method: "PUT" });
      setEditingId(null);
      await loadFlags();
      showToast("Saved", "success");
    } catch {
      showToast("Failed to save", "error");
    }
  }

  async function moveFlag(flag: TriageFlag, direction: "up" | "down") {
    const sorted = [...flags].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((f) => f.id === flag.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const other = sorted[swapIdx];
    try {
      await Promise.all([
        postApi("/api/admin/triage-flags", { id: flag.id, sort_order: other.sort_order }, { method: "PUT" }),
        postApi("/api/admin/triage-flags", { id: other.id, sort_order: flag.sort_order }, { method: "PUT" }),
      ]);
      await loadFlags();
    } catch {
      showToast("Failed to reorder", "error");
    }
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>;
  }

  const sorted = [...flags].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div style={{ maxWidth: "800px" }}>
      {toast && (
        <div style={{ position: "fixed", top: "1rem", right: "1rem", padding: "0.75rem 1.25rem", borderRadius: "8px", background: toast.type === "success" ? "var(--success-bg, #dcfce7)" : "var(--danger-bg, #fef2f2)", color: toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)", border: `1px solid ${toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)"}`, zIndex: 1000, fontSize: "0.875rem" }}>
          {toast.message}
        </div>
      )}

      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Triage Flags</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Data quality flags shown on request cards. Reorder, edit labels/colors, or toggle visibility.
        </p>
      </div>

      <div style={{ border: "1px solid var(--card-border)", borderRadius: "8px", overflow: "hidden" }}>
        {sorted.map((flag, idx) => {
          const isEditing = editingId === flag.id;

          return (
            <div
              key={flag.id}
              style={{
                padding: "0.75rem 1rem",
                borderBottom: idx < sorted.length - 1 ? "1px solid var(--card-border)" : "none",
                opacity: flag.active ? 1 : 0.5,
              }}
            >
              {isEditing ? (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <input value={editForm.label || ""} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} style={{ padding: "0.25rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.875rem", width: "140px" }} placeholder="Label" />
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <label style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>BG</label>
                    <input type="color" value={editForm.color || "#fee2e2"} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} style={{ width: "32px", height: "28px", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <label style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Text</label>
                    <input type="color" value={editForm.text_color || "#991b1b"} onChange={(e) => setEditForm({ ...editForm, text_color: e.target.value })} style={{ width: "32px", height: "28px", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer" }} />
                  </div>
                  <input value={editForm.description || ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} style={{ flex: 1, minWidth: "150px", padding: "0.25rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.8rem" }} placeholder="Description" />
                  <button onClick={() => saveEdit(flag.id)} style={{ padding: "0.25rem 0.5rem", background: "var(--primary)", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}>Save</button>
                  <button onClick={() => setEditingId(null)} style={{ padding: "0.25rem 0.5rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)" }}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  {/* Flag preview */}
                  <span style={{ padding: "0.125rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 500, background: flag.color, color: flag.text_color, whiteSpace: "nowrap" }}>
                    {flag.label}
                  </span>

                  {/* Key + description */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <code style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{flag.key}</code>
                    {flag.description && (
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>{flag.description}</div>
                    )}
                  </div>

                  {/* Condition info */}
                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                    {flag.condition_type}
                  </span>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <button onClick={() => moveFlag(flag, "up")} disabled={idx === 0} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.3 : 1, fontSize: "0.75rem" }}>↑</button>
                    <button onClick={() => moveFlag(flag, "down")} disabled={idx === sorted.length - 1} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: idx === sorted.length - 1 ? "default" : "pointer", opacity: idx === sorted.length - 1 ? 0.3 : 1, fontSize: "0.75rem" }}>↓</button>
                    <button onClick={() => toggleActive(flag)} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }} title={flag.active ? "Disable" : "Enable"}>
                      {flag.active ? "👁" : "👁‍🗨"}
                    </button>
                    <button onClick={() => startEdit(flag)} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }}>✎</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
