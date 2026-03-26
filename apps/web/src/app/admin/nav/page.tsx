"use client";

import { useState, useEffect } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";

interface NavItem {
  id: string;
  sidebar: string;
  section: string;
  label: string;
  path: string;
  icon: string;
  sort_order: number;
  visible: boolean;
  required_role: string | null;
}

export default function NavBuilderPage() {
  return <NavBuilderContent />;
}

function NavBuilderContent() {
  const [items, setItems] = useState<NavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSidebar, setActiveSidebar] = useState<"admin" | "main">("admin");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<NavItem>>({});
  const { success: showSuccess, error: showError } = useToast();
  const [pendingDelete, setPendingDelete] = useState<NavItem | null>(null);

  async function loadItems() {
    try {
      const data = await fetchApi<{ items: NavItem[] }>(`/api/admin/nav?sidebar=${activeSidebar}`);
      setItems(data.items);
    } catch {
      showError("Failed to load nav items");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadItems();
  }, [activeSidebar]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleVisible(item: NavItem) {
    try {
      await postApi("/api/admin/nav", { id: item.id, visible: !item.visible }, { method: "PUT" });
      await loadItems();
      showSuccess(`${item.label} ${item.visible ? "hidden" : "shown"}`);
    } catch {
      showError("Failed to update");
    }
  }

  async function moveItem(item: NavItem, direction: "up" | "down") {
    const sectionItems = items
      .filter((i) => i.section === item.section)
      .sort((a, b) => a.sort_order - b.sort_order);

    const idx = sectionItems.findIndex((i) => i.id === item.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sectionItems.length) return;

    const other = sectionItems[swapIdx];
    try {
      await Promise.all([
        postApi("/api/admin/nav", { id: item.id, sort_order: other.sort_order }, { method: "PUT" }),
        postApi("/api/admin/nav", { id: other.id, sort_order: item.sort_order }, { method: "PUT" }),
      ]);
      await loadItems();
    } catch {
      showError("Failed to reorder");
    }
  }

  function startEdit(item: NavItem) {
    setEditingId(item.id);
    setEditForm({ label: item.label, path: item.path, icon: item.icon, required_role: item.required_role });
  }

  async function saveEdit(id: string) {
    try {
      await postApi("/api/admin/nav", { id, ...editForm }, { method: "PUT" });
      setEditingId(null);
      await loadItems();
      showSuccess("Saved");
    } catch {
      showError("Failed to save");
    }
  }

  function deleteItem(item: NavItem) {
    setPendingDelete(item);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const item = pendingDelete;
    setPendingDelete(null);
    try {
      await postApi(`/api/admin/nav?id=${item.id}`, {}, { method: "DELETE" });
      await loadItems();
      showSuccess(`Deleted ${item.label}`);
    } catch {
      showError("Failed to delete");
    }
  }

  // Group by section
  const sections = new Map<string, NavItem[]>();
  for (const item of items) {
    if (!sections.has(item.section)) sections.set(item.section, []);
    sections.get(item.section)!.push(item);
  }

  return (
    <div style={{ maxWidth: "800px" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Navigation Builder</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Manage sidebar navigation items. Changes take effect on next page load.
        </p>
      </div>

      {/* Sidebar toggle */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {(["admin", "main"] as const).map((sb) => (
          <button
            key={sb}
            onClick={() => setActiveSidebar(sb)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--card-border)",
              background: activeSidebar === sb ? "var(--primary)" : "transparent",
              color: activeSidebar === sb ? "#fff" : "var(--text-primary)",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            {sb === "admin" ? "Admin Sidebar" : "Main Sidebar"}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
      ) : (
        Array.from(sections.entries()).map(([sectionName, sectionItems]) => (
          <div
            key={sectionName}
            style={{
              marginBottom: "1.5rem",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
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
              {sectionName}
            </div>

            {sectionItems
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    padding: "0.5rem 1rem",
                    borderBottom: idx < sectionItems.length - 1 ? "1px solid var(--card-border)" : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    opacity: item.visible ? 1 : 0.5,
                  }}
                >
                  {editingId === item.id ? (
                    /* Edit mode */
                    <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        value={editForm.icon || ""}
                        onChange={(e) => setEditForm({ ...editForm, icon: e.target.value })}
                        style={{ width: "40px", padding: "0.25rem", border: "1px solid var(--card-border)", borderRadius: "4px", textAlign: "center" }}
                        placeholder="Icon"
                      />
                      <input
                        value={editForm.label || ""}
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                        style={{ width: "140px", padding: "0.25rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.875rem" }}
                        placeholder="Label"
                      />
                      <input
                        value={editForm.path || ""}
                        onChange={(e) => setEditForm({ ...editForm, path: e.target.value })}
                        style={{ width: "200px", padding: "0.25rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.8rem", fontFamily: "monospace" }}
                        placeholder="/path"
                      />
                      <select
                        value={editForm.required_role || ""}
                        onChange={(e) => setEditForm({ ...editForm, required_role: e.target.value || null })}
                        style={{ padding: "0.25rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.8rem" }}
                      >
                        <option value="">All roles</option>
                        <option value="admin">Admin only</option>
                        <option value="staff">Staff+</option>
                      </select>
                      <button onClick={() => saveEdit(item.id)} style={{ padding: "0.25rem 0.5rem", background: "var(--primary)", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}>
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)} style={{ padding: "0.25rem 0.5rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    /* Display mode */
                    <>
                      <span style={{ fontSize: "1rem", width: "24px", textAlign: "center" }}>{item.icon}</span>
                      <span style={{ flex: 1, fontSize: "0.875rem", fontWeight: 500 }}>{item.label}</span>
                      <code style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{item.path}</code>
                      {item.required_role && (
                        <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.375rem", background: "var(--warning-bg, #fef3c7)", borderRadius: "4px", color: "var(--warning, #d97706)" }}>
                          {item.required_role}
                        </span>
                      )}
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button onClick={() => moveItem(item, "up")} disabled={idx === 0} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.3 : 1, fontSize: "0.75rem" }} title="Move up">
                          ↑
                        </button>
                        <button onClick={() => moveItem(item, "down")} disabled={idx === sectionItems.length - 1} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: idx === sectionItems.length - 1 ? "default" : "pointer", opacity: idx === sectionItems.length - 1 ? 0.3 : 1, fontSize: "0.75rem" }} title="Move down">
                          ↓
                        </button>
                        <button onClick={() => toggleVisible(item)} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }} title={item.visible ? "Hide" : "Show"}>
                          {item.visible ? "👁" : "👁‍🗨"}
                        </button>
                        <button onClick={() => startEdit(item)} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }} title="Edit">
                          ✎
                        </button>
                        <button onClick={() => deleteItem(item)} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", color: "var(--danger, #dc2626)" }} title="Delete">
                          ×
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
          </div>
        ))
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete nav item"
        message={`Delete "${pendingDelete?.label}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
