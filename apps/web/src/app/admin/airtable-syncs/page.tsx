"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";

interface SyncConfig {
  config_id: string;
  name: string;
  description: string | null;
  airtable_table_name: string;
  pipeline: string;
  schedule_cron: string | null;
  is_active: boolean;
  is_legacy: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_count: number;
  recent_runs: number;
  recent_errors: number;
}

export default function AirtableSyncsPage() {
  const router = useRouter();
  const [configs, setConfigs] = useState<SyncConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const result = await fetchApi<{ configs: SyncConfig[] }>(
        "/api/admin/airtable-syncs"
      );
      setConfigs(result.configs || []);
    } catch (err) {
      console.error("Failed to fetch sync configs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handleToggleActive = async (config: SyncConfig) => {
    try {
      await postApi(`/api/admin/airtable-syncs/${config.config_id}`, {
        is_active: !config.is_active,
      }, { method: "PATCH" });
      fetchConfigs();
    } catch (err) {
      console.error("Failed to toggle:", err);
    }
  };

  const handleTrigger = async (configId: string) => {
    setTriggering(configId);
    try {
      await postApi(`/api/admin/airtable-syncs/${configId}/trigger`, {});
      fetchConfigs();
    } catch (err) {
      console.error("Failed to trigger sync:", err);
    } finally {
      setTriggering(null);
    }
  };

  const statusColor = (status: string | null) => {
    if (!status) return "var(--muted)";
    if (status === "success") return "#28a745";
    if (status === "partial") return "#ffc107";
    return "#dc3545";
  };

  const pipelineBadge = (pipeline: string) => {
    const colors: Record<string, string> = {
      person_onboarding: "#6f42c1",
      data_import: "#007bff",
      custom: "#6c757d",
    };
    return colors[pipeline] || "#6c757d";
  };

  return (
    <div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "1.5rem",
      }}>
        <div>
          <h1 style={{ margin: 0 }}>Airtable Syncs</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.875rem" }}>
            Config-driven Airtable sync definitions
          </p>
        </div>
        <button
          onClick={() => router.push("/admin/airtable-syncs/new")}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          + New Sync
        </button>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.75rem",
        marginBottom: "1.5rem",
      }}>
        {[
          { label: "Total", value: configs.length },
          { label: "Active", value: configs.filter(c => c.is_active && !c.is_legacy).length },
          { label: "Legacy", value: configs.filter(c => c.is_legacy).length },
          { label: "Errors (7d)", value: configs.reduce((s, c) => s + c.recent_errors, 0) },
        ].map(s => (
          <div key={s.label} style={{
            padding: "0.75rem",
            background: "var(--card-bg, rgba(0,0,0,0.05))",
            borderRadius: "8px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{s.value}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
          Loading...
        </div>
      ) : configs.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
          No sync configs yet
        </div>
      ) : (
        <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "0.5rem 0.5rem" }}>Name</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Table</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Pipeline</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Schedule</th>
              <th style={{ textAlign: "center", padding: "0.5rem" }}>Last Sync</th>
              <th style={{ textAlign: "center", padding: "0.5rem" }}>Runs (7d)</th>
              <th style={{ textAlign: "center", padding: "0.5rem" }}>Status</th>
              <th style={{ textAlign: "right", padding: "0.5rem" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map(config => (
              <tr
                key={config.config_id}
                style={{
                  borderBottom: "1px solid var(--border)",
                  opacity: config.is_active ? 1 : 0.5,
                  cursor: "pointer",
                }}
                onClick={() => router.push(`/admin/airtable-syncs/${config.config_id}`)}
              >
                <td style={{ padding: "0.75rem 0.5rem" }}>
                  <div style={{ fontWeight: 500 }}>{config.name}</div>
                  {config.description && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.125rem" }}>
                      {config.description.slice(0, 60)}{config.description.length > 60 ? "..." : ""}
                    </div>
                  )}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", fontSize: "0.8rem" }}>
                  {config.airtable_table_name}
                </td>
                <td style={{ padding: "0.75rem 0.5rem" }}>
                  <span style={{
                    fontSize: "0.7rem",
                    padding: "0.125rem 0.5rem",
                    background: pipelineBadge(config.pipeline),
                    color: "#fff",
                    borderRadius: "4px",
                  }}>
                    {config.pipeline}
                  </span>
                  {config.is_legacy && (
                    <span style={{
                      fontSize: "0.7rem",
                      padding: "0.125rem 0.5rem",
                      background: "#6c757d",
                      color: "#fff",
                      borderRadius: "4px",
                      marginLeft: "0.25rem",
                    }}>
                      legacy
                    </span>
                  )}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                  {config.schedule_cron || "manual"}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", fontSize: "0.8rem" }}>
                  {config.last_sync_at
                    ? new Date(config.last_sync_at).toLocaleDateString()
                    : "never"}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                  {config.recent_runs}
                  {config.recent_errors > 0 && (
                    <span style={{ color: "#dc3545", marginLeft: "0.25rem" }}>
                      ({config.recent_errors} err)
                    </span>
                  )}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                  <span style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: config.is_active ? statusColor(config.last_sync_status) : "#6c757d",
                  }} />
                </td>
                <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}
                  onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleToggleActive(config)}
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontSize: "0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      background: "var(--background)",
                      color: "var(--foreground)",
                      cursor: "pointer",
                      marginRight: "0.25rem",
                    }}
                  >
                    {config.is_active ? "Disable" : "Enable"}
                  </button>
                  {config.is_active && !config.is_legacy && (
                    <button
                      onClick={() => handleTrigger(config.config_id)}
                      disabled={triggering === config.config_id}
                      style={{
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.75rem",
                        border: "none",
                        borderRadius: "4px",
                        background: "var(--primary)",
                        color: "var(--primary-foreground)",
                        cursor: triggering === config.config_id ? "wait" : "pointer",
                        opacity: triggering === config.config_id ? 0.6 : 1,
                      }}
                    >
                      {triggering === config.config_id ? "Running..." : "Sync Now"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
