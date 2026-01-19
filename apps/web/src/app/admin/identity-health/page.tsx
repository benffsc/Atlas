"use client";

import { useState, useEffect } from "react";

interface HealthMetrics {
  total_active_people: number;
  unique_names: number;
  duplication_ratio: number;
  people_without_identifiers: number;
  doubled_names: number;
  pending_merge_candidates: number;
  person_count: number;
  organization_count: number;
  auto_matches_24h: number;
  new_entities_24h: number;
  reviews_pending_24h: number;
  auto_match_rate_24h_pct: number | null;
  checked_at: string;
}

interface HealthCheck {
  status: "healthy" | "warning" | "critical";
  checked_at: string;
  metrics: HealthMetrics;
  issues: Array<{
    issue: string;
    value: number;
    threshold: number;
  }>;
}

export default function IdentityHealthPage() {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth();
  }, []);

  async function fetchHealth() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/identity-health");
      if (!res.ok) throw new Error("Failed to fetch health data");
      const data = await res.json();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
          Identity Resolution Health
        </h1>
        <p>Loading health metrics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
          Identity Resolution Health
        </h1>
        <div
          style={{
            padding: "1rem",
            background: "var(--critical-bg)",
            borderRadius: "8px",
            color: "var(--critical-text)",
          }}
        >
          Error: {error}
        </div>
      </div>
    );
  }

  if (!health) return null;

  const statusColors = {
    healthy: { bg: "var(--healthy-bg)", text: "var(--healthy-text)", border: "var(--healthy-border)" },
    warning: { bg: "var(--caution-bg)", text: "var(--caution-text)", border: "var(--caution-border)" },
    critical: { bg: "var(--critical-bg)", text: "var(--critical-text)", border: "var(--critical-border)" },
    unknown: { bg: "var(--bg-secondary)", text: "var(--text-secondary)", border: "var(--border-default)" },
  };

  const statusStyle = statusColors[health.status] || statusColors.unknown;

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>
          Identity Resolution Health
        </h1>
        <button
          onClick={fetchHealth}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-light)",
            borderRadius: "6px",
            cursor: "pointer",
            color: "var(--foreground)",
          }}
        >
          Refresh
        </button>
      </div>

      {/* Status Banner */}
      <div
        style={{
          padding: "1rem",
          background: statusStyle.bg,
          border: `1px solid ${statusStyle.border}`,
          borderRadius: "8px",
          marginBottom: "2rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <span style={{ fontSize: "1.5rem" }}>
          {health.status === "healthy"
            ? "✓"
            : health.status === "warning"
              ? "⚠"
              : "✕"}
        </span>
        <div>
          <div style={{ fontWeight: 600, color: statusStyle.text }}>
            Status: {health.status.toUpperCase()}
          </div>
          {health.issues.length > 0 && (
            <div style={{ fontSize: "0.875rem", color: statusStyle.text }}>
              {health.issues.map((i) => i.issue.replace(/_/g, " ")).join(", ")}
            </div>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <MetricCard
          label="Total People"
          value={health.metrics.total_active_people.toLocaleString()}
          subtitle={`${health.metrics.unique_names.toLocaleString()} unique names`}
        />
        <MetricCard
          label="Duplication Ratio"
          value={`${health.metrics.duplication_ratio}x`}
          subtitle="Target: 1.0x"
          isWarning={health.metrics.duplication_ratio > 1.5}
        />
        <MetricCard
          label="Without Identifiers"
          value={health.metrics.people_without_identifiers.toLocaleString()}
          subtitle="Can't be matched"
          isWarning={health.metrics.people_without_identifiers > 1000}
        />
        <MetricCard
          label="Doubled Names"
          value={health.metrics.doubled_names.toLocaleString()}
          subtitle="Like 'X X'"
          isWarning={health.metrics.doubled_names > 0}
        />
        <MetricCard
          label="Merge Candidates"
          value={health.metrics.pending_merge_candidates.toLocaleString()}
          subtitle="Potential duplicates"
        />
        <MetricCard
          label="Organizations"
          value={health.metrics.organization_count.toLocaleString()}
          subtitle={`${health.metrics.person_count.toLocaleString()} people`}
        />
      </div>

      {/* 24h Activity */}
      <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
        Last 24 Hours
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <MetricCard
          label="Auto Matches"
          value={health.metrics.auto_matches_24h.toLocaleString()}
          subtitle="Automatic identity matches"
        />
        <MetricCard
          label="New Entities"
          value={health.metrics.new_entities_24h.toLocaleString()}
          subtitle="New people created"
        />
        <MetricCard
          label="Pending Reviews"
          value={health.metrics.reviews_pending_24h.toLocaleString()}
          subtitle="Need manual review"
        />
        <MetricCard
          label="Auto-Match Rate"
          value={
            health.metrics.auto_match_rate_24h_pct !== null
              ? `${health.metrics.auto_match_rate_24h_pct}%`
              : "N/A"
          }
          subtitle="Target: 30-50%"
          isWarning={
            health.metrics.auto_match_rate_24h_pct !== null &&
            health.metrics.auto_match_rate_24h_pct < 20
          }
        />
      </div>

      {/* Issues List */}
      {health.issues.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Issues</h2>
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border-default)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            {health.issues.map((issue, i) => (
              <div
                key={i}
                style={{
                  padding: "1rem",
                  borderBottom:
                    i < health.issues.length - 1
                      ? "1px solid var(--border-default)"
                      : "none",
                  display: "flex",
                  justifyContent: "space-between",
                  color: "var(--foreground)",
                }}
              >
                <span>{issue.issue.replace(/_/g, " ")}</span>
                <span>
                  <strong>{issue.value}</strong> (threshold: {issue.threshold})
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div
        style={{
          marginTop: "2rem",
          fontSize: "0.875rem",
          color: "var(--text-secondary)",
        }}
      >
        Last checked:{" "}
        {new Date(health.metrics.checked_at).toLocaleString()}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  isWarning = false,
}: {
  label: string;
  value: string;
  subtitle?: string;
  isWarning?: boolean;
}) {
  return (
    <div
      style={{
        padding: "1rem",
        background: isWarning ? "var(--caution-bg)" : "var(--card-bg)",
        border: `1px solid ${isWarning ? "var(--caution-border)" : "var(--border-default)"}`,
        borderRadius: "8px",
      }}
    >
      <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>{label}</div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 600,
          color: isWarning ? "var(--caution-text)" : "var(--text-primary)",
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>{subtitle}</div>
      )}
    </div>
  );
}
