"use client";

import { useState, useEffect } from "react";

interface OverallStats {
  total_decisions: number;
  total_auto_matches: number;
  total_new_entities: number;
  total_reviews: number;
  total_households: number;
  total_household_members: number;
  avg_processing_ms: number;
  avg_confidence_score: number;
}

interface RuleEffectiveness {
  rule_name: string;
  is_active: boolean;
  total_matches: number;
  avg_score: number;
}

interface ReviewStats {
  pending: number;
  approved: number;
  merged: number;
  rejected: number;
  avg_time_to_review_hours: number;
}

interface DataEngineStats {
  period_days: number;
  generated_at: string;
  overall: OverallStats | null;
  rule_effectiveness: RuleEffectiveness[];
  review_queue: ReviewStats | null;
}

interface HealthData {
  status: string;
  health: {
    total_decisions: number;
    pending_reviews: number;
    total_households: number;
    active_rules: number;
    avg_processing_ms: number;
    decisions_24h: number;
    status: string;
  };
  recent_decisions: Array<{
    decision_id: string;
    decision_type: string;
    source_system: string;
    top_candidate_score: number;
    processed_at: string;
  }>;
}

export default function DataEnginePage() {
  const [stats, setStats] = useState<DataEngineStats | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/data-engine/stats").then((r) => r.ok ? r.json() : null),
      fetch("/api/health/data-engine").then((r) => r.ok ? r.json() : null),
    ])
      .then(([statsData, healthData]) => {
        setStats(statsData);
        setHealth(healthData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1>Data Engine</h1>
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1>Data Engine</h1>
        <div className="card" style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #ef4444" }}>
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  const overall = stats?.overall;
  const reviewQueue = stats?.review_queue;
  const rules = stats?.rule_effectiveness || [];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Data Engine</h1>
        <p className="text-muted">
          Unified identity resolution with multi-signal weighted scoring
        </p>
      </div>

      {/* Health Status */}
      {health && (
        <div
          className="card"
          style={{
            padding: "1rem",
            marginBottom: "1.5rem",
            background: health.health.status === "healthy" ? "#ecfdf5" : "#fef3c7",
            border: `1px solid ${health.health.status === "healthy" ? "#10b981" : "#f59e0b"}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.25rem" }}>
              {health.health.status === "healthy" ? "+" : "!"}
            </span>
            <span style={{ fontWeight: 600 }}>
              Status: {health.health.status === "healthy" ? "Healthy" : "Degraded"}
            </span>
            <span className="text-muted" style={{ marginLeft: "auto", fontSize: "0.875rem" }}>
              {health.health.decisions_24h} decisions in last 24h
            </span>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard
          title="Total Decisions"
          value={overall?.total_decisions || 0}
          subtitle="All time"
        />
        <StatCard
          title="Auto Matches"
          value={overall?.total_auto_matches || 0}
          subtitle={`${overall?.total_decisions ? Math.round((overall.total_auto_matches / overall.total_decisions) * 100) : 0}% of decisions`}
          accent="#10b981"
        />
        <StatCard
          title="New Entities"
          value={overall?.total_new_entities || 0}
          subtitle="Created fresh"
          accent="#3b82f6"
        />
        <StatCard
          title="Pending Reviews"
          value={reviewQueue?.pending || 0}
          subtitle="Need human decision"
          accent="#f59e0b"
          href="/admin/data-engine/review"
        />
        <StatCard
          title="Households"
          value={overall?.total_households || 0}
          subtitle={`${overall?.total_household_members || 0} members`}
          href="/admin/data-engine/households"
        />
        <StatCard
          title="Avg Processing"
          value={`${overall?.avg_processing_ms || 0}ms`}
          subtitle="Per decision"
        />
      </div>

      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Matching Rules */}
        <section className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Matching Rules
          </h2>
          <table style={{ width: "100%", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Rule</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0" }}>Matches</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0" }}>Avg Score</th>
                <th style={{ textAlign: "center", padding: "0.5rem 0" }}>Active</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.rule_name} style={{ borderBottom: "1px solid var(--card-border)" }}>
                  <td style={{ padding: "0.5rem 0" }}>
                    <code style={{ fontSize: "0.8rem", background: "var(--card-border)", padding: "0.125rem 0.25rem", borderRadius: "4px" }}>
                      {rule.rule_name}
                    </code>
                  </td>
                  <td style={{ textAlign: "right", padding: "0.5rem 0" }}>{rule.total_matches}</td>
                  <td style={{ textAlign: "right", padding: "0.5rem 0" }}>
                    {rule.avg_score ? (rule.avg_score * 100).toFixed(0) + "%" : "-"}
                  </td>
                  <td style={{ textAlign: "center", padding: "0.5rem 0" }}>
                    <span style={{ color: rule.is_active ? "#10b981" : "#ef4444" }}>
                      {rule.is_active ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted" style={{ padding: "1rem 0", textAlign: "center" }}>
                    No rules configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Review Queue Summary */}
        <section className="card" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Review Queue</h2>
            <a
              href="/admin/data-engine/review"
              style={{ fontSize: "0.875rem" }}
            >
              View All
            </a>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
            <div style={{ padding: "0.75rem", background: "#fef3c7", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{reviewQueue?.pending || 0}</div>
              <div className="text-muted text-sm">Pending</div>
            </div>
            <div style={{ padding: "0.75rem", background: "#ecfdf5", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{reviewQueue?.approved || 0}</div>
              <div className="text-muted text-sm">Approved</div>
            </div>
            <div style={{ padding: "0.75rem", background: "#eff6ff", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{reviewQueue?.merged || 0}</div>
              <div className="text-muted text-sm">Merged</div>
            </div>
            <div style={{ padding: "0.75rem", background: "#fef2f2", borderRadius: "8px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{reviewQueue?.rejected || 0}</div>
              <div className="text-muted text-sm">Rejected</div>
            </div>
          </div>

          {reviewQueue?.avg_time_to_review_hours && (
            <div className="text-muted text-sm" style={{ marginTop: "1rem" }}>
              Avg time to review: {reviewQueue.avg_time_to_review_hours.toFixed(1)} hours
            </div>
          )}
        </section>
      </div>

      {/* Recent Decisions */}
      {health?.recent_decisions && health.recent_decisions.length > 0 && (
        <section className="card" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
            Recent Decisions
          </h2>
          <table style={{ width: "100%", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Type</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Source</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0" }}>Score</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0" }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {health.recent_decisions.map((decision) => (
                <tr key={decision.decision_id} style={{ borderBottom: "1px solid var(--card-border)" }}>
                  <td style={{ padding: "0.5rem 0" }}>
                    <DecisionBadge type={decision.decision_type} />
                  </td>
                  <td style={{ padding: "0.5rem 0" }}>{decision.source_system}</td>
                  <td style={{ textAlign: "right", padding: "0.5rem 0" }}>
                    {decision.top_candidate_score
                      ? (decision.top_candidate_score * 100).toFixed(0) + "%"
                      : "-"}
                  </td>
                  <td style={{ textAlign: "right", padding: "0.5rem 0" }} className="text-muted">
                    {new Date(decision.processed_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Documentation */}
      <section className="card" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
        <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>
          How the Data Engine Works
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", fontSize: "0.875rem" }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>1. Signal Collection</div>
            <p className="text-muted" style={{ margin: 0 }}>
              Email, phone, name, and address are collected from incoming data
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>2. Candidate Scoring</div>
            <p className="text-muted" style={{ margin: 0 }}>
              Weighted matching: Email 40%, Phone 25%, Name 25%, Address 10%
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>3. Decision</div>
            <p className="text-muted" style={{ margin: 0 }}>
              Score 95%+: auto-match. 50-94%: review queue. Under 50%: new entity
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>4. Household Awareness</div>
            <p className="text-muted" style={{ margin: 0 }}>
              Multiple people at same address with shared phone handled correctly
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  accent,
  href,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  accent?: string;
  href?: string;
}) {
  const content = (
    <div
      className="card"
      style={{
        padding: "1rem",
        borderLeft: accent ? `4px solid ${accent}` : undefined,
      }}
    >
      <div className="text-muted text-sm" style={{ marginBottom: "0.25rem" }}>{title}</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>{subtitle}</div>
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

function DecisionBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    auto_match: { bg: "#ecfdf5", text: "#059669" },
    new_entity: { bg: "#eff6ff", text: "#2563eb" },
    review_pending: { bg: "#fef3c7", text: "#d97706" },
    household_member: { bg: "#f3e8ff", text: "#7c3aed" },
    rejected: { bg: "#fef2f2", text: "#dc2626" },
  };

  const style = colors[type] || { bg: "#f3f4f6", text: "#6b7280" };

  return (
    <span
      style={{
        padding: "0.125rem 0.5rem",
        borderRadius: "4px",
        background: style.bg,
        color: style.text,
        fontSize: "0.75rem",
        fontWeight: 500,
      }}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}
