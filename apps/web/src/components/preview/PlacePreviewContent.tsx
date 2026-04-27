"use client";

import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { PlaceRiskBadges } from "@/components/badges";
import { formatRelativeTime, getActivityColor } from "@/lib/formatters";
import { formatPlaceKind, formatRole } from "@/lib/display-labels";
import type { PlaceDetail } from "@/hooks/useEntityDetail";

interface PlacePreviewContentProps {
  place: PlaceDetail;
  onClose: () => void;
}

/**
 * @deprecated Use `PlaceDetailShell` with `mode="panel"` instead.
 * This component is superseded by the unified shell that renders the full
 * detail page inside the drawer panel. Kept temporarily for reference.
 */
export function PlacePreviewContent({ place, onClose }: PlacePreviewContentProps) {
  const relTime = formatRelativeTime(place.last_appointment_date);
  const actColor = getActivityColor(place.last_appointment_date);

  const catCount = place.cat_count ?? place.cats?.length ?? 0;
  const personCount = place.person_count ?? place.people?.length ?? 0;
  const alteredCount = place.total_altered_count ?? 0;
  const colonySize = place.colony_size ?? 0;

  const stats = [
    { label: "Cats", value: catCount },
    { label: "Altered", value: alteredCount, color: alteredCount > 0 ? "#16a34a" : "var(--muted)" },
    { label: "People", value: personCount },
    { label: "Active Requests", value: place.active_request_count ?? 0, color: (place.active_request_count ?? 0) > 0 ? "#f59e0b" : "var(--muted)" },
  ];

  const hasDiseaseRisk = place.disease_badges?.length || place.watch_list;
  const badges = hasDiseaseRisk ? (
    <PlaceRiskBadges
      diseaseFlags={place.disease_badges?.map((d) => ({
        disease_key: d.disease_key,
        short_code: d.short_code,
        status: d.status,
        color: d.color,
        positive_cat_count: d.positive_cat_count,
      }))}
      watchList={place.watch_list}
    />
  ) : null;

  const sections = [
    {
      id: "details",
      title: "Details",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          {place.formatted_address && <DetailRow label="Address" value={place.formatted_address} />}
          {place.place_kind && <DetailRow label="Type" value={formatPlaceKind(place.place_kind)} />}
          {place.locality && <DetailRow label="Locality" value={place.locality} />}
          <DetailRow label="Last Activity" value={relTime || "Never"} valueColor={actColor || "var(--muted)"} />
        </div>
      ),
    },
    ...(colonySize > 0 ? [{
      id: "colony",
      title: "Colony",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          <DetailRow label="Colony Size" value={String(colonySize)} />
          {alteredCount > 0 && (
            <DetailRow
              label="Alteration Rate"
              value={`${alteredCount}/${colonySize} (${Math.round((alteredCount / colonySize) * 100)}%)`}
              valueColor={alteredCount / colonySize >= 0.8 ? "#16a34a" : alteredCount / colonySize >= 0.5 ? "#f59e0b" : "#dc2626"}
            />
          )}
        </div>
      ),
    }] : []),
    ...(place.cats?.length || place.people?.length ? [{
      id: "relationships",
      title: "Relationships",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
          {place.cats?.slice(0, 4).map((c) => (
            <div key={c.cat_id} style={{ color: "var(--foreground)" }}>
              {c.display_name}
            </div>
          ))}
          {(place.cats?.length ?? 0) > 4 && <MoreLabel count={(place.cats?.length ?? 0) - 4} />}
          {place.people?.slice(0, 3).map((p) => (
            <div key={p.person_id} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{p.display_name}</span>
              <RoleBadge role={p.role} />
            </div>
          ))}
        </div>
      ),
    }] : []),
  ];

  return (
    <EntityPreviewPanel
      title={place.display_name}
      detailHref={`/places/${place.place_id}`}
      onClose={onClose}
      badges={badges}
      stats={stats}
      sections={sections}
    />
  );
}

// --- Shared sub-components ---

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 500, color: valueColor }}>{value}</span>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span style={{
      fontSize: "0.7rem",
      padding: "0.1rem 0.4rem",
      borderRadius: "3px",
      background: "color-mix(in srgb, var(--primary) 15%, transparent)",
      color: "var(--primary)",
    }}>
      {formatRole(role)}
    </span>
  );
}

function MoreLabel({ count }: { count: number }) {
  return <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>+{count} more</div>;
}
