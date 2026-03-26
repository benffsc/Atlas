"use client";

import { useState } from "react";
import { useAllConfigs } from "@/hooks/useAppConfig";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";

export default function AppConfigPage() {
  return <AppConfigContent />;
}

function AppConfigContent() {
  const { configs, categories, isLoading, error, mutate } = useAllConfigs();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const { success: showSuccess, error: showError } = useToast();

  function startEdit(key: string, currentValue: unknown) {
    setEditingKey(key);
    setEditValue(
      typeof currentValue === "string"
        ? currentValue
        : JSON.stringify(currentValue, null, 2)
    );
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditValue("");
  }

  async function saveConfig(key: string) {
    setSaving(true);
    try {
      // Parse the value — try JSON first, fall back to raw string
      let parsed: unknown;
      try {
        parsed = JSON.parse(editValue);
      } catch {
        parsed = editValue;
      }

      await postApi("/api/admin/config", { key, value: parsed }, { method: "PUT" });
      await mutate();
      setEditingKey(null);
      setEditValue("");
      showSuccess(`Updated ${key}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        Loading configuration...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "2rem", color: "var(--danger)" }}>
        Failed to load configuration: {error.message}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "800px" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>App Configuration</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Runtime settings that control system behavior. Changes take effect immediately.
        </p>
      </div>

      {/* Config groups by category */}
      {categories.map((category) => {
        const categoryConfigs = configs.filter((c) => c.category === category);
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
                padding: "0.75rem 1rem",
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

            {/* Config rows */}
            {categoryConfigs.map((config, idx) => {
              const isEditing = editingKey === config.key;
              const isSimpleValue =
                typeof config.value === "number" ||
                typeof config.value === "string" ||
                typeof config.value === "boolean";

              return (
                <div
                  key={config.key}
                  style={{
                    padding: "0.75rem 1rem",
                    borderBottom:
                      idx < categoryConfigs.length - 1
                        ? "1px solid var(--card-border)"
                        : "none",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "1rem",
                  }}
                >
                  {/* Key + description */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "monospace",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                      }}
                    >
                      {config.key}
                    </div>
                    {config.description && (
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-muted)",
                          marginTop: "0.125rem",
                        }}
                      >
                        {config.description}
                      </div>
                    )}
                  </div>

                  {/* Value + actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                    {isEditing ? (
                      <>
                        {isSimpleValue ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveConfig(config.key);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            style={{
                              width: "120px",
                              padding: "0.25rem 0.5rem",
                              border: "1px solid var(--primary)",
                              borderRadius: "4px",
                              fontSize: "0.875rem",
                              fontFamily: "monospace",
                            }}
                            autoFocus
                          />
                        ) : (
                          <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") cancelEdit();
                            }}
                            style={{
                              width: "200px",
                              minHeight: "60px",
                              padding: "0.25rem 0.5rem",
                              border: "1px solid var(--primary)",
                              borderRadius: "4px",
                              fontSize: "0.8rem",
                              fontFamily: "monospace",
                              resize: "vertical",
                            }}
                            autoFocus
                          />
                        )}
                        <button
                          onClick={() => saveConfig(config.key)}
                          disabled={saving}
                          style={{
                            padding: "0.25rem 0.75rem",
                            background: "var(--primary)",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            cursor: saving ? "wait" : "pointer",
                            opacity: saving ? 0.6 : 1,
                          }}
                        >
                          {saving ? "..." : "Save"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          style={{
                            padding: "0.25rem 0.5rem",
                            background: "transparent",
                            border: "1px solid var(--card-border)",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            cursor: "pointer",
                            color: "var(--text-muted)",
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <code
                          style={{
                            padding: "0.125rem 0.5rem",
                            background: "var(--card-bg, #f9fafb)",
                            borderRadius: "4px",
                            fontSize: "0.875rem",
                            color: "var(--text-primary)",
                          }}
                        >
                          {JSON.stringify(config.value)}
                        </code>
                        <button
                          onClick={() => startEdit(config.key, config.value)}
                          style={{
                            padding: "0.25rem 0.5rem",
                            background: "transparent",
                            border: "1px solid var(--card-border)",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            cursor: "pointer",
                            color: "var(--text-muted)",
                          }}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
