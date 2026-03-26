"use client";

import { useState, useEffect } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";

interface ConfigRow {
  key: string;
  value: Record<string, unknown>;
  description: string | null;
}

const SECTION_INFO: Record<string, { title: string; description: string }> = {
  "theme.brand": { title: "Brand Colors", description: "Primary action colors used across buttons, links, and focus states." },
  "theme.status": { title: "Status Colors", description: "Success, warning, error, and info indicator colors." },
  "theme.entity_colors": { title: "Entity Colors", description: "Accent colors for cats, people, places, and requests." },
  "theme.request_status": { title: "Request Status", description: "Badge colors for request workflow states." },
};

export default function ThemePage() {
  return <ThemeContent />;
}

function ThemeContent() {
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const { success: showSuccess, error: showError } = useToast();

  async function loadConfigs() {
    try {
      const data = await fetchApi<{ configs: ConfigRow[] }>("/api/admin/config?category=theme");
      setConfigs(data.configs);
    } catch {
      showError("Failed to load theme");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfigs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(key: string) {
    const config = configs.find((c) => c.key === key);
    if (config) {
      setEditingSection(key);
      setEditValues(structuredClone(config.value));
    }
  }

  async function saveEdit(key: string) {
    try {
      await postApi("/api/admin/config", { key, value: editValues }, { method: "PUT" });
      setEditingSection(null);
      await loadConfigs();
      showSuccess("Theme updated");
    } catch {
      showError("Failed to save");
    }
  }

  function isNestedColorObj(val: unknown): val is Record<string, string> {
    return typeof val === "object" && val !== null && Object.values(val).every((v) => typeof v === "string");
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>;
  }

  const sectionKeys = Object.keys(SECTION_INFO);

  return (
    <div style={{ maxWidth: "900px" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Theme</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Customize brand colors, status indicators, and entity accent colors.
        </p>
      </div>

      {sectionKeys.map((sectionKey) => {
        const config = configs.find((c) => c.key === sectionKey);
        if (!config) return null;

        const info = SECTION_INFO[sectionKey];
        const isEditing = editingSection === sectionKey;
        const values = isEditing ? editValues : config.value;

        // request_status has nested objects { bg, text, border }
        const isNested = sectionKey === "theme.request_status";

        return (
          <div key={sectionKey} style={{ border: "1px solid var(--card-border)", borderRadius: "8px", marginBottom: "1rem", overflow: "hidden" }}>
            <div style={{ padding: "0.75rem 1rem", background: "var(--bg-secondary, #f9fafb)", borderBottom: "1px solid var(--card-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ fontSize: "0.9rem" }}>{info.title}</strong>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>{info.description}</div>
              </div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                {isEditing ? (
                  <>
                    <button onClick={() => saveEdit(sectionKey)} style={{ padding: "0.25rem 0.5rem", background: "var(--primary)", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}>Save</button>
                    <button onClick={() => setEditingSection(null)} style={{ padding: "0.25rem 0.5rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)" }}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => startEdit(sectionKey)} style={{ padding: "0.25rem 0.5rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}>Edit</button>
                )}
              </div>
            </div>

            <div style={{ padding: "0.75rem 1rem" }}>
              {isNested ? (
                // Render nested status objects (new → { bg, text, border })
                <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
                  {Object.entries(values).map(([statusKey, statusVal]) => {
                    if (!isNestedColorObj(statusVal)) return null;
                    return (
                      <div key={statusKey} style={{ border: "1px solid var(--card-border)", borderRadius: "6px", padding: "0.5rem", minWidth: "180px" }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.375rem" }}>{statusKey}</div>
                        {/* Preview badge */}
                        <div style={{ display: "inline-block", padding: "0.125rem 0.5rem", borderRadius: "4px", marginBottom: "0.5rem", background: statusVal.bg, color: statusVal.text, border: `1px solid ${statusVal.border}`, fontSize: "0.75rem", fontWeight: 500 }}>
                          {statusKey}
                        </div>
                        {Object.entries(statusVal).map(([prop, color]) => (
                          <div key={prop} style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.25rem" }}>
                            {isEditing ? (
                              <input
                                type="color"
                                value={color}
                                onChange={(e) => {
                                  const updated = { ...editValues };
                                  (updated[statusKey] as Record<string, string>)[prop] = e.target.value;
                                  setEditValues({ ...updated });
                                }}
                                style={{ width: "24px", height: "24px", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", padding: 0 }}
                              />
                            ) : (
                              <div style={{ width: "24px", height: "24px", borderRadius: "4px", background: color, border: "1px solid var(--card-border)", flexShrink: 0 }} />
                            )}
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{prop}</span>
                            <code style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{color}</code>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                // Flat color list
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                  {Object.entries(values).map(([colorKey, colorVal]) => {
                    const hex = typeof colorVal === "string" ? colorVal : "#000000";
                    return (
                      <div key={colorKey} style={{ display: "flex", alignItems: "center", gap: "0.375rem", minWidth: "160px" }}>
                        {isEditing ? (
                          <input
                            type="color"
                            value={hex}
                            onChange={(e) => setEditValues({ ...editValues, [colorKey]: e.target.value })}
                            style={{ width: "28px", height: "28px", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", padding: 0 }}
                          />
                        ) : (
                          <div style={{ width: "28px", height: "28px", borderRadius: "4px", background: hex, border: "1px solid var(--card-border)", flexShrink: 0 }} />
                        )}
                        <div>
                          <div style={{ fontSize: "0.8rem", fontWeight: 500 }}>{colorKey.replace(/([A-Z])/g, " $1").trim()}</div>
                          <code style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{hex}</code>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
