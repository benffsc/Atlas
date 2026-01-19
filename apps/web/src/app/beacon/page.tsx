"use client";

import { useState, useEffect } from "react";
import { SeasonalAlertsCard } from "@/components/SeasonalAlertsCard";
import { YoYComparisonChart } from "@/components/YoYComparisonChart";

interface BeaconSummaryResponse {
  summary: {
    total_cats: number;
    total_places: number;
    places_with_cats: number;
    total_verified_cats: number;
    total_altered_cats: number;
    overall_alteration_rate: number | null;
    colonies_managed: number;
    colonies_in_progress: number;
    colonies_needs_work: number;
    colonies_needs_attention: number;
    colonies_no_data: number;
    total_clusters: number;
    places_in_clusters: number;
    isolated_places: number;
    clusters_managed: number;
    clusters_in_progress: number;
    clusters_needs_work: number;
    clusters_needs_attention: number;
    estimated_cats_to_alter: number | null;
  };
  insights: {
    managed_percentage: number;
    cluster_management_rate: number;
    tnr_target_rate: number;
    progress_to_target: number | null;
  };
}

export default function BeaconPage() {
  const [data, setData] = useState<BeaconSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/beacon/summary")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setData(d))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const summary = data?.summary;
  const insights = data?.insights;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>
          Beacon
        </h1>
        <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0 0" }}>
          Ecological analytics and TNR impact assessment
        </p>
      </div>

      {/* Summary Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <StatCard
          value={loading ? "-" : summary?.places_with_cats?.toLocaleString() || "0"}
          label="Active Colonies"
          color="#6b7280"
        />
        <StatCard
          value={loading ? "-" : summary?.total_verified_cats?.toLocaleString() || "0"}
          label="Verified Cats"
          color="#8b5cf6"
        />
        <StatCard
          value={loading ? "-" : summary?.total_altered_cats?.toLocaleString() || "0"}
          label="Cats Altered"
          color="#16a34a"
        />
        <StatCard
          value={
            loading
              ? "-"
              : summary?.overall_alteration_rate
              ? `${Math.round(summary.overall_alteration_rate)}%`
              : "0%"
          }
          label="Alteration Rate"
          color={
            summary?.overall_alteration_rate && summary.overall_alteration_rate >= 70
              ? "#16a34a"
              : summary?.overall_alteration_rate && summary.overall_alteration_rate >= 50
              ? "#f59e0b"
              : "#dc2626"
          }
        />
        <StatCard
          value={loading ? "-" : (summary?.clusters_needs_attention || 0).toString()}
          label="Needs Attention"
          color="#dc2626"
        />
      </div>

      {/* Quick Info */}
      <div
        className="card"
        style={{
          padding: "1.5rem",
          marginBottom: "2rem",
          background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
          border: "1px solid #a7f3d0",
        }}
      >
        <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.125rem", color: "#065f46" }}>
          About Beacon
        </h2>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#047857", lineHeight: 1.6 }}>
          Beacon tracks ecological metrics across TNR sites to measure impact and identify areas needing attention.
          Colony estimates are derived from intake forms, trapper observations, and post-clinic surveys.
          The <strong>70% alteration threshold</strong> is the scientifically-supported target for population stabilization
          (Levy et al., 2014; McCarthy et al., 2013).
        </p>
      </div>

      {/* Seasonal Alerts Section */}
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          Seasonal Status & Alerts
        </h2>
        <SeasonalAlertsCard />
      </div>

      {/* Year-over-Year Trends Section */}
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          Year-over-Year Trends
        </h2>
        <YoYComparisonChart />
      </div>

      {/* Analytics Sections */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1.5rem",
        }}
      >
        <AnalyticsCard
          title="Colony Estimates"
          description="Place-by-place colony size estimates with confidence scores"
          href="/admin/beacon/colony-estimates"
          icon="🐱"
          stats={
            loading
              ? undefined
              : `${summary?.places_with_cats || 0} active colonies`
          }
        />
        <AnalyticsCard
          title="Cluster Analysis"
          description="Geographic clustering of colonies for coordinated TNR"
          href="/api/beacon/clusters"
          icon="📍"
          stats={
            loading
              ? undefined
              : `${summary?.total_clusters || 0} clusters identified`
          }
        />
        <AnalyticsCard
          title="Reproduction Events"
          description="Pregnancy, lactation, and kitten observations"
          href="/admin/beacon/reproduction"
          icon="🍼"
        />
        <AnalyticsCard
          title="Mortality Tracking"
          description="Death events and causes for population modeling"
          href="/admin/beacon/mortality"
          icon="📉"
        />
        <AnalyticsCard
          title="Seasonal Patterns"
          description="Monthly trends in intake, alterations, and births"
          href="/admin/beacon/seasonal"
          icon="📅"
        />
        <AnalyticsCard
          title="Population Forecasts"
          description="Projected colony growth and TNR impact scenarios"
          href="/admin/beacon/forecasts"
          icon="📈"
        />
      </div>

      {/* Scientific Context */}
      <div
        className="card"
        style={{
          padding: "1.5rem",
          marginTop: "2rem",
        }}
      >
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem" }}>Scientific Context</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "1rem",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
          }}
        >
          <div>
            <strong style={{ color: "var(--text)" }}>70% Alteration Target</strong>
            <p style={{ margin: "0.25rem 0 0 0" }}>
              Research indicates 70% sterilization coverage is needed to achieve population stabilization
              in free-roaming cat colonies (Levy et al., 2014).
            </p>
          </div>
          <div>
            <strong style={{ color: "var(--text)" }}>Lower-Bound Estimates</strong>
            <p style={{ margin: "0.25rem 0 0 0" }}>
              Beacon reports conservative "at least" counts based on verified clinic records,
              acknowledging uncertainty in true population sizes.
            </p>
          </div>
          <div>
            <strong style={{ color: "var(--text)" }}>Data Sources</strong>
            <p style={{ margin: "0.25rem 0 0 0" }}>
              Colony estimates are weighted by source reliability: clinic records (100%),
              post-surgery surveys (85%), trapper observations (80%), intake forms (55%).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "1.25rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "2rem", fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
        {label}
      </div>
    </div>
  );
}

function AnalyticsCard({
  title,
  description,
  href,
  icon,
  stats,
}: {
  title: string;
  description: string;
  href: string;
  icon: string;
  stats?: string;
}) {
  return (
    <a
      href={href}
      className="card"
      style={{
        padding: "1.25rem",
        textDecoration: "none",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.5rem" }}>{icon}</span>
        <div style={{ fontWeight: 600, fontSize: "1rem" }}>{title}</div>
      </div>
      <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
        {description}
      </div>
      {stats && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "#0d6efd",
            marginTop: "auto",
            paddingTop: "0.5rem",
          }}
        >
          {stats}
        </div>
      )}
    </a>
  );
}
