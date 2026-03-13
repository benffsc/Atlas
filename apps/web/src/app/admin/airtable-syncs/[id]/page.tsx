"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";

interface FieldMapping {
  maps_to: string;
  required?: boolean;
  transform?: string;
  default_value?: unknown;
}

interface SyncRun {
  run_id: string;
  trigger_type: string;
  started_at: string;
  completed_at: string | null;
  records_found: number;
  records_synced: number;
  records_errored: number;
  duration_ms: number | null;
  error_summary: string | null;
}

interface SyncConfig {
  config_id: string;
  name: string;
  description: string | null;
  airtable_base_id: string;
  airtable_table_name: string;
  filter_formula: string;
  page_size: number;
  field_mappings: Record<string, FieldMapping>;
  pipeline: string;
  pipeline_config: Record<string, unknown>;
  writeback_config: Record<string, unknown>;
  schedule_cron: string | null;
  is_active: boolean;
  is_legacy: boolean;
  max_records_per_run: number;
  max_duration_seconds: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_count: number;
}

interface TestResult {
  connection: string;
  records_found: number;
  has_more: boolean;
  field_names: string[];
  sample_record: Record<string, unknown> | null;
}

interface SyncRecord {
  record_id: string;
  config_name: string;
  airtable_record_id: string;
  raw_fields: Record<string, unknown>;
  mapped_fields: Record<string, unknown>;
  status: "synced" | "rejected" | "error";
  entity_id: string | null;
  match_type: string | null;
  rejection_reason: string | null;
  error_message: string | null;
  identity_result: Record<string, unknown> | null;
  processed_at: string;
  archived_at: string | null;
}

export default function SyncConfigDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Audit records state
  const [records, setRecords] = useState<SyncRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsFilter, setRecordsFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);

  // Editable form state
  const [form, setForm] = useState({
    description: "",
    airtable_base_id: "",
    airtable_table_name: "",
    filter_formula: "",
    page_size: 100,
    schedule_cron: "",
    max_records_per_run: 100,
    max_duration_seconds: 60,
  });

  const fetchConfig = useCallback(async () => {
    try {
      const result = await fetchApi<{ config: SyncConfig; recent_runs: SyncRun[] }>(
        `/api/admin/airtable-syncs/${id}`
      );
      setConfig(result.config);
      setRuns(result.recent_runs || []);
      setForm({
        description: result.config.description || "",
        airtable_base_id: result.config.airtable_base_id,
        airtable_table_name: result.config.airtable_table_name,
        filter_formula: result.config.filter_formula,
        page_size: result.config.page_size,
        schedule_cron: result.config.schedule_cron || "",
        max_records_per_run: result.config.max_records_per_run,
        max_duration_seconds: result.config.max_duration_seconds,
      });
    } catch (err) {
      console.error("Failed to fetch config:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchRecords = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (recordsFilter !== "all") params.set("status", recordsFilter);
      if (showArchived) params.set("archived", "true");
      params.set("limit", "50");
      const qs = params.toString();
      const result = await fetchApi<{ records: SyncRecord[]; total: number }>(
        `/api/admin/airtable-syncs/${id}/records?${qs}`
      );
      setRecords(result.records || []);
      setRecordsTotal(result.total || 0);
      setSelectedRecords(new Set());
    } catch (err) {
      console.error("Failed to fetch records:", err);
    }
  }, [id, recordsFilter, showArchived]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleArchive = async (action: "archive" | "unarchive") => {
    if (selectedRecords.size === 0) return;
    setArchiving(true);
    try {
      await postApi(`/api/admin/airtable-syncs/${id}/records`, {
        record_ids: Array.from(selectedRecords),
        action,
      }, { method: "PATCH" });
      fetchRecords();
    } catch (err) {
      console.error("Archive failed:", err);
    } finally {
      setArchiving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await postApi(`/api/admin/airtable-syncs/${id}`, {
        ...form,
        schedule_cron: form.schedule_cron || null,
      }, { method: "PATCH" });
      setEditing(false);
      fetchConfig();
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const result = await postApi<{ message: string }>(
        `/api/admin/airtable-syncs/${id}/trigger`, {}
      );
      setTriggerResult(result.message || "Sync completed");
      fetchConfig();
    } catch (err) {
      setTriggerResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTriggering(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await postApi<TestResult>(
        `/api/admin/airtable-syncs/${id}/test`, {}
      );
      setTestResult(result);
    } catch (err) {
      console.error("Test failed:", err);
    } finally {
      setTesting(false);
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

  const sectionStyle = {
    padding: "1rem",
    background: "var(--card-bg, rgba(0,0,0,0.05))",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    marginBottom: "1rem",
  };

  if (loading) {
    return <div style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>Loading...</div>;
  }

  if (!config) {
    return <div style={{ textAlign: "center", color: "#dc3545", padding: "2rem" }}>Config not found</div>;
  }

  return (
    <div>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0 }}>{config.name}</h1>
            <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.875rem" }}>
              {config.pipeline} pipeline
              {config.is_legacy && " (legacy)"}
              {!config.is_active && " (inactive)"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleTest}
              disabled={testing}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                background: "var(--background)",
                color: "var(--foreground)",
                cursor: testing ? "wait" : "pointer",
              }}
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            {config.is_active && !config.is_legacy && (
              <button
                onClick={handleTrigger}
                disabled={triggering}
                style={{
                  padding: "0.5rem 1rem",
                  border: "none",
                  borderRadius: "6px",
                  background: "var(--primary)",
                  color: "var(--primary-foreground)",
                  cursor: triggering ? "wait" : "pointer",
                  fontWeight: 500,
                  opacity: triggering ? 0.6 : 1,
                }}
              >
                {triggering ? "Running..." : "Sync Now"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Trigger result */}
      {triggerResult && (
        <div style={{
          padding: "0.75rem 1rem",
          background: triggerResult.startsWith("Error") ? "#fff3cd" : "#d4edda",
          borderRadius: "6px",
          marginBottom: "1rem",
          fontSize: "0.875rem",
        }}>
          {triggerResult}
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div style={{ ...sectionStyle, background: "#d4edda" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Connection Test</h3>
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            Found {testResult.records_found} pending records
            {testResult.has_more ? " (more available)" : ""}
          </p>
          <div style={{ marginTop: "0.5rem" }}>
            <strong style={{ fontSize: "0.8rem" }}>Fields found:</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.25rem" }}>
              {testResult.field_names.map(f => (
                <span key={f} style={{
                  fontSize: "0.7rem",
                  padding: "0.125rem 0.5rem",
                  background: "rgba(0,0,0,0.1)",
                  borderRadius: "4px",
                }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Config section */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Configuration</h3>
          <button
            onClick={() => editing ? handleSave() : setEditing(true)}
            disabled={saving}
            style={{
              padding: "0.25rem 0.75rem",
              fontSize: "0.8rem",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              background: editing ? "var(--primary)" : "var(--background)",
              color: editing ? "var(--primary-foreground)" : "var(--foreground)",
              cursor: "pointer",
            }}
          >
            {saving ? "Saving..." : editing ? "Save" : "Edit"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label style={labelStyle}>Description</label>
            {editing ? (
              <input
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                style={inputStyle}
              />
            ) : (
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                {config.description || "—"}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Schedule</label>
            {editing ? (
              <input
                value={form.schedule_cron}
                onChange={e => setForm({ ...form, schedule_cron: e.target.value })}
                placeholder="*/30 * * * * (or blank for manual)"
                style={inputStyle}
              />
            ) : (
              <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
                {config.schedule_cron || "manual / webhook only"}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Base ID</label>
            {editing ? (
              <input
                value={form.airtable_base_id}
                onChange={e => setForm({ ...form, airtable_base_id: e.target.value })}
                style={inputStyle}
              />
            ) : (
              <div style={{ fontSize: "0.875rem", fontFamily: "monospace" }}>
                {config.airtable_base_id}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Table Name</label>
            {editing ? (
              <input
                value={form.airtable_table_name}
                onChange={e => setForm({ ...form, airtable_table_name: e.target.value })}
                style={inputStyle}
              />
            ) : (
              <div style={{ fontSize: "0.875rem" }}>{config.airtable_table_name}</div>
            )}
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Filter Formula</label>
            {editing ? (
              <input
                value={form.filter_formula}
                onChange={e => setForm({ ...form, filter_formula: e.target.value })}
                style={inputStyle}
              />
            ) : (
              <div style={{ fontSize: "0.8rem", fontFamily: "monospace", color: "var(--muted)" }}>
                {config.filter_formula}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Max Records / Run</label>
            {editing ? (
              <input
                type="number"
                value={form.max_records_per_run}
                onChange={e => setForm({ ...form, max_records_per_run: parseInt(e.target.value) || 100 })}
                style={inputStyle}
              />
            ) : (
              <div style={{ fontSize: "0.875rem" }}>{config.max_records_per_run}</div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Max Duration (sec)</label>
            {editing ? (
              <input
                type="number"
                value={form.max_duration_seconds}
                onChange={e => setForm({ ...form, max_duration_seconds: parseInt(e.target.value) || 60 })}
                style={inputStyle}
              />
            ) : (
              <div style={{ fontSize: "0.875rem" }}>{config.max_duration_seconds}s</div>
            )}
          </div>
        </div>
        {editing && (
          <button
            onClick={() => setEditing(false)}
            style={{
              marginTop: "0.75rem",
              padding: "0.25rem 0.75rem",
              fontSize: "0.8rem",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              background: "var(--background)",
              color: "var(--foreground)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Field Mappings */}
      <div style={sectionStyle}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>Field Mappings</h3>
        {Object.keys(config.field_mappings).length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
            No field mappings (legacy config)
          </div>
        ) : (
          <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Airtable Field</th>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Maps To</th>
                <th style={{ textAlign: "center", padding: "0.4rem" }}>Required</th>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Transform</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.field_mappings).map(([field, mapping]) => (
                <tr key={field} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{field}</td>
                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{mapping.maps_to}</td>
                  <td style={{ padding: "0.4rem", textAlign: "center" }}>
                    {mapping.required ? "Yes" : ""}
                  </td>
                  <td style={{ padding: "0.4rem" }}>
                    {mapping.transform && (
                      <span style={{
                        fontSize: "0.7rem",
                        padding: "0.1rem 0.4rem",
                        background: "rgba(111, 66, 193, 0.15)",
                        borderRadius: "3px",
                      }}>
                        {mapping.transform}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Writeback Config */}
      <div style={sectionStyle}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>Writeback Config</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.8rem" }}>
          {Object.entries(config.writeback_config).map(([key, value]) => (
            <div key={key}>
              <span style={{ color: "var(--muted)" }}>{key}: </span>
              <span style={{ fontFamily: "monospace" }}>{String(value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Webhook Script */}
      <div style={sectionStyle}>
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Automation Script</h3>
        <p style={{ margin: "0 0 0.5rem", color: "var(--muted)", fontSize: "0.8rem" }}>
          Use this in an Airtable automation to trigger syncs on record changes:
        </p>
        <pre style={{
          padding: "0.75rem",
          background: "rgba(0,0,0,0.08)",
          borderRadius: "6px",
          fontSize: "0.75rem",
          overflow: "auto",
          margin: 0,
        }}>
{`await fetch('{window.location.origin}/api/webhooks/airtable-sync?config=${config.name}', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer YOUR_WEBHOOK_SECRET' }
});`}
        </pre>
      </div>

      {/* Run History */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Run History (Recent 10)</h3>
          <button
            onClick={() => router.push(`/admin/airtable-syncs/${id}?tab=runs`)}
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.75rem",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              background: "var(--background)",
              color: "var(--foreground)",
              cursor: "pointer",
            }}
          >
            View All
          </button>
        </div>
        {runs.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No runs yet</div>
        ) : (
          <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>When</th>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Trigger</th>
                <th style={{ textAlign: "center", padding: "0.4rem" }}>Found</th>
                <th style={{ textAlign: "center", padding: "0.4rem" }}>Synced</th>
                <th style={{ textAlign: "center", padding: "0.4rem" }}>Errors</th>
                <th style={{ textAlign: "right", padding: "0.4rem" }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.run_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.4rem", fontSize: "0.75rem" }}>
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "0.4rem" }}>
                    <span style={{
                      fontSize: "0.7rem",
                      padding: "0.1rem 0.4rem",
                      background: run.trigger_type === "cron" ? "#17a2b8" : run.trigger_type === "webhook" ? "#ffc107" : "#28a745",
                      color: run.trigger_type === "webhook" ? "#000" : "#fff",
                      borderRadius: "3px",
                    }}>
                      {run.trigger_type}
                    </span>
                  </td>
                  <td style={{ padding: "0.4rem", textAlign: "center" }}>{run.records_found}</td>
                  <td style={{ padding: "0.4rem", textAlign: "center", color: run.records_synced > 0 ? "#28a745" : undefined }}>
                    {run.records_synced}
                  </td>
                  <td style={{ padding: "0.4rem", textAlign: "center", color: run.records_errored > 0 ? "#dc3545" : undefined }}>
                    {run.records_errored}
                  </td>
                  <td style={{ padding: "0.4rem", textAlign: "right", color: "var(--muted)" }}>
                    {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Audit Records */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
            Submission Records ({recordsTotal})
          </h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {selectedRecords.size > 0 && (
              <button
                onClick={() => handleArchive(showArchived ? "unarchive" : "archive")}
                disabled={archiving}
                style={{
                  padding: "0.25rem 0.75rem",
                  fontSize: "0.75rem",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  background: "#6c757d",
                  color: "#fff",
                  cursor: archiving ? "wait" : "pointer",
                }}
              >
                {archiving ? "..." : showArchived ? `Unarchive (${selectedRecords.size})` : `Archive (${selectedRecords.size})`}
              </button>
            )}
            <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>
        </div>

        {/* Status filter chips */}
        <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem" }}>
          {["all", "synced", "rejected", "error"].map(s => (
            <button
              key={s}
              onClick={() => setRecordsFilter(s)}
              style={{
                padding: "0.2rem 0.6rem",
                fontSize: "0.7rem",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                background: recordsFilter === s ? "var(--primary)" : "var(--background)",
                color: recordsFilter === s ? "var(--primary-foreground)" : "var(--foreground)",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {records.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
            No records{recordsFilter !== "all" ? ` with status "${recordsFilter}"` : ""}
          </div>
        ) : (
          <div>
            <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "0.4rem", width: "24px" }}>
                    <input
                      type="checkbox"
                      checked={selectedRecords.size === records.length && records.length > 0}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedRecords(new Set(records.map(r => r.record_id)));
                        } else {
                          setSelectedRecords(new Set());
                        }
                      }}
                    />
                  </th>
                  <th style={{ textAlign: "left", padding: "0.4rem" }}>When</th>
                  <th style={{ textAlign: "left", padding: "0.4rem" }}>Status</th>
                  <th style={{ textAlign: "left", padding: "0.4rem" }}>Details</th>
                  <th style={{ textAlign: "left", padding: "0.4rem" }}>Person</th>
                </tr>
              </thead>
              <tbody>
                {records.map(rec => {
                  const mapped = rec.mapped_fields as Record<string, unknown>;
                  const name = [mapped?.first_name, mapped?.last_name].filter(Boolean).join(" ") || "—";
                  const email = (mapped?.email as string) || "";
                  const isExpanded = expandedRecord === rec.record_id;

                  return (
                    <tr key={rec.record_id} style={{ borderBottom: "1px solid var(--border)", opacity: rec.archived_at ? 0.5 : 1 }}>
                      <td style={{ padding: "0.4rem" }}>
                        <input
                          type="checkbox"
                          checked={selectedRecords.has(rec.record_id)}
                          onChange={e => {
                            const next = new Set(selectedRecords);
                            e.target.checked ? next.add(rec.record_id) : next.delete(rec.record_id);
                            setSelectedRecords(next);
                          }}
                        />
                      </td>
                      <td style={{ padding: "0.4rem", fontSize: "0.75rem" }}>
                        {new Date(rec.processed_at).toLocaleString()}
                      </td>
                      <td style={{ padding: "0.4rem" }}>
                        <span style={{
                          fontSize: "0.7rem",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "3px",
                          background: rec.status === "synced" ? "#28a745" : rec.status === "rejected" ? "#ffc107" : "#dc3545",
                          color: rec.status === "rejected" ? "#000" : "#fff",
                        }}>
                          {rec.status}
                        </span>
                        {rec.archived_at && (
                          <span style={{ fontSize: "0.65rem", color: "var(--muted)", marginLeft: "0.25rem" }}>archived</span>
                        )}
                      </td>
                      <td style={{ padding: "0.4rem" }}>
                        <button
                          onClick={() => setExpandedRecord(isExpanded ? null : rec.record_id)}
                          style={{
                            padding: "0.1rem 0.4rem",
                            fontSize: "0.7rem",
                            border: "1px solid var(--border)",
                            borderRadius: "3px",
                            background: "var(--background)",
                            color: "var(--foreground)",
                            cursor: "pointer",
                          }}
                        >
                          {isExpanded ? "Hide" : "Show"}
                        </button>
                        {rec.rejection_reason && (
                          <span style={{ fontSize: "0.7rem", color: "#856404", marginLeft: "0.5rem" }}>
                            {rec.rejection_reason}
                          </span>
                        )}
                        {rec.error_message && (
                          <span style={{ fontSize: "0.7rem", color: "#dc3545", marginLeft: "0.5rem" }}>
                            {rec.error_message}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.4rem" }}>
                        <div style={{ fontSize: "0.8rem" }}>{name}</div>
                        {email && <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{email}</div>}
                        {rec.entity_id && (
                          <div style={{ fontSize: "0.65rem", fontFamily: "monospace", color: "var(--muted)" }}>
                            {rec.entity_id.slice(0, 8)}... ({rec.match_type})
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Expanded detail panel — shown below the table for the selected record */}
            {expandedRecord && (() => {
              const rec = records.find(r => r.record_id === expandedRecord);
              if (!rec) return null;
              return (
                <div style={{
                  marginTop: "0.5rem",
                  padding: "0.75rem",
                  background: "rgba(0,0,0,0.04)",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <strong>Mapped Fields</strong>
                      <pre style={{ margin: "0.25rem 0 0", fontSize: "0.7rem", overflow: "auto", maxHeight: "200px" }}>
                        {JSON.stringify(rec.mapped_fields, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <strong>Raw Fields (from Airtable)</strong>
                      <pre style={{ margin: "0.25rem 0 0", fontSize: "0.7rem", overflow: "auto", maxHeight: "200px" }}>
                        {JSON.stringify(rec.raw_fields, null, 2)}
                      </pre>
                    </div>
                  </div>
                  {rec.identity_result && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <strong>Identity Resolution</strong>
                      <pre style={{ margin: "0.25rem 0 0", fontSize: "0.7rem", overflow: "auto", maxHeight: "150px" }}>
                        {JSON.stringify(rec.identity_result, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div style={{ marginTop: "0.5rem", color: "var(--muted)" }}>
                    Airtable Record: {rec.airtable_record_id}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
