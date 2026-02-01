"use client";

import { useState, useEffect, useCallback } from "react";

interface DiseaseType {
  disease_key: string;
  display_label: string;
  short_code: string;
  color: string;
  severity_order: number;
  decay_window_months: number;
  is_contagious: boolean;
  description: string | null;
  is_active: boolean;
  created_at: string;
  active_place_count: number;
  historical_place_count: number;
  total_place_count: number;
}

interface FormState {
  disease_key: string;
  display_label: string;
  short_code: string;
  color: string;
  decay_window_months: number;
  is_contagious: boolean;
  description: string;
}

const DEFAULT_FORM: FormState = {
  disease_key: "",
  display_label: "",
  short_code: "",
  color: "#dc3545",
  decay_window_months: 36,
  is_contagious: false,
  description: "",
};

export default function DiseaseTypesPage() {
  const [diseaseTypes, setDiseaseTypes] = useState<DiseaseType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });

  // Inline editing
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    display_label: string;
    color: string;
    decay_window_months: number;
    is_contagious: boolean;
    description: string;
    is_active: boolean;
  }>({
    display_label: "",
    color: "",
    decay_window_months: 36,
    is_contagious: false,
    description: "",
    is_active: true,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/disease-types");
      if (!response.ok) throw new Error("Failed to fetch disease types");
      const data = await response.json();
      setDiseaseTypes(data.disease_types || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Computed stats (active only)
  const activeDiseaseTypes = diseaseTypes.filter((d) => d.is_active);
  const totalActiveSites = activeDiseaseTypes.reduce((sum, d) => sum + d.active_place_count, 0);
  const totalHistoricalSites = activeDiseaseTypes.reduce((sum, d) => sum + d.historical_place_count, 0);

  const resetForm = () => {
    setForm({ ...DEFAULT_FORM });
  };

  const handleAdd = async () => {
    if (!form.disease_key || !form.display_label || !form.short_code) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/disease-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          description: form.description || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create disease type");
      }

      setMessage({ type: "success", text: "Disease type created!" });
      resetForm();
      setShowAddForm(false);
      fetchData();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to create" });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (dt: DiseaseType) => {
    setEditingKey(dt.disease_key);
    setEditForm({
      display_label: dt.display_label,
      color: dt.color,
      decay_window_months: dt.decay_window_months,
      is_contagious: dt.is_contagious,
      description: dt.description || "",
      is_active: dt.is_active,
    });
  };

  const cancelEdit = () => {
    setEditingKey(null);
  };

  const handleUpdate = async () => {
    if (!editingKey) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/disease-types", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disease_key: editingKey,
          ...editForm,
          description: editForm.description || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update disease type");
      }

      setMessage({ type: "success", text: "Disease type updated!" });
      setEditingKey(null);
      fetchData();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to update" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Disease Type Registry</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0" }}>
            Manage trackable diseases for place-level disease monitoring
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowAddForm(!showAddForm);
          }}
          style={{
            padding: "0.5rem 1rem",
            background: showAddForm ? "transparent" : "var(--foreground)",
            color: showAddForm ? "var(--foreground)" : "var(--background)",
            border: showAddForm ? "1px solid var(--border)" : "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {showAddForm ? "Cancel" : "+ Add Disease Type"}
        </button>
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

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "6px",
            marginBottom: "1rem",
            background: "rgba(220, 53, 69, 0.15)",
            color: "#dc3545",
          }}
        >
          {error}
        </div>
      )}

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: 600 }}>{activeDiseaseTypes.length}</div>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Disease Types</div>
        </div>
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: 600, color: totalActiveSites > 0 ? "#dc3545" : undefined }}>
            {totalActiveSites}
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Active Sites</div>
        </div>
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.75rem", fontWeight: 600 }}>{totalHistoricalSites}</div>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Historical Sites</div>
        </div>
      </div>

      {/* Add Form (expandable) */}
      {showAddForm && (
        <div
          style={{
            background: "var(--card-bg, rgba(0,0,0,0.05))",
            borderRadius: "8px",
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <h3 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>New Disease Type</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            {/* disease_key */}
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Disease Key *
              </label>
              <input
                type="text"
                value={form.disease_key}
                onChange={(e) =>
                  setForm({
                    ...form,
                    disease_key: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, "_")
                      .replace(/_+/g, "_"),
                  })
                }
                placeholder="e.g., panleukopenia"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  fontFamily: "monospace",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                }}
              />
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                Slug format, used as identifier
              </p>
            </div>

            {/* display_label */}
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Display Label *
              </label>
              <input
                type="text"
                value={form.display_label}
                onChange={(e) => setForm({ ...form, display_label: e.target.value })}
                placeholder="e.g., Panleukopenia (FPV)"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "4px" }}
              />
            </div>

            {/* short_code */}
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Short Code *
              </label>
              <input
                type="text"
                value={form.short_code}
                onChange={(e) => setForm({ ...form, short_code: e.target.value.toUpperCase().slice(0, 1) })}
                placeholder="e.g., P"
                maxLength={1}
                style={{
                  width: "60px",
                  padding: "0.5rem",
                  textAlign: "center",
                  fontWeight: 600,
                  fontSize: "1.1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                }}
              />
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                1 uppercase letter
              </p>
            </div>

            {/* color */}
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Color
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  style={{ width: "40px", height: "36px", padding: "2px", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                />
                <input
                  type="text"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  style={{ width: "90px", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: "4px" }}
                />
              </div>
            </div>

            {/* decay_window_months */}
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Decay Window (months)
              </label>
              <input
                type="number"
                value={form.decay_window_months}
                onChange={(e) => setForm({ ...form, decay_window_months: parseInt(e.target.value) || 0 })}
                min={1}
                style={{ width: "100px", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: "4px" }}
              />
            </div>

            {/* is_contagious */}
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: "0.25rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.is_contagious}
                  onChange={(e) => setForm({ ...form, is_contagious: e.target.checked })}
                />
                <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>Contagious</span>
              </label>
            </div>

            {/* description */}
            <div style={{ gridColumn: "span 3" }}>
              <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description of this disease type..."
                rows={2}
                style={{ width: "100%", padding: "0.5rem", resize: "vertical", border: "1px solid var(--border)", borderRadius: "4px" }}
              />
            </div>
          </div>

          {/* Form Actions */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                setShowAddForm(false);
                resetForm();
              }}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
                background: "transparent",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={saving || !form.disease_key || !form.display_label || !form.short_code}
              style={{
                padding: "0.5rem 1rem",
                background: "#198754",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving || !form.disease_key || !form.display_label || !form.short_code ? 0.7 : 1,
              }}
            >
              {saving ? "Creating..." : "Create Disease Type"}
            </button>
          </div>
        </div>
      )}

      {/* Disease Types Table */}
      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
      ) : diseaseTypes.length === 0 ? (
        <div
          style={{
            padding: "3rem",
            textAlign: "center",
            background: "var(--card-bg, rgba(0,0,0,0.05))",
            borderRadius: "8px",
          }}
        >
          <p style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No disease types configured</p>
          <p style={{ color: "var(--muted)", margin: "0 0 1rem" }}>
            Add disease types to enable place-level disease monitoring.
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Add Your First Disease Type
          </button>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "0.75rem 0.5rem" }}>Short Code</th>
                <th style={{ textAlign: "left", padding: "0.75rem 0.5rem" }}>Name</th>
                <th style={{ textAlign: "center", padding: "0.75rem 0.5rem" }}>Color</th>
                <th style={{ textAlign: "center", padding: "0.75rem 0.5rem" }}>Decay Window</th>
                <th style={{ textAlign: "center", padding: "0.75rem 0.5rem" }}>Contagious</th>
                <th style={{ textAlign: "right", padding: "0.75rem 0.5rem" }}>Active Sites</th>
                <th style={{ textAlign: "right", padding: "0.75rem 0.5rem" }}>Historical</th>
                <th style={{ textAlign: "center", padding: "0.75rem 0.5rem" }}>Status</th>
                <th style={{ textAlign: "right", padding: "0.75rem 0.5rem" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {diseaseTypes.map((dt) => (
                <tr
                  key={dt.disease_key}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    opacity: dt.is_active ? 1 : 0.5,
                  }}
                >
                  {editingKey === dt.disease_key ? (
                    /* Inline Edit Mode */
                    <>
                      <td style={{ padding: "0.75rem 0.5rem" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: editForm.color,
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: "0.8rem",
                          }}
                        >
                          {dt.short_code}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem" }}>
                        <input
                          type="text"
                          value={editForm.display_label}
                          onChange={(e) => setEditForm({ ...editForm, display_label: e.target.value })}
                          style={{ width: "100%", padding: "0.35rem 0.5rem", border: "1px solid var(--border)", borderRadius: "4px" }}
                        />
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                        <input
                          type="color"
                          value={editForm.color}
                          onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                          style={{ width: "32px", height: "28px", padding: "1px", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                        />
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                        <input
                          type="number"
                          value={editForm.decay_window_months}
                          onChange={(e) => setEditForm({ ...editForm, decay_window_months: parseInt(e.target.value) || 0 })}
                          min={1}
                          style={{ width: "70px", padding: "0.35rem 0.5rem", textAlign: "center", border: "1px solid var(--border)", borderRadius: "4px" }}
                        />
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={editForm.is_contagious}
                          onChange={(e) => setEditForm({ ...editForm, is_contagious: e.target.checked })}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                        {dt.active_place_count}
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                        {dt.historical_place_count}
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.25rem", cursor: "pointer", fontSize: "0.8rem" }}>
                          <input
                            type="checkbox"
                            checked={editForm.is_active}
                            onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                          />
                          {editForm.is_active ? "Active" : "Inactive"}
                        </label>
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
                          <button
                            onClick={handleUpdate}
                            disabled={saving}
                            style={{
                              padding: "0.25rem 0.5rem",
                              background: "#198754",
                              color: "#fff",
                              border: "none",
                              borderRadius: "4px",
                              cursor: saving ? "not-allowed" : "pointer",
                              fontSize: "0.8rem",
                              opacity: saving ? 0.7 : 1,
                            }}
                          >
                            {saving ? "..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            style={{
                              padding: "0.25rem 0.5rem",
                              background: "transparent",
                              border: "1px solid var(--border)",
                              borderRadius: "4px",
                              cursor: "pointer",
                              fontSize: "0.8rem",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {/* Description edit below buttons */}
                        <div style={{ marginTop: "0.5rem" }}>
                          <input
                            type="text"
                            value={editForm.description}
                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            placeholder="Description..."
                            style={{ width: "100%", padding: "0.25rem 0.5rem", fontSize: "0.8rem", border: "1px solid var(--border)", borderRadius: "4px" }}
                          />
                        </div>
                      </td>
                    </>
                  ) : (
                    /* Display Mode */
                    <>
                      <td style={{ padding: "0.75rem 0.5rem" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: dt.color,
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: "0.8rem",
                          }}
                        >
                          {dt.short_code}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem" }}>
                        <div style={{ fontWeight: 500 }}>{dt.display_label}</div>
                        {dt.description && (
                          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.15rem" }}>
                            {dt.description}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                        <div
                          style={{
                            display: "inline-block",
                            width: "20px",
                            height: "20px",
                            borderRadius: "4px",
                            background: dt.color,
                            border: "1px solid var(--border)",
                          }}
                          title={dt.color}
                        />
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.9rem" }}>
                        {dt.decay_window_months}mo
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                        {dt.is_contagious ? (
                          <span style={{ color: "#dc3545", fontWeight: 500 }}>Yes</span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>No</span>
                        )}
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                        {dt.active_place_count > 0 ? (
                          <span style={{ fontWeight: 500, color: "#dc3545" }}>{dt.active_place_count}</span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>0</span>
                        )}
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "right", color: "var(--muted)" }}>
                        {dt.historical_place_count}
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.125rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            background: dt.is_active ? "rgba(25, 135, 84, 0.15)" : "rgba(108, 117, 125, 0.15)",
                            color: dt.is_active ? "#198754" : "#6c757d",
                          }}
                        >
                          {dt.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                        <button
                          onClick={() => startEdit(dt)}
                          style={{
                            padding: "0.25rem 0.5rem",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
