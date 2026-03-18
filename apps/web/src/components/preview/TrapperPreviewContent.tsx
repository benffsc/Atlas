"use client";

import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { TrapperBadge } from "@/components/badges/TrapperBadge";
import { formatRelativeTime, getActivityColor } from "@/lib/formatters";

interface Trapper {
  person_id: string;
  display_name: string;
  trapper_type: string;
  role_status: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  felv_positive_rate_pct: number | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
  email: string | null;
  phone: string | null;
  tier: string | null;
  has_signed_contract: boolean;
  availability_status: string;
}

interface TrapperPreviewContentProps {
  trapper: Trapper;
  onClose: () => void;
  onEdit?: () => void;
}

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  busy: "Busy",
  on_leave: "On Leave",
};

const AVAILABILITY_STYLES: Record<string, { bg: string; color: string }> = {
  available: { bg: "#d1fae5", color: "#065f46" },
  busy: { bg: "#fef3c7", color: "#92400e" },
  on_leave: { bg: "#e5e7eb", color: "var(--text-secondary)" },
};

const TIER_LABELS: Record<string, string> = {
  "Tier 1": "Tier 1: FFSC",
  "Tier 2": "Tier 2: Contract",
  "Tier 3": "Tier 3: Informal",
};

function getTierLabel(tier: string | null): string {
  if (!tier) return "Unknown";
  for (const [prefix, label] of Object.entries(TIER_LABELS)) {
    if (tier.startsWith(prefix)) return label;
  }
  return tier;
}

/**
 * Maps a Trapper to EntityPreviewPanel props.
 * Uses list data only - no additional API calls.
 */
export function TrapperPreviewContent({ trapper, onClose, onEdit }: TrapperPreviewContentProps) {
  const relTime = formatRelativeTime(trapper.last_activity_date);
  const actColor = getActivityColor(trapper.last_activity_date);
  const availStyle = AVAILABILITY_STYLES[trapper.availability_status] || AVAILABILITY_STYLES.available;

  const stats = [
    { label: "Total Caught", value: trapper.total_cats_caught, color: trapper.total_cats_caught > 0 ? "#198754" : "var(--muted)" },
    { label: "Active Assignments", value: trapper.active_assignments, color: trapper.active_assignments > 0 ? "#fd7e14" : "var(--muted)" },
    { label: "Direct Bookings", value: trapper.total_clinic_cats },
    { label: "Clinic Days", value: trapper.unique_clinic_days },
    { label: "Avg Cats/Day", value: trapper.avg_cats_per_day },
    { label: "Completed", value: trapper.completed_assignments },
  ];

  const sections = [
    {
      id: "classification",
      title: "Classification",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)" }}>Tier</span>
            <span style={{ fontWeight: 500 }}>{getTierLabel(trapper.tier)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)" }}>Contract</span>
            <span style={{ fontWeight: 500, color: trapper.has_signed_contract ? "#16a34a" : "#9ca3af" }}>
              {trapper.has_signed_contract ? "Signed" : "None"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)" }}>Status</span>
            <span
              style={{
                fontWeight: 500,
                color: trapper.role_status === "active" ? "#065f46" : "#92400e",
              }}
            >
              {trapper.role_status.charAt(0).toUpperCase() + trapper.role_status.slice(1)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)" }}>Availability</span>
            <span
              style={{
                padding: "0.1rem 0.5rem",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 600,
                background: availStyle.bg,
                color: availStyle.color,
              }}
            >
              {AVAILABILITY_LABELS[trapper.availability_status] || trapper.availability_status}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: "activity",
      title: "Activity",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)" }}>Last Activity</span>
            <span style={{ fontWeight: 500, color: actColor || "var(--muted)" }}>
              {relTime || "Never"}
            </span>
          </div>
          {trapper.felv_positive_rate_pct !== null && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>FeLV Rate</span>
              <span style={{ fontWeight: 500 }}>{trapper.felv_positive_rate_pct}%</span>
            </div>
          )}
        </div>
      ),
    },
  ];

  const editButton = onEdit ? (
    <button
      onClick={onEdit}
      style={{
        padding: "0.25rem 0.6rem",
        fontSize: "0.75rem",
        background: "transparent",
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: "4px",
        cursor: "pointer",
      }}
    >
      Edit
    </button>
  ) : undefined;

  return (
    <EntityPreviewPanel
      title={trapper.display_name}
      detailHref={`/trappers/${trapper.person_id}?from=trappers`}
      onClose={onClose}
      badges={<TrapperBadge trapperType={trapper.trapper_type} size="sm" inactive={trapper.role_status !== "active"} />}
      stats={stats}
      contact={{ phone: trapper.phone, email: trapper.email }}
      sections={sections}
      actions={editButton}
    />
  );
}
