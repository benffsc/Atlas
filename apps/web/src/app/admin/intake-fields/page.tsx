"use client";

import { useState, useEffect } from "react";

interface CustomField {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  is_beacon_critical: boolean;
  display_order: number;
  show_for_call_types: string[] | null;
  airtable_field_name: string | null;
  airtable_synced_at: string | null;
}

interface SyncStatus {
  total_custom_fields: number;
  needs_sync: number;
  already_synced: number;
  airtable_total_fields: number;
  fields: {
    field_id: string;
    field_label: string;
    airtable_field_name: string;
    exists_in_airtable: boolean;
    needs_sync: boolean;
  }[];
}

const FIELD_TYPES = [
  { value: "text", label: "Text (single line)" },
  { value: "textarea", label: "Text (multi-line)" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown (single)" },
  { value: "multiselect", label: "Dropdown (multiple)" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "phone", label: "Phone Number" },
  { value: "email", label: "Email" },
];

const CALL_TYPES = [
  { value: "pet_spay_neuter", label: "Pet Spay/Neuter" },
  { value: "wellness_check", label: "Wellness Check" },
  { value: "single_stray", label: "Single Stray" },
  { value: "colony_tnr", label: "Colony TNR" },
  { value: "kitten_rescue", label: "Kitten Rescue" },
  { value: "medical_concern", label: "Medical Concern" },
];

function generateFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 40);
}

export default function IntakeFieldsAdminPage() {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form state for add/edit
  const [form, setForm] = useState({
    field_key: "",
    field_label: "",
    field_type: "text",
    options: [] as { value: string; label: string }[],
    placeholder: "",
    help_text: "",
    is_required: false,
    is_beacon_critical: false,
    display_order: 0,
    show_for_call_types: [] as string[],
  });
  const [newOption, setNewOption] = useState("");

  // Fetch fields
  const fetchFields = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/intake-fields");
      const data = await response.json();
      setFields(data.fields || []);
    } catch (err) {
      console.error("Failed to fetch fields:", err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch sync status
  const fetchSyncStatus = async () => {
    try {
      const response = await fetch("/api/admin/intake-fields/sync-airtable");
      const data = await response.json();
      setSyncStatus(data);
    } catch (err) {
      console.error("Failed to fetch sync status:", err);
    }
  };

  useEffect(() => {
    fetchFields();
    fetchSyncStatus();
  }, []);

  // Auto-generate field key from label
  useEffect(() => {
    if (!editingField && form.field_label) {
      setForm(f => ({ ...f, field_key: generateFieldKey(f.field_label) }));
    }
  }, [form.field_label, editingField]);

  const resetForm = () => {
    setForm({
      field_key: "",
      field_label: "",
      field_type: "text",
      options: [],
      placeholder: "",
      help_text: "",
      is_required: false,
      is_beacon_critical: false,
      display_order: fields.length,
      show_for_call_types: [],
    });
    setNewOption("");
  };

  const openAddModal = () => {
    resetForm();
    setEditingField(null);
    setShowAddModal(true);
  };

  const openEditModal = (field: CustomField) => {
    setEditingField(field);
    setForm({
      field_key: field.field_key,
      field_label: field.field_label,
      field_type: field.field_type,
      options: field.options || [],
      placeholder: field.placeholder || "",
      help_text: field.help_text || "",
      is_required: field.is_required,
      is_beacon_critical: field.is_beacon_critical,
      display_order: field.display_order,
      show_for_call_types: field.show_for_call_types || [],
    });
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingField(null);
    resetForm();
  };

  const addOption = () => {
    if (newOption.trim()) {
      setForm(f => ({
        ...f,
        options: [...f.options, { value: newOption.trim().toLowerCase().replace(/\s+/g, "_"), label: newOption.trim() }],
      }));
      setNewOption("");
    }
  };

  const removeOption = (index: number) => {
    setForm(f => ({
      ...f,
      options: f.options.filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const url = editingField
        ? `/api/admin/intake-fields/${editingField.field_id}`
        : "/api/admin/intake-fields";
      const method = editingField ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          options: form.options.length > 0 ? form.options : null,
          show_for_call_types: form.show_for_call_types.length > 0 ? form.show_for_call_types : null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save");
      }

      setMessage({ type: "success", text: editingField ? "Field updated!" : "Field created!" });
      closeModal();
      fetchFields();
      fetchSyncStatus();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (field: CustomField) => {
    if (!confirm(`Delete field "${field.field_label}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/admin/intake-fields/${field.field_id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete");
      }

      setMessage({ type: "success", text: "Field deleted" });
      fetchFields();
      fetchSyncStatus();
    } catch (err) {
      setMessage({ type: "error", text: "Failed to delete field" });
    }
  };

  const handleSyncToAirtable = async () => {
    setSyncing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/intake-fields/sync-airtable", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Sync failed");
      }

      setMessage({
        type: "success",
        text: `Synced ${data.synced} fields to Airtable. ${data.skipped} already existed.`,
      });
      fetchSyncStatus();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Intake Form Fields</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0" }}>
            Add custom questions to the intake form
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={openAddModal}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            + Add Field
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "6px",
            marginBottom: "1rem",
            background: message.type === "success" ? "rgba(25, 135, 84, 0.15)" : "rgba(220, 53, 69, 0.15)",
            color: message.type === "success" ? "#198754" : "#dc3545",
          }}
        >
          {message.text}
        </div>
      )}

      {/* Airtable Sync Card */}
      <div
        style={{
          background: "var(--card-bg, rgba(0,0,0,0.05))",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Airtable Sync</h3>
            {syncStatus && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
                {syncStatus.needs_sync > 0 ? (
                  <span style={{ color: "#ffc107" }}>
                    {syncStatus.needs_sync} field{syncStatus.needs_sync !== 1 ? "s" : ""} need{syncStatus.needs_sync === 1 ? "s" : ""} to be synced
                  </span>
                ) : (
                  <span style={{ color: "#198754" }}>All fields are synced</span>
                )}
                {" · "}{syncStatus.already_synced} synced · {syncStatus.airtable_total_fields} total in Airtable
              </p>
            )}
          </div>
          <button
            onClick={handleSyncToAirtable}
            disabled={syncing || (syncStatus?.needs_sync === 0)}
            style={{
              padding: "0.5rem 1rem",
              background: syncStatus?.needs_sync ? "#0d6efd" : "#6c757d",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: syncing || !syncStatus?.needs_sync ? "not-allowed" : "pointer",
              opacity: syncing || !syncStatus?.needs_sync ? 0.7 : 1,
            }}
          >
            {syncing ? "Syncing..." : "Sync to Airtable"}
          </button>
        </div>
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
          After syncing, add the same fields to your Jotform and map them to the new Airtable columns.
        </p>
      </div>

      {/* Fields List */}
      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
      ) : fields.length === 0 ? (
        <div
          style={{
            padding: "3rem",
            textAlign: "center",
            background: "var(--card-bg, rgba(0,0,0,0.05))",
            borderRadius: "8px",
          }}
        >
          <p style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No custom fields yet</p>
          <p style={{ color: "var(--muted)", margin: "0 0 1rem" }}>
            Add custom questions that will appear on the intake form and sync to Airtable.
          </p>
          <button
            onClick={openAddModal}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Add Your First Field
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {fields.map((field) => (
            <div
              key={field.field_id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "1rem",
                background: "var(--card-bg, rgba(0,0,0,0.05))",
                borderRadius: "8px",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 500 }}>{field.field_label}</span>
                  {field.is_required && (
                    <span style={{ fontSize: "0.7rem", background: "#dc3545", color: "#fff", padding: "1px 6px", borderRadius: "3px" }}>
                      Required
                    </span>
                  )}
                  {field.is_beacon_critical && (
                    <span style={{ fontSize: "0.7rem", background: "#0d6efd", color: "#fff", padding: "1px 6px", borderRadius: "3px" }}>
                      Beacon
                    </span>
                  )}
                  {field.airtable_synced_at && (
                    <span style={{ fontSize: "0.7rem", background: "#198754", color: "#fff", padding: "1px 6px", borderRadius: "3px" }}>
                      Synced
                    </span>
                  )}
                  {!field.airtable_synced_at && (
                    <span style={{ fontSize: "0.7rem", background: "#ffc107", color: "#000", padding: "1px 6px", borderRadius: "3px" }}>
                      Needs Sync
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  Type: {FIELD_TYPES.find(t => t.value === field.field_type)?.label || field.field_type}
                  {field.options && field.options.length > 0 && (
                    <span> · {field.options.length} options</span>
                  )}
                  {field.show_for_call_types && field.show_for_call_types.length > 0 && (
                    <span> · Shows for: {field.show_for_call_types.length} call types</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => openEditModal(field)}
                  style={{
                    padding: "0.25rem 0.75rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(field)}
                  style={{
                    padding: "0.25rem 0.75rem",
                    background: "transparent",
                    border: "1px solid #dc3545",
                    color: "#dc3545",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "550px",
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem" }}>
              {editingField ? "Edit Field" : "Add Custom Field"}
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Field Label */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Field Label *
                </label>
                <input
                  type="text"
                  value={form.field_label}
                  onChange={(e) => setForm({ ...form, field_label: e.target.value })}
                  placeholder="e.g., How did you hear about us?"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              {/* Field Key */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Field Key *
                </label>
                <input
                  type="text"
                  value={form.field_key}
                  onChange={(e) => setForm({ ...form, field_key: e.target.value })}
                  placeholder="e.g., referral_source"
                  style={{ width: "100%", padding: "0.5rem", fontFamily: "monospace" }}
                  disabled={!!editingField}
                />
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                  Auto-generated from label. Used in database and API.
                </p>
              </div>

              {/* Field Type */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Field Type *
                </label>
                <select
                  value={form.field_type}
                  onChange={(e) => setForm({ ...form, field_type: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Options for select fields */}
              {(form.field_type === "select" || form.field_type === "multiselect") && (
                <div>
                  <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                    Options *
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <input
                      type="text"
                      value={newOption}
                      onChange={(e) => setNewOption(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addOption())}
                      placeholder="Add an option..."
                      style={{ flex: 1, padding: "0.5rem" }}
                    />
                    <button
                      type="button"
                      onClick={addOption}
                      style={{
                        padding: "0.5rem 1rem",
                        background: "var(--foreground)",
                        color: "var(--background)",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {form.options.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {form.options.map((opt, i) => (
                        <span
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "0.25rem 0.5rem",
                            background: "var(--card-bg, rgba(0,0,0,0.1))",
                            borderRadius: "4px",
                            fontSize: "0.85rem",
                          }}
                        >
                          {opt.label}
                          <button
                            type="button"
                            onClick={() => removeOption(i)}
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              padding: "0",
                              color: "#dc3545",
                              fontSize: "1rem",
                              lineHeight: 1,
                            }}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Placeholder */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Placeholder Text
                </label>
                <input
                  type="text"
                  value={form.placeholder}
                  onChange={(e) => setForm({ ...form, placeholder: e.target.value })}
                  placeholder="Optional placeholder..."
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              {/* Help Text */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Help Text
                </label>
                <input
                  type="text"
                  value={form.help_text}
                  onChange={(e) => setForm({ ...form, help_text: e.target.value })}
                  placeholder="Shown below the field..."
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              {/* Show for Call Types */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Show for Call Types
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {CALL_TYPES.map((type) => (
                    <label
                      key={type.value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        padding: "0.25rem 0.5rem",
                        background: form.show_for_call_types.includes(type.value)
                          ? "rgba(13, 110, 253, 0.15)"
                          : "var(--card-bg, rgba(0,0,0,0.05))",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.show_for_call_types.includes(type.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setForm({ ...form, show_for_call_types: [...form.show_for_call_types, type.value] });
                          } else {
                            setForm({ ...form, show_for_call_types: form.show_for_call_types.filter(t => t !== type.value) });
                          }
                        }}
                      />
                      {type.label}
                    </label>
                  ))}
                </div>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                  Leave all unchecked to show for all call types
                </p>
              </div>

              {/* Flags */}
              <div style={{ display: "flex", gap: "1.5rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.is_required}
                    onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
                  />
                  <span>Required</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.is_beacon_critical}
                    onChange={(e) => setForm({ ...form, is_beacon_critical: e.target.checked })}
                  />
                  <span>Beacon Critical</span>
                </label>
              </div>

              {/* Display Order */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Display Order
                </label>
                <input
                  type="number"
                  value={form.display_order}
                  onChange={(e) => setForm({ ...form, display_order: parseInt(e.target.value) || 0 })}
                  style={{ width: "100px", padding: "0.5rem" }}
                />
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                  Lower numbers appear first
                </p>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={closeModal}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.field_label || !form.field_key}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#198754",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving || !form.field_label ? 0.7 : 1,
                }}
              >
                {saving ? "Saving..." : editingField ? "Update Field" : "Create Field"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
