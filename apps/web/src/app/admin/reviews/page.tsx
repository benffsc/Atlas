"use client";

import { useState, useEffect } from "react";
import { ReviewStatsBar } from "@/components/reviews";

interface QueueSummary {
  identity: {
    total: number;
    tier1_email: number;
    tier2_phone_name: number;
    tier3_phone_only: number;
    tier4_name_address: number;
    tier5_name_only: number;
    data_engine_pending: number;
  };
  places: {
    total: number;
    close_similar: number;
    close_different: number;
  };
  quality: {
    total: number;
  };
  ai_parsed: {
    total: number;
    colony_estimates: number;
    reproduction: number;
    mortality: number;
  };
  priority_items: Array<{
    id: string;
    type: string;
    title: string;
    subtitle: string;
    priority: "high" | "medium" | "low";
    age_hours: number;
    href: string;
  }>;
}

function formatAge(hours: number): string {
  if (hours < 1) return "< 1 hour";
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""}`;
}

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  const config = {
    high: { bg: "#fee2e2", color: "#dc2626", label: "High" },
    medium: { bg: "#fef3c7", color: "#d97706", label: "Med" },
    low: { bg: "#dbeafe", color: "#2563eb", label: "Low" },
  };
  const { bg, color, label } = config[priority];
  return (
    <span
      style={{
        padding: "0.15rem 0.4rem",
        borderRadius: "4px",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: bg,
        color: color,
      }}
    >
      {label}
    </span>
  );
}

export default function ReviewsDashboard() {
  const [data, setData] = useState<QueueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/reviews/summary")
      .then((res) => res.json())
      .then((result) => {
        if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1>Data Review Hub</h1>
        <p className="text-muted">Loading review queues...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1>Data Review Hub</h1>
        <div
          className="card"
          style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #ef4444" }}
        >
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  const totalPending =
    (data?.identity.total || 0) +
    (data?.places.total || 0) +
    (data?.quality.total || 0) +
    (data?.ai_parsed.total || 0);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Data Review Hub</h1>
        <p className="text-muted">
          Unified view of all data quality review queues. {totalPending} items pending.
        </p>
      </div>

      {/* Main Queue Stats */}
      <ReviewStatsBar
        showTotal={true}
        stats={[
          {
            label: "Identity",
            count: data?.identity.total || 0,
            color: "#6f42c1",
            href: "/admin/reviews/identity",
            subLabel: "Person duplicates",
          },
          {
            label: "Places",
            count: data?.places.total || 0,
            color: "#0d6efd",
            href: "/admin/reviews/places",
            subLabel: "Location duplicates",
          },
          {
            label: "Quality",
            count: data?.quality.total || 0,
            color: "#fd7e14",
            href: "/admin/reviews/quality",
            subLabel: "Low-quality records",
          },
          {
            label: "AI-Parsed",
            count: data?.ai_parsed.total || 0,
            color: "#198754",
            href: "/admin/reviews/ai-parsed",
            subLabel: "Needs verification",
          },
        ]}
      />

      {/* Identity Breakdown */}
      {data && data.identity.total > 0 && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.75rem" }}>
            Identity Review Breakdown
          </div>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.875rem" }}>
            {data.identity.tier4_name_address > 0 && (
              <a href="/admin/reviews/identity?filter=tier4" style={{ color: "#6f42c1" }}>
                Tier 4 (Name+Address): {data.identity.tier4_name_address}
              </a>
            )}
            {data.identity.tier2_phone_name > 0 && (
              <a href="/admin/reviews/identity?filter=tier2" style={{ color: "#0d6efd" }}>
                Tier 2 (Phone+Name): {data.identity.tier2_phone_name}
              </a>
            )}
            {data.identity.tier1_email > 0 && (
              <a href="/admin/reviews/identity?filter=tier1" style={{ color: "#198754" }}>
                Tier 1 (Email): {data.identity.tier1_email}
              </a>
            )}
            {data.identity.tier3_phone_only > 0 && (
              <a href="/admin/reviews/identity?filter=tier3" style={{ color: "#fd7e14" }}>
                Tier 3 (Phone Only): {data.identity.tier3_phone_only}
              </a>
            )}
            {data.identity.tier5_name_only > 0 && (
              <a href="/admin/reviews/identity?filter=tier5" style={{ color: "#dc3545" }}>
                Tier 5 (Name Only): {data.identity.tier5_name_only}
              </a>
            )}
            {data.identity.data_engine_pending > 0 && (
              <a href="/admin/reviews/identity?filter=uncertain" style={{ color: "#6c757d" }}>
                Uncertain Matches: {data.identity.data_engine_pending}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Priority Queue */}
      {data && data.priority_items.length > 0 && (
        <div className="card" style={{ padding: "1rem" }}>
          <div
            style={{
              fontWeight: 600,
              marginBottom: "0.75rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Priority Queue (Oldest Items)</span>
            <span className="text-muted text-sm">
              {data.priority_items.filter((i) => i.priority === "high").length} high priority
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {data.priority_items.map((item) => (
              <a
                key={item.id}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  background: "var(--bg-muted)",
                  borderRadius: "6px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <PriorityBadge priority={item.priority} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    className="text-muted text-sm"
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.subtitle}
                  </div>
                </div>
                <div className="text-muted text-sm" style={{ flexShrink: 0 }}>
                  {formatAge(item.age_hours)}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {totalPending === 0 && (
        <div
          className="card"
          style={{ padding: "3rem", textAlign: "center" }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>All clear!</div>
          <p className="text-muted">No items pending review. Great job!</p>
        </div>
      )}

      {/* Quick Links */}
      <div
        style={{
          marginTop: "2rem",
          padding: "1rem",
          background: "var(--bg-muted)",
          borderRadius: "8px",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem" }}>
          Quick Links
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.8125rem" }}>
          <a href="/admin/data-engine">Data Engine Dashboard</a>
          <a href="/admin/data-engine/households">Households</a>
          <a href="/admin/known-organizations">Known Organizations</a>
          <a href="/admin/tippy-corrections">Tippy Corrections</a>
        </div>
      </div>
    </div>
  );
}
