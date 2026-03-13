"use client";

import { useState } from "react";
import { AdminSidebar } from "@/components/SidebarLayout";
import { postApi } from "@/lib/api-client";
import {
  useAllPageConfigs,
  type PageConfigRow,
  type PageDef,
  type PageSection,
} from "@/hooks/usePageConfig";

export default function FormLayoutsPage() {
  return (
    <AdminSidebar>
      <FormLayoutsContent />
    </AdminSidebar>
  );
}

function FormLayoutsContent() {
  const { configs, isLoading, mutate } = useAllPageConfigs();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<PageConfigRow | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const selectedConfig = editingConfig || configs.find((c) => c.template_key === selectedKey) || null;

  function startEdit(config: PageConfigRow) {
    setSelectedKey(config.template_key);
    setEditingConfig(structuredClone(config));
  }

  async function saveConfig() {
    if (!editingConfig) return;
    try {
      await postApi("/api/admin/forms/layouts", {
        template_key: editingConfig.template_key,
        page_config: editingConfig.page_config,
        print_settings: editingConfig.print_settings,
      }, { method: "PUT" });
      setEditingConfig(null);
      mutate();
      showToast("Layout saved", "success");
    } catch {
      showToast("Failed to save", "error");
    }
  }

  function toggleSectionVisible(pageIdx: number, sectionIdx: number) {
    if (!editingConfig) return;
    const updated = structuredClone(editingConfig);
    updated.page_config.pages[pageIdx].sections[sectionIdx].visible =
      !updated.page_config.pages[pageIdx].sections[sectionIdx].visible;
    setEditingConfig(updated);
  }

  function moveSection(pageIdx: number, sectionIdx: number, direction: "up" | "down") {
    if (!editingConfig) return;
    const updated = structuredClone(editingConfig);
    const sections = updated.page_config.pages[pageIdx].sections;
    const swapIdx = direction === "up" ? sectionIdx - 1 : sectionIdx + 1;
    if (swapIdx < 0 || swapIdx >= sections.length) return;
    [sections[sectionIdx], sections[swapIdx]] = [sections[swapIdx], sections[sectionIdx]];
    setEditingConfig(updated);
  }

  function updateSectionLabel(pageIdx: number, sectionIdx: number, label: string) {
    if (!editingConfig) return;
    const updated = structuredClone(editingConfig);
    updated.page_config.pages[pageIdx].sections[sectionIdx].label = label;
    setEditingConfig(updated);
  }

  if (isLoading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: "900px" }}>
      {toast && (
        <div style={{ position: "fixed", top: "1rem", right: "1rem", padding: "0.75rem 1.25rem", borderRadius: "8px", background: toast.type === "success" ? "var(--success-bg, #dcfce7)" : "var(--danger-bg, #fef2f2)", color: toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)", border: `1px solid ${toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)"}`, zIndex: 1000, fontSize: "0.875rem" }}>
          {toast.message}
        </div>
      )}

      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Print Form Layouts</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Configure section order, visibility, and field layout for printed forms.
        </p>
      </div>

      {/* Template selector */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {configs.map((config) => (
          <button
            key={config.template_key}
            onClick={() => {
              if (editingConfig) return; // prevent switching while editing
              setSelectedKey(config.template_key);
            }}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--card-border)",
              background: selectedKey === config.template_key ? "var(--primary)" : "transparent",
              color: selectedKey === config.template_key ? "#fff" : "var(--text-secondary)",
              cursor: editingConfig ? "default" : "pointer",
              opacity: editingConfig && selectedKey !== config.template_key ? 0.5 : 1,
              fontSize: "0.875rem",
              fontWeight: selectedKey === config.template_key ? 500 : 400,
            }}
          >
            {config.label}
            {!config.active && <span style={{ marginLeft: "0.375rem", opacity: 0.6 }}>(inactive)</span>}
          </button>
        ))}
      </div>

      {/* Selected config detail */}
      {selectedConfig && (
        <div>
          {/* Actions bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <strong style={{ fontSize: "1rem" }}>{selectedConfig.label}</strong>
              <code style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>{selectedConfig.template_key}</code>
            </div>
            <div style={{ display: "flex", gap: "0.375rem" }}>
              {editingConfig ? (
                <>
                  <button onClick={saveConfig} style={{ padding: "0.375rem 0.75rem", background: "var(--primary)", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem" }}>Save</button>
                  <button onClick={() => setEditingConfig(null)} style={{ padding: "0.375rem 0.75rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)" }}>Cancel</button>
                </>
              ) : (
                <button onClick={() => startEdit(selectedConfig)} style={{ padding: "0.375rem 0.75rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem" }}>Edit Layout</button>
              )}
            </div>
          </div>

          {/* Print settings summary */}
          <div style={{ padding: "0.5rem 0.75rem", background: "var(--bg-secondary, #f9fafb)", borderRadius: "6px", marginBottom: "1rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {selectedConfig.print_settings.orientation} &middot; {selectedConfig.print_settings.paperSize} &middot; margins: {selectedConfig.print_settings.margins.top}
          </div>

          {/* Pages */}
          {selectedConfig.page_config.pages.map((page: PageDef, pageIdx: number) => (
            <div key={page.number} style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
                  Page {page.number}: {page.label}
                </h3>
                {page.condition && (
                  <span style={{ fontSize: "0.7rem", padding: "0.125rem 0.375rem", background: "#dbeafe", color: "#1e40af", borderRadius: "4px" }}>
                    if {page.condition}
                  </span>
                )}
              </div>

              <div style={{ border: "1px solid var(--card-border)", borderRadius: "8px", overflow: "hidden" }}>
                {page.sections.map((section: PageSection, sectionIdx: number) => (
                  <div
                    key={section.key}
                    style={{
                      padding: "0.625rem 0.75rem",
                      borderBottom: sectionIdx < page.sections.length - 1 ? "1px solid var(--card-border)" : "none",
                      opacity: section.visible ? 1 : 0.4,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    {/* Reorder buttons (editing only) */}
                    {editingConfig && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                        <button onClick={() => moveSection(pageIdx, sectionIdx, "up")} disabled={sectionIdx === 0} style={{ padding: "0 0.25rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "3px", cursor: sectionIdx === 0 ? "default" : "pointer", opacity: sectionIdx === 0 ? 0.3 : 1, fontSize: "0.65rem", lineHeight: "1.2" }}>↑</button>
                        <button onClick={() => moveSection(pageIdx, sectionIdx, "down")} disabled={sectionIdx === page.sections.length - 1} style={{ padding: "0 0.25rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "3px", cursor: sectionIdx === page.sections.length - 1 ? "default" : "pointer", opacity: sectionIdx === page.sections.length - 1 ? 0.3 : 1, fontSize: "0.65rem", lineHeight: "1.2" }}>↓</button>
                      </div>
                    )}

                    {/* Section info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        {editingConfig ? (
                          <input
                            value={section.label}
                            onChange={(e) => updateSectionLabel(pageIdx, sectionIdx, e.target.value)}
                            style={{ padding: "0.125rem 0.375rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.85rem", fontWeight: 500, width: "200px" }}
                          />
                        ) : (
                          <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{section.label}</span>
                        )}
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>{section.type}</span>
                      </div>

                      {/* Field pills */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.25rem" }}>
                        {section.fields.map((field, fIdx) => {
                          const fieldKey = typeof field === "string" ? field : field.key;
                          const fieldWidth = typeof field === "object" ? field.width : undefined;
                          return (
                            <span
                              key={fIdx}
                              style={{
                                padding: "0.0625rem 0.375rem",
                                background: "var(--bg-tertiary, #f3f4f6)",
                                borderRadius: "3px",
                                fontSize: "0.7rem",
                                color: "var(--text-muted)",
                                fontFamily: "monospace",
                              }}
                            >
                              {fieldKey}{fieldWidth ? ` (${fieldWidth})` : ""}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Visibility toggle (editing only) */}
                    {editingConfig && (
                      <button
                        onClick={() => toggleSectionVisible(pageIdx, sectionIdx)}
                        style={{
                          padding: "0.25rem 0.375rem",
                          background: "transparent",
                          border: "1px solid var(--card-border)",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                        }}
                        title={section.visible ? "Hide section" : "Show section"}
                      >
                        {section.visible ? "Visible" : "Hidden"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!selectedConfig && configs.length > 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Select a template above to view and edit its layout.</p>
      )}
    </div>
  );
}
