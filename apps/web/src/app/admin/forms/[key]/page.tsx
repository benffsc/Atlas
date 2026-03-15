"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { AdminSidebar } from "@/components/SidebarLayout";
import Link from "next/link";

const VALID_KEYS = ["help_request", "tnr_call_sheet", "trapper_sheet"];

const FIELD_TYPE_COLORS: Record<string, string> = {
  text: "#3b82f6",
  number: "#8b5cf6",
  boolean: "#f59e0b",
  select: "#10b981",
  multi_select: "#06b6d4",
  date: "#ec4899",
  textarea: "#6366f1",
  phone: "#14b8a6",
  email: "#f97316",
};

const WIDTH_OPTIONS = ["sm", "md", "lg", "xl"];

interface TemplateField {
  id: string;
  sort_order: number;
  is_required: boolean;
  section_name: string;
  field_width: string;
  override_label: string | null;
  field_key: string;
  label: string;
  field_type: string;
  category: string;
  options: string[] | null;
  description: string | null;
}

interface FieldUpdate {
  id: string;
  sort_order?: number;
  is_required?: boolean;
  override_label?: string | null;
  section_name?: string;
  field_width?: string;
}

export default function FormTemplatePage() {
  const params = useParams();
  const key = params.key as string;

  if (!VALID_KEYS.includes(key)) {
    return (
      <AdminSidebar>
        <div style={{ padding: "2rem", color: "var(--danger, #e74c3c)" }}>
          Invalid template key: {key}
        </div>
      </AdminSidebar>
    );
  }

  return (
    <AdminSidebar>
      <TemplateEditor templateKey={key} />
    </AdminSidebar>
  );
}

function TemplateEditor({ templateKey }: { templateKey: string }) {
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<TemplateField[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [editingOptions, setEditingOptions] = useState<string | null>(null); // field id being edited

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const loadFields = useCallback(async () => {
    try {
      const data = await fetchApi<{ template_key: string; template_name: string; fields: TemplateField[] }>(
        `/api/admin/forms/templates/${templateKey}/fields`
      );
      setFields(data.fields);
      setTemplateName(data.template_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [templateKey]);

  useEffect(() => { loadFields(); }, [loadFields]);

  function startEdit() {
    setEditFields(structuredClone(fields));
    setEditing(true);
  }

  function cancelEdit() {
    setEditFields([]);
    setEditing(false);
    setEditingOptions(null);
  }

  async function saveChanges() {
    setSaving(true);
    try {
      // Build updates: only send fields that changed
      const updates: FieldUpdate[] = [];
      for (let i = 0; i < editFields.length; i++) {
        const ef = editFields[i];
        const of_ = fields.find((f) => f.id === ef.id);
        if (!of_) continue;

        const update: FieldUpdate = { id: ef.id };
        let changed = false;

        if (ef.sort_order !== of_.sort_order) { update.sort_order = ef.sort_order; changed = true; }
        if (ef.is_required !== of_.is_required) { update.is_required = ef.is_required; changed = true; }
        if (ef.override_label !== of_.override_label) { update.override_label = ef.override_label; changed = true; }
        if (ef.section_name !== of_.section_name) { update.section_name = ef.section_name; changed = true; }
        if (ef.field_width !== of_.field_width) { update.field_width = ef.field_width; changed = true; }

        if (changed) updates.push(update);
      }

      if (updates.length > 0) {
        await postApi(`/api/admin/forms/templates/${templateKey}/fields`, { fields: updates }, { method: "PUT" });
      }

      await loadFields();
      setEditing(false);
      setEditingOptions(null);
      showToast(`Saved ${updates.length} field${updates.length !== 1 ? "s" : ""}`, "success");
    } catch {
      showToast("Failed to save changes", "error");
    } finally {
      setSaving(false);
    }
  }

  function updateField(id: string, patch: Partial<TemplateField>) {
    setEditFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function moveField(idx: number, direction: "up" | "down") {
    setEditFields((prev) => {
      const next = [...prev];
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      // Renumber sort_order
      return next.map((f, i) => ({ ...f, sort_order: (i + 1) * 10 }));
    });
  }

  if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
  if (error) return <div style={{ padding: "2rem", color: "var(--danger, #e74c3c)" }}>Error: {error}</div>;

  const displayFields = editing ? editFields : fields;

  // Group by section
  const sections: { name: string; fields: { field: TemplateField; idx: number }[] }[] = [];
  const sectionMap = new Map<string, { field: TemplateField; idx: number }[]>();
  const sectionOrder: string[] = [];

  for (let i = 0; i < displayFields.length; i++) {
    const f = displayFields[i];
    if (!sectionMap.has(f.section_name)) {
      sectionMap.set(f.section_name, []);
      sectionOrder.push(f.section_name);
    }
    sectionMap.get(f.section_name)!.push({ field: f, idx: i });
  }
  for (const name of sectionOrder) {
    sections.push({ name, fields: sectionMap.get(name)! });
  }

  // Count changes
  const changeCount = editing
    ? editFields.filter((ef) => {
        const of_ = fields.find((f) => f.id === ef.id);
        if (!of_) return false;
        return (
          ef.sort_order !== of_.sort_order ||
          ef.is_required !== of_.is_required ||
          ef.override_label !== of_.override_label ||
          ef.section_name !== of_.section_name ||
          ef.field_width !== of_.field_width
        );
      }).length
    : 0;

  return (
    <div style={{ maxWidth: "1000px" }}>
      {toast && (
        <div
          style={{
            position: "fixed", top: "1rem", right: "1rem", padding: "0.75rem 1.25rem",
            borderRadius: "8px", zIndex: 1000, fontSize: "0.875rem",
            background: toast.type === "success" ? "var(--success-bg, #dcfce7)" : "var(--danger-bg, #fef2f2)",
            color: toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)",
            border: `1px solid ${toast.type === "success" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)"}`,
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Breadcrumb */}
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/admin/forms" style={{ fontSize: "0.8rem", color: "var(--text-muted, #666)", textDecoration: "none" }}>
          Forms
        </Link>
        <span style={{ margin: "0 6px", color: "var(--text-muted, #ccc)" }}>/</span>
        <span style={{ fontSize: "0.8rem", color: "var(--text-primary, #333)" }}>{templateName}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>{templateName}</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted, #666)", fontSize: "0.875rem" }}>
            {displayFields.length} fields across {sections.length} sections
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {editing ? (
            <>
              {changeCount > 0 && (
                <span style={{ fontSize: "0.75rem", color: "var(--primary, #27ae60)", fontWeight: 500 }}>
                  {changeCount} change{changeCount !== 1 ? "s" : ""}
                </span>
              )}
              <button
                onClick={saveChanges}
                disabled={saving || changeCount === 0}
                style={{
                  padding: "0.375rem 0.875rem", background: "var(--primary, #27ae60)", color: "#fff",
                  border: "none", borderRadius: "6px", cursor: saving ? "wait" : "pointer",
                  fontSize: "0.85rem", fontWeight: 500, opacity: saving || changeCount === 0 ? 0.6 : 1,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={cancelEdit}
                style={{
                  padding: "0.375rem 0.875rem", background: "transparent",
                  border: "1px solid var(--card-border, #e5e7eb)", borderRadius: "6px",
                  cursor: "pointer", fontSize: "0.85rem", color: "var(--text-muted, #666)",
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startEdit}
                style={{
                  padding: "0.375rem 0.875rem", background: "var(--primary, #27ae60)", color: "#fff",
                  border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500,
                }}
              >
                Edit Fields
              </button>
              <Link
                href={`/admin/forms/preview/${templateKey}`}
                style={{
                  padding: "0.375rem 0.875rem", background: "transparent",
                  border: "1px solid var(--card-border, #e5e7eb)", borderRadius: "6px",
                  fontSize: "0.85rem", textDecoration: "none", color: "var(--text-primary, #333)",
                }}
              >
                Preview
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Sections */}
      {sections.map((section) => (
        <div
          key={section.name}
          style={{
            border: "1px solid var(--card-border, #e5e7eb)", borderRadius: "8px",
            marginBottom: "12px", overflow: "hidden",
          }}
        >
          {/* Section header */}
          <div
            style={{
              background: "var(--bg-secondary, #f9fafb)", padding: "10px 16px",
              fontWeight: 600, fontSize: "0.9rem",
              borderBottom: "1px solid var(--card-border, #e5e7eb)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}
          >
            <span>{section.name}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #888)", fontWeight: 400 }}>
              {section.fields.length} fields
            </span>
          </div>

          {/* Fields */}
          <div>
            {section.fields.map(({ field, idx }) => (
              <FieldRow
                key={field.id}
                field={field}
                editing={editing}
                globalIdx={idx}
                totalFields={displayFields.length}
                onUpdate={(patch) => updateField(field.id, patch)}
                onMove={(dir) => moveField(idx, dir)}
                editingOptions={editingOptions}
                onToggleOptions={() => setEditingOptions(editingOptions === field.id ? null : field.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldRow({
  field,
  editing,
  globalIdx,
  totalFields,
  onUpdate,
  onMove,
  editingOptions,
  onToggleOptions,
}: {
  field: TemplateField;
  editing: boolean;
  globalIdx: number;
  totalFields: number;
  onUpdate: (patch: Partial<TemplateField>) => void;
  onMove: (direction: "up" | "down") => void;
  editingOptions: string | null;
  onToggleOptions: () => void;
}) {
  const typeColor = FIELD_TYPE_COLORS[field.field_type] || "#888";
  const isEditingOptions = editingOptions === field.id;
  const hasOptions = field.field_type === "select" || field.field_type === "multi_select";

  return (
    <div style={{ borderBottom: "1px solid var(--card-border-light, #f3f4f6)" }}>
      <div
        style={{
          display: "flex", alignItems: "center", padding: "8px 16px",
          fontSize: "0.85rem", gap: "10px",
        }}
      >
        {/* Reorder */}
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1px", flexShrink: 0 }}>
            <button
              onClick={() => onMove("up")}
              disabled={globalIdx === 0}
              style={{
                padding: "0 4px", background: "transparent",
                border: "1px solid var(--card-border, #e5e7eb)", borderRadius: "3px",
                cursor: globalIdx === 0 ? "default" : "pointer",
                opacity: globalIdx === 0 ? 0.3 : 1, fontSize: "0.65rem", lineHeight: "1.2",
              }}
            >
              ↑
            </button>
            <button
              onClick={() => onMove("down")}
              disabled={globalIdx === totalFields - 1}
              style={{
                padding: "0 4px", background: "transparent",
                border: "1px solid var(--card-border, #e5e7eb)", borderRadius: "3px",
                cursor: globalIdx === totalFields - 1 ? "default" : "pointer",
                opacity: globalIdx === totalFields - 1 ? 0.3 : 1, fontSize: "0.65rem", lineHeight: "1.2",
              }}
            >
              ↓
            </button>
          </div>
        )}

        {/* Field key */}
        <code
          style={{
            flex: "0 0 170px", fontSize: "0.75rem", color: "var(--text-muted, #666)",
            fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis",
          }}
          title={field.field_key}
        >
          {field.field_key}
        </code>

        {/* Label */}
        {editing ? (
          <input
            value={field.override_label ?? field.label}
            onChange={(e) => onUpdate({ override_label: e.target.value || null })}
            placeholder={field.label}
            style={{
              flex: 1, padding: "2px 6px", border: "1px solid var(--card-border, #e5e7eb)",
              borderRadius: "4px", fontSize: "0.85rem", fontWeight: 500,
              color: field.override_label ? "var(--primary, #27ae60)" : "var(--text-primary, #333)",
              minWidth: 0,
            }}
            title={field.override_label ? `Override (original: ${field.label})` : "Default label"}
          />
        ) : (
          <span
            style={{
              flex: 1, fontWeight: 500, minWidth: 0,
              color: field.override_label ? "var(--primary, #27ae60)" : undefined,
            }}
            title={field.override_label ? `Override (original: ${field.label})` : undefined}
          >
            {field.override_label || field.label}
          </span>
        )}

        {/* Type badge */}
        <span
          style={{
            flex: "0 0 85px", background: `${typeColor}15`, color: typeColor,
            padding: "2px 8px", borderRadius: "4px", fontSize: "0.7rem",
            fontWeight: 600, textAlign: "center",
          }}
        >
          {field.field_type}
        </span>

        {/* Width */}
        {editing ? (
          <select
            value={field.field_width}
            onChange={(e) => onUpdate({ field_width: e.target.value })}
            style={{
              flex: "0 0 55px", padding: "1px 2px", fontSize: "0.7rem",
              border: "1px solid var(--card-border, #e5e7eb)", borderRadius: "3px",
            }}
          >
            {WIDTH_OPTIONS.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        ) : (
          <span style={{ flex: "0 0 40px", fontSize: "0.7rem", color: "var(--text-muted, #888)", textAlign: "center" }}>
            {field.field_width}
          </span>
        )}

        {/* Required toggle */}
        {editing ? (
          <button
            onClick={() => onUpdate({ is_required: !field.is_required })}
            style={{
              flex: "0 0 50px", padding: "2px 6px", fontSize: "0.7rem", fontWeight: 600,
              border: "1px solid",
              borderColor: field.is_required ? "var(--danger, #e74c3c)" : "var(--card-border, #e5e7eb)",
              background: field.is_required ? "var(--danger-bg, #fef2f2)" : "transparent",
              color: field.is_required ? "var(--danger, #e74c3c)" : "var(--text-muted, #888)",
              borderRadius: "4px", cursor: "pointer",
            }}
          >
            {field.is_required ? "req" : "opt"}
          </button>
        ) : (
          field.is_required && (
            <span style={{ flex: "0 0 50px", fontSize: "0.7rem", color: "var(--danger, #e74c3c)", fontWeight: 600, textAlign: "center" }}>
              req
            </span>
          )
        )}

        {/* Options count / edit */}
        {hasOptions && (
          <button
            onClick={editing ? onToggleOptions : undefined}
            style={{
              fontSize: "0.7rem", color: "var(--text-muted, #888)",
              background: isEditingOptions ? "var(--bg-tertiary, #f3f4f6)" : "transparent",
              border: editing ? "1px solid var(--card-border, #e5e7eb)" : "none",
              borderRadius: "3px", padding: "1px 6px",
              cursor: editing ? "pointer" : "default",
            }}
          >
            [{field.options?.length || 0} opts]
          </button>
        )}
      </div>

      {/* Options editor (expanded) */}
      {isEditingOptions && editing && hasOptions && (
        <OptionsEditor
          fieldId={field.id}
          fieldKey={field.field_key}
          options={field.options || []}
          onSaved={() => onToggleOptions()}
        />
      )}
    </div>
  );
}

function OptionsEditor({
  fieldId,
  fieldKey,
  options,
  onSaved,
}: {
  fieldId: string;
  fieldKey: string;
  options: string[];
  onSaved: () => void;
}) {
  const [editOptions, setEditOptions] = useState<string[]>([...options]);
  const [newOption, setNewOption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addOption() {
    const val = newOption.trim();
    if (!val || editOptions.includes(val)) return;
    setEditOptions([...editOptions, val]);
    setNewOption("");
  }

  function removeOption(idx: number) {
    setEditOptions(editOptions.filter((_, i) => i !== idx));
  }

  function moveOption(idx: number, direction: "up" | "down") {
    const next = [...editOptions];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setEditOptions(next);
  }

  async function saveOptions() {
    setSaving(true);
    setError(null);
    try {
      await postApi(`/api/admin/forms/fields/${fieldId}`, { options: editOptions }, { method: "PUT" });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const hasChanges =
    editOptions.length !== options.length ||
    editOptions.some((o, i) => o !== options[i]);

  return (
    <div
      style={{
        padding: "12px 16px 12px 50px",
        background: "var(--bg-secondary, #f9fafb)",
        borderTop: "1px solid var(--card-border-light, #f3f4f6)",
      }}
    >
      <div style={{ marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>
          Options for <code style={{ fontSize: "0.75rem" }}>{fieldKey}</code>
        </span>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={saveOptions}
            disabled={saving || !hasChanges}
            style={{
              padding: "2px 10px", fontSize: "0.75rem", fontWeight: 500,
              background: hasChanges ? "var(--primary, #27ae60)" : "transparent",
              color: hasChanges ? "#fff" : "var(--text-muted, #888)",
              border: hasChanges ? "none" : "1px solid var(--card-border, #e5e7eb)",
              borderRadius: "4px", cursor: saving || !hasChanges ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving..." : "Save Options"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: "0.75rem", color: "var(--danger, #dc2626)", marginBottom: "6px" }}>{error}</div>
      )}

      {/* Option list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginBottom: "8px" }}>
        {editOptions.map((opt, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ display: "flex", gap: "1px" }}>
              <button
                onClick={() => moveOption(idx, "up")}
                disabled={idx === 0}
                style={{
                  padding: "0 3px", background: "transparent", border: "1px solid var(--card-border, #e5e7eb)",
                  borderRadius: "2px", fontSize: "0.6rem", cursor: idx === 0 ? "default" : "pointer",
                  opacity: idx === 0 ? 0.3 : 1,
                }}
              >
                ↑
              </button>
              <button
                onClick={() => moveOption(idx, "down")}
                disabled={idx === editOptions.length - 1}
                style={{
                  padding: "0 3px", background: "transparent", border: "1px solid var(--card-border, #e5e7eb)",
                  borderRadius: "2px", fontSize: "0.6rem", cursor: idx === editOptions.length - 1 ? "default" : "pointer",
                  opacity: idx === editOptions.length - 1 ? 0.3 : 1,
                }}
              >
                ↓
              </button>
            </div>
            <code
              style={{
                flex: 1, fontSize: "0.75rem", padding: "2px 6px",
                background: "#fff", border: "1px solid var(--card-border, #e5e7eb)",
                borderRadius: "3px",
              }}
            >
              {opt}
            </code>
            <button
              onClick={() => removeOption(idx)}
              style={{
                padding: "0 4px", background: "transparent", border: "none",
                color: "var(--danger, #dc2626)", cursor: "pointer", fontSize: "0.8rem",
              }}
              title="Remove option"
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* Add option */}
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
          placeholder="new_option_value"
          style={{
            flex: 1, padding: "3px 8px", fontSize: "0.75rem", fontFamily: "monospace",
            border: "1px solid var(--card-border, #e5e7eb)", borderRadius: "4px",
          }}
        />
        <button
          onClick={addOption}
          disabled={!newOption.trim()}
          style={{
            padding: "3px 10px", fontSize: "0.75rem", background: "transparent",
            border: "1px solid var(--card-border, #e5e7eb)", borderRadius: "4px",
            cursor: newOption.trim() ? "pointer" : "default",
            opacity: newOption.trim() ? 1 : 0.5,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
