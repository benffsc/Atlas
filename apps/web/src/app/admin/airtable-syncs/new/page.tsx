"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postApi } from "@/lib/api-client";

const PIPELINES = [
  { value: "person_onboarding", label: "Person Onboarding", description: "Resolve identity, add role, upsert profile" },
  { value: "data_import", label: "Data Import", description: "Direct INSERT into target table (not yet implemented)" },
  { value: "custom", label: "Custom / Legacy", description: "Registry entry only — engine skips these" },
];

const DEFAULT_WRITEBACK = {
  status_field: "Sync Status",
  error_field: "Sync Error",
  entity_id_field: "Atlas Entity ID",
  synced_at_field: "Synced At",
  success_status: "synced",
  error_status: "error",
};

export default function NewSyncConfigPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    airtable_base_id: "",
    airtable_table_name: "",
    filter_formula: "OR({Sync Status}='pending', {Sync Status}='error', {Sync Status}=BLANK())",
    page_size: 100,
    pipeline: "person_onboarding",
    schedule_cron: "",
    max_records_per_run: 100,
    max_duration_seconds: 60,
    is_legacy: false,
  });

  const handleCreate = async () => {
    setError(null);

    if (!form.name.trim()) { setError("Name is required"); return; }
    if (!form.airtable_base_id.trim()) { setError("Base ID is required"); return; }
    if (!form.airtable_table_name.trim()) { setError("Table name is required"); return; }

    setSaving(true);
    try {
      const result = await postApi<{ config_id: string }>("/api/admin/airtable-syncs", {
        ...form,
        schedule_cron: form.schedule_cron || null,
        field_mappings: {},
        pipeline_config: {},
        writeback_config: DEFAULT_WRITEBACK,
      });
      router.push(`/admin/airtable-syncs/${result.config_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create config");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "0.5rem",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: "0.875rem",
  };

  const labelStyle = {
    display: "block" as const,
    marginBottom: "0.25rem",
    fontWeight: 500,
    fontSize: "0.875rem",
  };

  return (
    <div style={{ maxWidth: "640px" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <button
          onClick={() => router.push("/admin/airtable-syncs")}
          style={{
            padding: "0.25rem 0.5rem",
            fontSize: "0.8rem",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            background: "var(--background)",
            color: "var(--foreground)",
            cursor: "pointer",
            marginBottom: "0.75rem",
          }}
        >
          &larr; Back
        </button>
        <h1 style={{ margin: 0 }}>New Airtable Sync</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.875rem" }}>
          Create a new config-driven Airtable sync
        </p>
      </div>

      {error && (
        <div style={{
          padding: "0.75rem 1rem",
          background: "#f8d7da",
          borderRadius: "6px",
          marginBottom: "1rem",
          fontSize: "0.875rem",
          color: "#721c24",
        }}>
          {error}
        </div>
      )}

      <div style={{
        padding: "1.5rem",
        background: "var(--card-bg, rgba(0,0,0,0.05))",
        borderRadius: "8px",
        border: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Name (slug)</label>
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="my-new-sync"
              style={inputStyle}
            />
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.125rem" }}>
              URL-friendly identifier. Used in webhook URL: ?config={form.name || "..."}
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <input
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="What this sync does"
              style={inputStyle}
            />
          </div>

          {/* Airtable Source */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>Airtable Base ID</label>
              <input
                value={form.airtable_base_id}
                onChange={e => setForm({ ...form, airtable_base_id: e.target.value })}
                placeholder="appXXXXXXXXX"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Table Name</label>
              <input
                value={form.airtable_table_name}
                onChange={e => setForm({ ...form, airtable_table_name: e.target.value })}
                placeholder="My Table"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Filter */}
          <div>
            <label style={labelStyle}>Filter Formula</label>
            <input
              value={form.filter_formula}
              onChange={e => setForm({ ...form, filter_formula: e.target.value })}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.8rem" }}
            />
          </div>

          {/* Pipeline */}
          <div>
            <label style={labelStyle}>Pipeline</label>
            <select
              value={form.pipeline}
              onChange={e => setForm({ ...form, pipeline: e.target.value })}
              style={inputStyle}
            >
              {PIPELINES.map(p => (
                <option key={p.value} value={p.value}>
                  {p.label} — {p.description}
                </option>
              ))}
            </select>
          </div>

          {/* Schedule */}
          <div>
            <label style={labelStyle}>Schedule (cron expression)</label>
            <input
              value={form.schedule_cron}
              onChange={e => setForm({ ...form, schedule_cron: e.target.value })}
              placeholder="*/30 * * * * (blank = webhook/manual only)"
              style={inputStyle}
            />
          </div>

          {/* Limits */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>Max Records / Run</label>
              <input
                type="number"
                value={form.max_records_per_run}
                onChange={e => setForm({ ...form, max_records_per_run: parseInt(e.target.value) || 100 })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Max Duration (seconds)</label>
              <input
                type="number"
                value={form.max_duration_seconds}
                onChange={e => setForm({ ...form, max_duration_seconds: parseInt(e.target.value) || 60 })}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Legacy toggle */}
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.is_legacy}
                onChange={e => setForm({ ...form, is_legacy: e.target.checked })}
              />
              Legacy config (engine will skip — registry entry only)
            </label>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem" }}>
          <button
            onClick={handleCreate}
            disabled={saving}
            style={{
              padding: "0.5rem 1.5rem",
              border: "none",
              borderRadius: "6px",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              cursor: saving ? "wait" : "pointer",
              fontWeight: 500,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Creating..." : "Create Sync Config"}
          </button>
          <button
            onClick={() => router.push("/admin/airtable-syncs")}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              background: "var(--background)",
              color: "var(--foreground)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>

        <p style={{ margin: "0.75rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
          After creating, use the detail page to configure field mappings, pipeline config, and writeback settings.
        </p>
      </div>
    </div>
  );
}
