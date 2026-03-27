"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { useAllDisplayLabels } from "@/hooks/useDisplayLabels";
import { useToast } from "@/components/feedback/Toast";
import { SkeletonTable } from "@/components/feedback/Skeleton";

const REGISTRY_LABELS: Record<string, string> = {
  place_kind: "Place Kinds",
  role: "Person-Place Roles",
  relationship: "Person-Cat Relationships",
  triage: "Triage Categories",
  request_status: "Request Statuses",
  source_system: "Source Systems",
  source_table: "Source Tables",
  match_reason: "Match Reasons",
  match_reason_short: "Match Reasons (Short)",
  match_field: "Match Fields",
};

export default function LabelsPage() {
  return <LabelsContent />;
}

function LabelsContent() {
  const { labels, registries, isLoading, mutate } = useAllDisplayLabels();
  const [selectedRegistry, setSelectedRegistry] = useState<string>("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const { success: showSuccess, error: showError } = useToast();

  const activeRegistry = selectedRegistry || registries[0] || "";
  const filtered = labels
    .filter((l) => l.registry === activeRegistry)
    .sort((a, b) => a.sort_order - b.sort_order);

  function startEdit(key: string, currentLabel: string) {
    setEditingKey(key);
    setEditValue(currentLabel);
  }

  async function saveEdit(registry: string, key: string) {
    if (!editValue.trim()) return;
    try {
      await postApi("/api/admin/labels", { registry, key, label: editValue.trim() }, { method: "PUT" });
      setEditingKey(null);
      mutate();
      showSuccess("Label saved");
    } catch {
      showError("Failed to save");
    }
  }

  if (isLoading) {
    return <div style={{ padding: "2rem" }}><SkeletonTable rows={8} columns={3} /></div>;
  }

  return (
    <div style={{ maxWidth: "800px" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Display Labels</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Edit human-readable labels for database enum values shown throughout the UI.
        </p>
      </div>

      {/* Registry selector */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "1rem" }}>
        {registries.map((reg) => (
          <button
            key={reg}
            onClick={() => setSelectedRegistry(reg)}
            style={{
              padding: "0.375rem 0.75rem",
              borderRadius: "6px",
              border: "1px solid var(--card-border)",
              background: reg === activeRegistry ? "var(--primary)" : "transparent",
              color: reg === activeRegistry ? "#fff" : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: reg === activeRegistry ? 500 : 400,
            }}
          >
            {REGISTRY_LABELS[reg] || reg}
          </button>
        ))}
      </div>

      {/* Label list */}
      <div style={{ border: "1px solid var(--card-border)", borderRadius: "8px", overflow: "hidden" }}>
        <div style={{ padding: "0.5rem 1rem", background: "var(--bg-secondary, #f9fafb)", borderBottom: "1px solid var(--card-border)", display: "flex", gap: "1rem", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>
          <span style={{ width: "200px" }}>Key</span>
          <span style={{ flex: 1 }}>Display Label</span>
          <span style={{ width: "60px" }}></span>
        </div>

        {filtered.length === 0 && (
          <div style={{ padding: "1rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
            No labels in this registry.
          </div>
        )}

        {filtered.map((label, idx) => {
          const isEditing = editingKey === label.key;

          return (
            <div
              key={label.key}
              style={{
                padding: "0.5rem 1rem",
                borderBottom: idx < filtered.length - 1 ? "1px solid var(--card-border)" : "none",
                display: "flex",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <code style={{ width: "200px", fontSize: "0.8rem", color: "var(--text-muted)", flexShrink: 0 }}>
                {label.key}
              </code>

              {isEditing ? (
                <>
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(activeRegistry, label.key)}
                    style={{ flex: 1, padding: "0.25rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.875rem" }}
                    autoFocus
                  />
                  <div style={{ display: "flex", gap: "0.25rem", width: "100px", flexShrink: 0 }}>
                    <button onClick={() => saveEdit(activeRegistry, label.key)} style={{ padding: "0.25rem 0.375rem", background: "var(--primary)", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }}>Save</button>
                    <button onClick={() => setEditingKey(null)} style={{ padding: "0.25rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", color: "var(--text-muted)" }}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: "0.875rem" }}>{label.label}</span>
                  <button
                    onClick={() => startEdit(label.key, label.label)}
                    style={{ padding: "0.25rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", width: "60px", flexShrink: 0 }}
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
        {filtered.length} labels in &quot;{REGISTRY_LABELS[activeRegistry] || activeRegistry}&quot;
      </p>
    </div>
  );
}
