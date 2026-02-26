"use client";

import { useState, useEffect } from "react";

interface SiteStats {
  is_part_of_site: boolean;
  cluster_id: string;
  place_count: number;
  place_names: string[];
  unique_cat_count: number;
  altered_cat_count: number;
  alteration_rate_pct: number | null;
  site_status: string;
}

interface SiteStatsCardProps {
  placeId: string;
}

const statusColors: Record<string, { bg: string; color: string; label: string }> = {
  complete: { bg: "#198754", color: "#fff", label: "Complete" },
  nearly_complete: { bg: "#20c997", color: "#000", label: "Nearly Complete" },
  in_progress: { bg: "#fd7e14", color: "#000", label: "In Progress" },
  early_stage: { bg: "#6c757d", color: "#fff", label: "Early Stage" },
  no_cats: { bg: "#adb5bd", color: "#000", label: "No Cats Linked" },
  single_place: { bg: "#0d6efd", color: "#fff", label: "Single Place" },
  unknown: { bg: "#6c757d", color: "#fff", label: "Unknown" },
};

export function SiteStatsCard({ placeId }: SiteStatsCardProps) {
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`/api/places/${placeId}/site-stats`);
        if (!response.ok) {
          throw new Error("Failed to fetch site stats");
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [placeId]);

  // Don't show anything if loading or error
  if (loading) return null;
  if (error) return null;

  // Don't show if not part of a site cluster
  if (!stats || !stats.is_part_of_site) {
    return null;
  }

  const statusStyle = statusColors[stats.site_status] || statusColors.unknown;
  const unalteredCount = stats.unique_cat_count - stats.altered_cat_count;

  return (
    <div
      style={{
        padding: "1rem",
        background: "#f0f7ff",
        border: "1px solid #0d6efd",
        borderRadius: "8px",
        marginBottom: "1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "1.25rem" }}>🔗</span>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>
          Multi-Parcel Site ({stats.place_count} linked places)
        </h3>
        <span
          className="badge"
          style={{
            background: statusStyle.bg,
            color: statusStyle.color,
            fontSize: "0.75rem",
            marginLeft: "auto",
          }}
        >
          {statusStyle.label}
        </span>
      </div>

      <p className="text-sm text-muted" style={{ marginBottom: "0.75rem" }}>
        This place is part of a linked site. Stats below are aggregated across all {stats.place_count} places
        to avoid double-counting cats.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>{stats.unique_cat_count}</div>
          <div className="text-sm text-muted">Unique Cats</div>
        </div>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600, color: "#198754" }}>
            {stats.altered_cat_count}
          </div>
          <div className="text-sm text-muted">Altered</div>
        </div>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600, color: unalteredCount > 0 ? "#dc3545" : "#198754" }}>
            {unalteredCount}
          </div>
          <div className="text-sm text-muted">Remaining</div>
        </div>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            {stats.alteration_rate_pct !== null ? `${stats.alteration_rate_pct}%` : "—"}
          </div>
          <div className="text-sm text-muted">Progress</div>
        </div>
      </div>

      {stats.place_names && stats.place_names.length > 1 && (
        <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid #cce5ff" }}>
          <span className="text-sm text-muted">Linked places: </span>
          <span className="text-sm">
            {stats.place_names.slice(0, 3).join(", ")}
            {stats.place_names.length > 3 && ` +${stats.place_names.length - 3} more`}
          </span>
        </div>
      )}
    </div>
  );
}

export default SiteStatsCard;
