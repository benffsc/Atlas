"use client";

import { useState, useEffect, useCallback } from "react";

interface DashboardMetrics {
  total_cats: number;
  cats_with_places: number;
  cat_place_coverage_pct: number;
  total_people: number;
  valid_people: number;
  invalid_people: number;
  orgs_as_people: number;
  garbage_people: number;
  non_canonical_people: number;
  total_external_organizations: number;
  people_needing_org_conversion: number;
  total_de_decisions: number;
  de_decisions_24h: number;
  pending_reviews: number;
  auto_matches: number;
  new_entities: number;
  total_households: number;
  people_in_households: number;
  household_coverage_pct: number;
  total_places: number;
  geocoded_places: number;
  geocoding_queue: number;
  geocoding_coverage_pct: number;
  total_appointments: number;
  appointments_with_person: number;
  appointments_with_trapper: number;
  appointment_person_pct: number;
  people_with_identifiers: number;
  identity_coverage_pct: number;
  people_created_24h: number;
  invalid_people_created_24h: number;
  cats_created_24h: number;
  records_staged_24h: number;
  soft_blacklist_count: number;
}

interface Problem {
  problem_type: string;
  severity: "critical" | "warning";
  count: string;
  description: string;
}

interface DataQualityResponse {
  status: "healthy" | "warning" | "critical";
  generated_at: string;
  dashboard: DashboardMetrics;
  problems: Problem[];
  summary: {
    cat_place_coverage: number;
    cats_without_places: number;
    invalid_people: number;
    orgs_as_people: number;
    pending_reviews: number;
    geocoding_queue: number;
    household_coverage: number;
  };
}

const STATUS_COLORS = {
  healthy: { bg: "#ecfdf5", border: "#10b981", text: "#059669" },
  warning: { bg: "#fef3c7", border: "#f59e0b", text: "#d97706" },
  critical: { bg: "#fef2f2", border: "#ef4444", text: "#dc2626" },
};

export default function DataQualityPage() {
  const [data, setData] = useState<DataQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/data-quality");
      if (!response.ok) throw new Error("Failed to fetch data quality metrics");
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchData]);

  const takeSnapshot = async () => {
    setSnapshotLoading(true);
    try {
      const response = await fetch("/api/admin/data-quality", { method: "POST" });
      if (!response.ok) throw new Error("Failed to take snapshot");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSnapshotLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h1>Data Quality</h1>
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <h1>Data Quality</h1>
        <div
          className="card"
          style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #ef4444" }}
        >
          <strong>Error:</strong> {error || "No data"}
        </div>
      </div>
    );
  }

  const { dashboard, problems, summary, status } = data;
  const statusStyle = STATUS_COLORS[status];

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Data Quality Dashboard</h1>
          <p className="text-muted">
            Monitoring data integrity for Beacon analytics
          </p>
        </div>
        <button
          onClick={takeSnapshot}
          disabled={snapshotLoading}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            cursor: snapshotLoading ? "not-allowed" : "pointer",
            opacity: snapshotLoading ? 0.6 : 1,
          }}
        >
          {snapshotLoading ? "Taking..." : "Take Snapshot"}
        </button>
      </div>

      {/* Overall Status */}
      <div
        className="card"
        style={{
          padding: "1rem",
          marginBottom: "1.5rem",
          background: statusStyle.bg,
          border: `1px solid ${statusStyle.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "1.5rem" }}>
            {status === "healthy" ? "+" : status === "warning" ? "!" : "X"}
          </span>
          <div>
            <div style={{ fontWeight: 600, color: statusStyle.text }}>
              Status: {status.charAt(0).toUpperCase() + status.slice(1)}
            </div>
            <div className="text-muted" style={{ fontSize: "0.875rem" }}>
              {problems.length === 0
                ? "All metrics within acceptable thresholds"
                : `${problems.length} issue${problems.length > 1 ? "s" : ""} detected`}
            </div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Last updated
            </div>
            <div style={{ fontSize: "0.875rem" }}>
              {new Date(data.generated_at).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Critical Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <MetricCard
          title="Cat-Place Coverage"
          value={`${summary.cat_place_coverage}%`}
          target="99%+"
          status={summary.cat_place_coverage >= 95 ? "good" : summary.cat_place_coverage >= 90 ? "warning" : "critical"}
          detail={`${summary.cats_without_places} cats need links`}
        />
        <MetricCard
          title="Invalid People"
          value={summary.invalid_people}
          target="0"
          status={summary.invalid_people === 0 ? "good" : summary.invalid_people < 100 ? "warning" : "critical"}
          detail="Garbage names in database"
        />
        <MetricCard
          title="Orgs as People"
          value={summary.orgs_as_people}
          target="0"
          status={summary.orgs_as_people === 0 ? "good" : summary.orgs_as_people < 50 ? "warning" : "critical"}
          detail="Need conversion"
        />
        <MetricCard
          title="Pending Reviews"
          value={summary.pending_reviews}
          target="<100"
          status={summary.pending_reviews < 100 ? "good" : summary.pending_reviews < 500 ? "warning" : "critical"}
          detail="Identity matches to review"
          href="/admin/data-engine/review"
        />
        <MetricCard
          title="Geocoding Queue"
          value={summary.geocoding_queue}
          target="<50"
          status={summary.geocoding_queue < 50 ? "good" : summary.geocoding_queue < 200 ? "warning" : "critical"}
          detail="Places awaiting geocoding"
        />
        <MetricCard
          title="Household Coverage"
          value={`${summary.household_coverage}%`}
          target="40%+"
          status={summary.household_coverage >= 40 ? "good" : summary.household_coverage >= 20 ? "warning" : "critical"}
          detail="People in households"
          href="/admin/data-engine/households"
        />
      </div>

      {/* Problems Section */}
      {problems.length > 0 && (
        <section className="card" style={{ padding: "1.25rem", marginBottom: "2rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Issues Requiring Attention
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {problems.map((problem) => (
              <div
                key={problem.problem_type}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  padding: "0.75rem 1rem",
                  background:
                    problem.severity === "critical"
                      ? "rgba(239, 68, 68, 0.1)"
                      : "rgba(245, 158, 11, 0.1)",
                  borderRadius: "8px",
                  borderLeft: `4px solid ${
                    problem.severity === "critical" ? "#ef4444" : "#f59e0b"
                  }`,
                }}
              >
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    padding: "0.125rem 0.5rem",
                    borderRadius: "4px",
                    background: problem.severity === "critical" ? "#ef4444" : "#f59e0b",
                    color: "#fff",
                    textTransform: "uppercase",
                  }}
                >
                  {problem.severity}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{problem.description}</div>
                  <code
                    style={{
                      fontSize: "0.75rem",
                      background: "var(--card-border)",
                      padding: "0.125rem 0.25rem",
                      borderRadius: "4px",
                    }}
                  >
                    {problem.problem_type}
                  </code>
                </div>
                <div style={{ fontWeight: 600, fontSize: "1.25rem" }}>
                  {problem.count}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Detailed Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Cats Section */}
        <section className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Cats
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <StatItem label="Total Cats" value={dashboard.total_cats} />
            <StatItem label="With Place Links" value={dashboard.cats_with_places} />
            <StatItem
              label="Coverage"
              value={`${dashboard.cat_place_coverage_pct}%`}
              highlight={dashboard.cat_place_coverage_pct >= 95}
            />
            <StatItem label="Created (24h)" value={dashboard.cats_created_24h} />
          </div>
        </section>

        {/* People Section */}
        <section className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            People
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <StatItem label="Total People" value={dashboard.total_people} />
            <StatItem label="Valid Names" value={dashboard.valid_people} />
            <StatItem label="Invalid Names" value={dashboard.invalid_people} warning={dashboard.invalid_people > 0} />
            <StatItem label="Orgs as People" value={dashboard.orgs_as_people} warning={dashboard.orgs_as_people > 0} />
            <StatItem label="Garbage Quality" value={dashboard.garbage_people} />
            <StatItem label="Non-Canonical" value={dashboard.non_canonical_people} />
          </div>
        </section>

        {/* Data Engine Section */}
        <section className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Data Engine
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <StatItem label="Total Decisions" value={dashboard.total_de_decisions} />
            <StatItem label="Decisions (24h)" value={dashboard.de_decisions_24h} />
            <StatItem label="Auto Matches" value={dashboard.auto_matches} />
            <StatItem label="New Entities" value={dashboard.new_entities} />
            <StatItem label="Pending Reviews" value={dashboard.pending_reviews} warning={dashboard.pending_reviews > 100} />
            <StatItem label="Soft Blacklist" value={dashboard.soft_blacklist_count} />
          </div>
        </section>

        {/* Places Section */}
        <section className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Places
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <StatItem label="Total Places" value={dashboard.total_places} />
            <StatItem label="Geocoded" value={dashboard.geocoded_places} />
            <StatItem
              label="Geocoding Queue"
              value={dashboard.geocoding_queue}
              warning={dashboard.geocoding_queue > 100}
            />
            <StatItem
              label="Coverage"
              value={`${dashboard.geocoding_coverage_pct}%`}
              highlight={dashboard.geocoding_coverage_pct >= 95}
            />
          </div>
        </section>

        {/* Households Section */}
        <section className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Households
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <StatItem label="Total Households" value={dashboard.total_households} />
            <StatItem label="People in Households" value={dashboard.people_in_households} />
            <StatItem
              label="Coverage"
              value={`${dashboard.household_coverage_pct}%`}
              highlight={dashboard.household_coverage_pct >= 40}
            />
            <StatItem label="External Orgs" value={dashboard.total_external_organizations} />
          </div>
        </section>

        {/* Appointments Section */}
        <section className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Appointments
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <StatItem label="Total Appointments" value={dashboard.total_appointments} />
            <StatItem label="With Person Link" value={dashboard.appointments_with_person} />
            <StatItem label="With Trapper Link" value={dashboard.appointments_with_trapper} />
            <StatItem
              label="Person Coverage"
              value={`${dashboard.appointment_person_pct}%`}
              highlight={dashboard.appointment_person_pct >= 95}
            />
          </div>
        </section>
      </div>

      {/* Recent Activity */}
      <section className="card" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
        <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
          Recent Activity (24h)
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "1rem",
          }}
        >
          <StatItem label="Records Staged" value={dashboard.records_staged_24h} />
          <StatItem label="People Created" value={dashboard.people_created_24h} />
          <StatItem
            label="Invalid People Created"
            value={dashboard.invalid_people_created_24h}
            warning={dashboard.invalid_people_created_24h > 10}
          />
          <StatItem label="Cats Created" value={dashboard.cats_created_24h} />
          <StatItem label="DE Decisions" value={dashboard.de_decisions_24h} />
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  title,
  value,
  target,
  status,
  detail,
  href,
}: {
  title: string;
  value: string | number;
  target: string;
  status: "good" | "warning" | "critical";
  detail: string;
  href?: string;
}) {
  const statusColors = {
    good: { border: "#10b981", bg: "#ecfdf5" },
    warning: { border: "#f59e0b", bg: "#fef3c7" },
    critical: { border: "#ef4444", bg: "#fef2f2" },
  };

  const style = statusColors[status];

  const content = (
    <div
      className="card"
      style={{
        padding: "1rem",
        borderLeft: `4px solid ${style.border}`,
        background: style.bg,
      }}
    >
      <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>
        {title}
      </div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1 }}>
        {value}
      </div>
      <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
        Target: {target}
      </div>
      <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
        {detail}
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
        {content}
      </a>
    );
  }

  return content;
}

function StatItem({
  label,
  value,
  warning,
  highlight,
}: {
  label: string;
  value: string | number;
  warning?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: "0.5rem",
        background: warning
          ? "rgba(239, 68, 68, 0.1)"
          : highlight
          ? "rgba(16, 185, 129, 0.1)"
          : "var(--card-bg)",
        borderRadius: "6px",
      }}
    >
      <div className="text-muted" style={{ fontSize: "0.75rem", marginBottom: "0.125rem" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          color: warning ? "#dc2626" : highlight ? "#059669" : undefined,
        }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
