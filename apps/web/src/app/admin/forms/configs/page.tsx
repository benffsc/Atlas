"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import Link from "next/link";
import { useToast } from "@/components/feedback/Toast";
import { SkeletonTable } from "@/components/feedback/Skeleton";

const VALID_COMPONENTS = [
  "person", "place", "catDetails", "kittens", "propertyAccess", "urgencyNotes",
] as const;

const COMPONENT_LABELS: Record<string, string> = {
  person: "Person / Caller",
  place: "Place / Cat Location",
  catDetails: "Cat Details",
  kittens: "Kitten Assessment",
  propertyAccess: "Property & Access",
  urgencyNotes: "Urgency & Notes",
};

const PERSON_ROLES = ["requestor", "property_owner", "site_contact", "caretaker"];

interface SectionDef {
  component: string;
  label?: string;
  props?: Record<string, unknown>;
}

interface FormConfigItem {
  config_id: string;
  key: string;
  label: string;
  sections: SectionDef[];
  updated_at: string;
}

export default function FormConfigsPage() {
  return <FormConfigsContent />;
}

function FormConfigsContent() {
  const [configs, setConfigs] = useState<FormConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<FormConfigItem | null>(null);
  const [saving, setSaving] = useState(false);
  const { success: showSuccess, error: showError } = useToast();

  const loadConfigs = useCallback(async () => {
    try {
      const data = await fetchApi<{ configs: FormConfigItem[] }>("/api/admin/forms/configs");
      setConfigs(data.configs);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const selected = editing || configs.find((c) => c.config_id === selectedId) || null;

  function startEdit(config: FormConfigItem) {
    setSelectedId(config.config_id);
    setEditing(structuredClone(config));
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function saveConfig() {
    if (!editing) return;
    setSaving(true);
    try {
      await postApi("/api/admin/forms/configs", {
        config_id: editing.config_id,
        label: editing.label,
        sections: editing.sections,
      }, { method: "PUT" });
      setEditing(null);
      await loadConfigs();
      showSuccess("Form config saved");
    } catch {
      showError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function moveSection(idx: number, direction: "up" | "down") {
    if (!editing) return;
    const updated = structuredClone(editing);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= updated.sections.length) return;
    [updated.sections[idx], updated.sections[swapIdx]] = [updated.sections[swapIdx], updated.sections[idx]];
    setEditing(updated);
  }

  function removeSection(idx: number) {
    if (!editing) return;
    const updated = structuredClone(editing);
    updated.sections.splice(idx, 1);
    setEditing(updated);
  }

  function addSection(component: string) {
    if (!editing) return;
    const updated = structuredClone(editing);
    updated.sections.push({ component });
    setEditing(updated);
  }

  function updateSection(idx: number, patch: Partial<SectionDef>) {
    if (!editing) return;
    const updated = structuredClone(editing);
    updated.sections[idx] = { ...updated.sections[idx], ...patch };
    setEditing(updated);
  }

  function updateSectionProp(idx: number, propKey: string, value: unknown) {
    if (!editing) return;
    const updated = structuredClone(editing);
    const section = updated.sections[idx];
    if (!section.props) section.props = {};
    if (value === undefined || value === null) {
      delete section.props[propKey];
    } else {
      section.props[propKey] = value;
    }
    // Clean empty props object
    if (Object.keys(section.props).length === 0) delete section.props;
    setEditing(updated);
  }

  if (loading) {
    return <div style={{ padding: "2rem" }}><SkeletonTable rows={5} columns={3} /></div>;
  }

  // Components not yet in the config
  const availableComponents = editing
    ? VALID_COMPONENTS.filter((c) => !editing.sections.some((s) => s.component === c))
    : [];

  return (
    <div style={{ maxWidth: "900px" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ marginBottom: "0.5rem" }}>
          <Link href="/admin/forms" style={{ fontSize: "0.8rem", color: "var(--text-muted, #666)", textDecoration: "none" }}>
            Forms
          </Link>
          <span style={{ margin: "0 6px", color: "var(--text-muted, #ccc)" }}>/</span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-primary, #333)" }}>Section Configs</span>
        </div>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Digital Form Configs</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Configure which sections appear in each form context (new request, intake, handoff, etc.)
        </p>
      </div>

      {/* Config selector */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {configs.map((config) => (
          <button
            key={config.config_id}
            onClick={() => {
              if (editing) return;
              setSelectedId(config.config_id);
            }}
            style={{
              padding: "0.5rem 1rem", borderRadius: "6px",
              border: "1px solid var(--card-border)",
              background: selectedId === config.config_id ? "var(--primary)" : "transparent",
              color: selectedId === config.config_id ? "#fff" : "var(--text-secondary)",
              cursor: editing ? "default" : "pointer",
              opacity: editing && selectedId !== config.config_id ? 0.5 : 1,
              fontSize: "0.875rem", fontWeight: selectedId === config.config_id ? 500 : 400,
            }}
          >
            {config.label}
          </button>
        ))}
      </div>

      {/* Selected config */}
      {selected && (
        <div>
          {/* Actions bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              {editing ? (
                <input
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  style={{
                    padding: "0.25rem 0.5rem", border: "1px solid var(--card-border)",
                    borderRadius: "4px", fontSize: "1rem", fontWeight: 600,
                  }}
                />
              ) : (
                <strong style={{ fontSize: "1rem" }}>{selected.label}</strong>
              )}
              <code style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                {selected.config_id}
              </code>
            </div>
            <div style={{ display: "flex", gap: "0.375rem" }}>
              {editing ? (
                <>
                  <button
                    onClick={saveConfig}
                    disabled={saving}
                    style={{
                      padding: "0.375rem 0.75rem", background: "var(--primary)", color: "#fff",
                      border: "none", borderRadius: "6px", cursor: saving ? "wait" : "pointer",
                      fontSize: "0.8rem", opacity: saving ? 0.6 : 1,
                    }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={cancelEdit}
                    style={{
                      padding: "0.375rem 0.75rem", background: "transparent",
                      border: "1px solid var(--card-border)", borderRadius: "6px",
                      cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)",
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => startEdit(selected)}
                  style={{
                    padding: "0.375rem 0.75rem", background: "var(--primary)", color: "#fff",
                    border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem",
                    fontWeight: 500,
                  }}
                >
                  Edit Config
                </button>
              )}
            </div>
          </div>

          {/* Sections list */}
          <div style={{ border: "1px solid var(--card-border)", borderRadius: "8px", overflow: "hidden" }}>
            {selected.sections.map((section, idx) => (
              <SectionRow
                key={`${section.component}-${idx}`}
                section={section}
                idx={idx}
                total={selected.sections.length}
                editing={!!editing}
                onMove={(dir) => moveSection(idx, dir)}
                onRemove={() => removeSection(idx)}
                onUpdateLabel={(label) => updateSection(idx, { label: label || undefined })}
                onUpdateProp={(key, value) => updateSectionProp(idx, key, value)}
              />
            ))}
          </div>

          {/* Add section */}
          {editing && availableComponents.length > 0 && (
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.375rem", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginRight: "0.25rem" }}>Add section:</span>
              {availableComponents.map((comp) => (
                <button
                  key={comp}
                  onClick={() => addSection(comp)}
                  style={{
                    padding: "0.25rem 0.625rem", fontSize: "0.75rem",
                    border: "1px dashed var(--card-border)", borderRadius: "4px",
                    background: "transparent", cursor: "pointer", color: "var(--text-secondary)",
                  }}
                >
                  + {COMPONENT_LABELS[comp] || comp}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!selected && configs.length > 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Select a form config above to view and edit its section arrangement.
        </p>
      )}
    </div>
  );
}

function SectionRow({
  section,
  idx,
  total,
  editing,
  onMove,
  onRemove,
  onUpdateLabel,
  onUpdateProp,
}: {
  section: SectionDef;
  idx: number;
  total: number;
  editing: boolean;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
  onUpdateLabel: (label: string) => void;
  onUpdateProp: (key: string, value: unknown) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = section.label || COMPONENT_LABELS[section.component] || section.component;

  return (
    <div style={{ borderBottom: idx < total - 1 ? "1px solid var(--card-border)" : "none" }}>
      <div
        style={{
          padding: "0.625rem 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem",
        }}
      >
        {/* Reorder */}
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            <button
              onClick={() => onMove("up")}
              disabled={idx === 0}
              style={{
                padding: "0 4px", background: "transparent",
                border: "1px solid var(--card-border)", borderRadius: "3px",
                cursor: idx === 0 ? "default" : "pointer",
                opacity: idx === 0 ? 0.3 : 1, fontSize: "0.65rem", lineHeight: "1.2",
              }}
            >
              ↑
            </button>
            <button
              onClick={() => onMove("down")}
              disabled={idx === total - 1}
              style={{
                padding: "0 4px", background: "transparent",
                border: "1px solid var(--card-border)", borderRadius: "3px",
                cursor: idx === total - 1 ? "default" : "pointer",
                opacity: idx === total - 1 ? 0.3 : 1, fontSize: "0.65rem", lineHeight: "1.2",
              }}
            >
              ↓
            </button>
          </div>
        )}

        {/* Component badge */}
        <span
          style={{
            flex: "0 0 120px", fontSize: "0.75rem", fontFamily: "monospace",
            color: "var(--text-muted)", background: "var(--bg-tertiary, #f3f4f6)",
            padding: "2px 6px", borderRadius: "3px",
          }}
        >
          {section.component}
        </span>

        {/* Label */}
        {editing ? (
          <input
            value={section.label || ""}
            onChange={(e) => onUpdateLabel(e.target.value)}
            placeholder={COMPONENT_LABELS[section.component] || section.component}
            style={{
              flex: 1, padding: "2px 6px", border: "1px solid var(--card-border)",
              borderRadius: "4px", fontSize: "0.85rem", fontWeight: 500, minWidth: 0,
              color: section.label ? "var(--primary)" : "var(--text-muted)",
            }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: 500 }}>{label}</span>
        )}

        {/* Props indicator */}
        {section.props && Object.keys(section.props).length > 0 && (
          <button
            onClick={() => editing && setExpanded(!expanded)}
            style={{
              fontSize: "0.7rem", color: "var(--text-muted)", background: expanded ? "var(--bg-tertiary, #f3f4f6)" : "transparent",
              border: editing ? "1px solid var(--card-border)" : "none",
              borderRadius: "3px", padding: "1px 6px", cursor: editing ? "pointer" : "default",
            }}
          >
            {Object.keys(section.props).length} props
          </button>
        )}

        {/* Remove */}
        {editing && (
          <button
            onClick={onRemove}
            style={{
              padding: "0 4px", background: "transparent", border: "none",
              color: "var(--danger, #dc2626)", cursor: "pointer", fontSize: "0.85rem",
            }}
            title="Remove section"
          >
            x
          </button>
        )}
      </div>

      {/* Props editor */}
      {editing && expanded && (
        <PropsEditor
          component={section.component}
          props={section.props || {}}
          onUpdate={onUpdateProp}
        />
      )}
    </div>
  );
}

function PropsEditor({
  component,
  props,
  onUpdate,
}: {
  component: string;
  props: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  // Component-specific prop definitions
  const propDefs = getPropsForComponent(component);

  return (
    <div
      style={{
        padding: "8px 16px 12px 50px", background: "var(--bg-secondary, #f9fafb)",
        borderTop: "1px solid var(--card-border-light, #f3f4f6)",
        display: "flex", flexWrap: "wrap", gap: "10px",
      }}
    >
      {propDefs.map((def) => (
        <div key={def.key} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {def.label}:
          </label>
          {def.type === "boolean" ? (
            <input
              type="checkbox"
              checked={!!props[def.key]}
              onChange={(e) => onUpdate(def.key, e.target.checked ? true : undefined)}
              style={{ cursor: "pointer" }}
            />
          ) : def.type === "select" ? (
            <select
              value={(props[def.key] as string) || ""}
              onChange={(e) => onUpdate(def.key, e.target.value || undefined)}
              style={{
                padding: "1px 4px", fontSize: "0.75rem",
                border: "1px solid var(--card-border)", borderRadius: "3px",
              }}
            >
              <option value="">-</option>
              {def.options?.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface PropDef {
  key: string;
  label: string;
  type: "boolean" | "select";
  options?: string[];
}

function getPropsForComponent(component: string): PropDef[] {
  switch (component) {
    case "person":
      return [
        { key: "role", label: "Role", type: "select", options: PERSON_ROLES },
        { key: "allowCreate", label: "Allow Create", type: "boolean" },
        { key: "showSameAsRequestor", label: "Same as Requestor", type: "boolean" },
        { key: "required", label: "Required", type: "boolean" },
        { key: "compact", label: "Compact", type: "boolean" },
      ];
    case "place":
      return [
        { key: "showPropertyType", label: "Property Type", type: "boolean" },
        { key: "showCounty", label: "County", type: "boolean" },
        { key: "showWhereOnProperty", label: "Where on Property", type: "boolean" },
        { key: "showDescribeLocation", label: "Describe Location", type: "boolean" },
        { key: "compact", label: "Compact", type: "boolean" },
        { key: "required", label: "Required", type: "boolean" },
      ];
    case "catDetails":
      return [{ key: "compact", label: "Compact", type: "boolean" }];
    case "kittens":
      return [{ key: "compact", label: "Compact", type: "boolean" }];
    case "propertyAccess":
      return [{ key: "compact", label: "Compact", type: "boolean" }];
    case "urgencyNotes":
      return [
        { key: "showDetails", label: "Show Details", type: "boolean" },
        { key: "compact", label: "Compact", type: "boolean" },
      ];
    default:
      return [];
  }
}
