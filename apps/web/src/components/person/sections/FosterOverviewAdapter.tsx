"use client";

import type { SectionProps } from "@/lib/person-roles/types";
import { formatDateLocal } from "@/lib/formatters";

/**
 * Foster overview section — shows VH groups, role status, start date, agreement badge.
 */
export function FosterOverviewAdapter({ data }: SectionProps) {
  const volunteerRoles = data.volunteerRoles;
  const fosterRole = volunteerRoles?.roles?.find(r => r.role === "foster");
  const fosterGroups = volunteerRoles?.volunteer_groups?.active?.filter(
    g => g.name.toLowerCase().includes("foster")
  ) || [];
  const fosterStats = volunteerRoles?.operational_summary?.foster_stats;
  const hasAgreement = data.fosterAgreements.length > 0;

  if (!fosterRole) {
    return <p className="text-muted">No foster role found for this person.</p>;
  }

  return (
    <div>
      {/* Status + Groups */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <span style={{
          display: "inline-block",
          padding: "0.25rem 0.75rem",
          borderRadius: "9999px",
          fontSize: "0.8rem",
          fontWeight: 600,
          background: fosterRole.role_status === "active" ? "#dcfce7" : "#f3f4f6",
          color: fosterRole.role_status === "active" ? "#166534" : "#6b7280",
        }}>
          {fosterRole.role_status === "active" ? "Active Foster" : "Inactive Foster"}
        </span>
        {hasAgreement && (
          <span style={{
            display: "inline-block",
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            fontSize: "0.8rem",
            fontWeight: 500,
            background: "#dbeafe",
            color: "#1e40af",
          }}>
            Agreement on File
          </span>
        )}
        {fosterGroups.map(g => (
          <span key={g.name} style={{
            display: "inline-block",
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            fontSize: "0.8rem",
            background: "var(--bg-secondary, #f3f4f6)",
            color: "var(--text-secondary, #374151)",
          }}>
            {g.name}
          </span>
        ))}
      </div>

      {/* Detail grid */}
      <div className="detail-grid">
        <div className="detail-item">
          <span className="detail-label">Role Status</span>
          <span className="detail-value" style={{
            color: fosterRole.role_status === "active" ? "#16a34a" : "#6b7280",
          }}>
            {fosterRole.role_status}
          </span>
        </div>
        {fosterRole.started_at && (
          <div className="detail-item">
            <span className="detail-label">Role Start</span>
            <span className="detail-value">{formatDateLocal(fosterRole.started_at)}</span>
          </div>
        )}
        {fosterRole.source_system && (
          <div className="detail-item">
            <span className="detail-label">Source</span>
            <span className="detail-value">{fosterRole.source_system}</span>
          </div>
        )}
        <div className="detail-item">
          <span className="detail-label">Cats Fostered</span>
          <span className="detail-value">{fosterStats?.cats_fostered ?? 0}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Distinct Cats</span>
          <span className="detail-value">{fosterStats?.current_fosters ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
