"use client";

import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { formatRelativeDate } from "@/lib/formatters";

interface Foster {
  person_id: string;
  display_name: string;
  role_status: string;
  email: string | null;
  phone: string | null;
  started_at: string | null;
  cats_fostered: number;
  vh_groups: string | null;
  has_agreement: boolean;
}

interface FosterPreviewContentProps {
  foster: Foster;
  onClose: () => void;
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  active: { bg: "#dcfce7", color: "#166534" },
  inactive: { bg: "#f3f4f6", color: "#6b7280" },
};

/**
 * Maps a Foster to EntityPreviewPanel props.
 * Uses list data only — no additional API calls.
 */
export function FosterPreviewContent({ foster, onClose }: FosterPreviewContentProps) {
  const statusStyle = STATUS_STYLES[foster.role_status] || STATUS_STYLES.inactive;

  const badges = (
    <span
      style={{
        padding: "0.125rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: statusStyle.bg,
        color: statusStyle.color,
      }}
    >
      {foster.role_status}
    </span>
  );

  const stats = [
    {
      label: "Cats Fostered",
      value: foster.cats_fostered,
      color: foster.cats_fostered > 0 ? "#7c3aed" : undefined,
    },
  ];

  const sections = [
    {
      id: "details",
      title: "Foster Details",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)" }}>Status</span>
            <span
              style={{
                fontWeight: 500,
                color: foster.role_status === "active" ? "#166534" : "#6b7280",
              }}
            >
              {foster.role_status.charAt(0).toUpperCase() + foster.role_status.slice(1)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)" }}>Agreement</span>
            <span
              style={{
                fontWeight: 500,
                color: foster.has_agreement ? "#1e40af" : "#9ca3af",
              }}
            >
              {foster.has_agreement ? "On file" : "None"}
            </span>
          </div>
          {foster.started_at && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>Started</span>
              <span style={{ fontWeight: 500 }}>{formatRelativeDate(foster.started_at)}</span>
            </div>
          )}
          {foster.vh_groups && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>VH Groups</span>
              <span style={{ fontWeight: 500, fontSize: "0.8rem", textAlign: "right", maxWidth: "60%" }}>
                {foster.vh_groups}
              </span>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <EntityPreviewPanel
      title={foster.display_name}
      detailHref={`/fosters/${foster.person_id}?from=fosters`}
      onClose={onClose}
      badges={badges}
      stats={stats}
      contact={{ phone: foster.phone, email: foster.email }}
      sections={sections}
    />
  );
}
