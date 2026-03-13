"use client";

import { useState, useEffect } from "react";
import { AdminSidebar } from "@/components/SidebarLayout";
import { fetchApi, postApi } from "@/lib/api-client";
import { MAP_COLORS } from "@/lib/map-colors";

interface ConfigRow {
  key: string;
  value: Record<string, string>;
  description: string | null;
  category: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  priority: "Priority Levels",
  layers: "Map Layers",
  classification: "AI Classification",
  signals: "Signal Types",
  volunteerRoles: "Volunteer Roles",
  zoneStatus: "Zone Status",
  coverage: "Data Coverage",
  disease: "Disease Types",
};

export default function MapColorsPage() {
  return (
    <AdminSidebar>
      <MapColorsContent />
    </AdminSidebar>
  );
}

function MapColorsContent() {
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editColors, setEditColors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function loadConfigs() {
    try {
      const data = await fetchApi<{ configs: ConfigRow[] }>("/api/admin/config?category=map");
      setConfigs(data.configs);
    } catch {
      showToast("Failed to load map colors", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfigs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function getCategoryFromKey(key: string): string {
    return key.replace("map.colors.", "");
  }

  function getColorsForCategory(category: string): Record<string, string> {
    const config = configs.find((c) => c.key === `map.colors.${category}`);
    if (config && typeof config.value === "object") {
      return config.value as Record<string, string>;
    }
    return MAP_COLORS[category as keyof typeof MAP_COLORS] as Record<string, string> || {};
  }

  function startEdit(category: string) {
    setEditingKey(category);
    setEditColors({ ...getColorsForCategory(category) });
  }

  async function saveEdit(category: string) {
    try {
      await postApi("/api/admin/config", {
        key: `map.colors.${category}`,
        value: editColors,
      }, { method: "PUT" });
      setEditingKey(null);
      await loadConfigs();
      showToast("Colors saved", "success");
    } catch {
      showToast("Failed to save", "error");
    }
  }

  async function resetToDefaults(category: string) {
    const defaults = MAP_COLORS[category as keyof typeof MAP_COLORS] as Record<string, string>;
    if (!defaults) return;
    try {
      await postApi("/api/admin/config", {
        key: `map.colors.${category}`,
        value: defaults,
      }, { method: "PUT" });
      await loadConfigs();
      showToast("Reset to defaults", "success");
    } catch {
      showToast("Failed to reset", "error");
    }
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>;
  }

  const categories = Object.keys(CATEGORY_LABELS);

  return (
    <div style={{ maxWidth: "900px" }}>
      {toast && (
        <div style={{ position: "fixed", top: "1rem", right: "1rem", padding: "0.75rem 1.25rem", borderRadius: "8px", background: toast.type === "success" ? "var(--success-bg, #dcfce7)" : "var(--danger-bg, #fef2f2)", color: toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)", border: `1px solid ${toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)"}`, zIndex: 1000, fontSize: "0.875rem" }}>
          {toast.message}
        </div>
      )}

      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Map Colors</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Customize colors used on the Atlas map for priority levels, layers, disease types, and more.
        </p>
      </div>

      {categories.map((category) => {
        const isEditing = editingKey === category;
        const colors = isEditing ? editColors : getColorsForCategory(category);
        const colorKeys = Object.keys(colors);

        return (
          <div key={category} style={{ border: "1px solid var(--card-border)", borderRadius: "8px", marginBottom: "1rem", overflow: "hidden" }}>
            <div style={{ padding: "0.75rem 1rem", background: "var(--bg-secondary, #f9fafb)", borderBottom: "1px solid var(--card-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ fontSize: "0.9rem" }}>{CATEGORY_LABELS[category]}</strong>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>map.colors.{category}</span>
              </div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                {isEditing ? (
                  <>
                    <button onClick={() => saveEdit(category)} style={{ padding: "0.25rem 0.5rem", background: "var(--primary)", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}>Save</button>
                    <button onClick={() => setEditingKey(null)} style={{ padding: "0.25rem 0.5rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)" }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(category)} style={{ padding: "0.25rem 0.5rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}>Edit</button>
                    <button onClick={() => resetToDefaults(category)} style={{ padding: "0.25rem 0.5rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>Reset</button>
                  </>
                )}
              </div>
            </div>

            <div style={{ padding: "0.75rem 1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {colorKeys.map((colorKey) => (
                <div key={colorKey} style={{ display: "flex", alignItems: "center", gap: "0.375rem", minWidth: "140px" }}>
                  {isEditing ? (
                    <input
                      type="color"
                      value={editColors[colorKey] || "#000000"}
                      onChange={(e) => setEditColors({ ...editColors, [colorKey]: e.target.value })}
                      style={{ width: "28px", height: "28px", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", padding: 0 }}
                    />
                  ) : (
                    <div style={{ width: "28px", height: "28px", borderRadius: "4px", background: colors[colorKey], border: "1px solid var(--card-border)", flexShrink: 0 }} />
                  )}
                  <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 500 }}>{colorKey.replace(/_/g, " ")}</div>
                    <code style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{colors[colorKey]}</code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
