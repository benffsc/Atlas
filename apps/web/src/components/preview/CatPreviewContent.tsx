"use client";

import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { CatHealthBadges, buildHealthFlags } from "@/components/badges";
import { formatRelativeTime, getActivityColor } from "@/lib/formatters";
import type { CatDetail } from "@/hooks/useEntityDetail";

interface CatPreviewContentProps {
  cat: CatDetail;
  onClose: () => void;
}

/**
 * Maps CatDetail data to EntityPreviewPanel props.
 * Used in the split-view panel on the cats list page.
 */
export function CatPreviewContent({ cat, onClose }: CatPreviewContentProps) {
  const relTime = formatRelativeTime(cat.last_appointment_date);
  const actColor = getActivityColor(cat.last_appointment_date);

  const latestVital = cat.vitals?.[0];
  const healthFlags = buildHealthFlags({
    diseases: cat.tests?.map((t) => ({
      disease_key: t.disease_key || t.test_type || "",
      short_code: t.short_code || t.disease_key || t.test_type,
      display_name: t.disease_display_name,
      color: t.disease_badge_color,
      result: t.result || "",
    })),
    isPregnant: latestVital?.is_pregnant ?? false,
    isLactating: latestVital?.is_lactating ?? false,
    conditions: cat.conditions?.filter((c) => !c.resolved_at) ?? [],
    ageGroup: cat.age_group,
    weightLbs: cat.weight_lbs ?? latestVital?.weight_lbs,
  });

  const stats = [
    { label: "Clinic Visits", value: cat.total_appointments ?? 0 },
    { label: "Places", value: cat.places?.length ?? 0 },
    { label: "Owners", value: cat.owners?.length ?? 0 },
    { label: "Weight", value: cat.weight_lbs != null ? `${cat.weight_lbs} lbs` : "\u2014" },
  ];

  const badges = (healthFlags.length > 0 || cat.is_deceased) ? (
    <CatHealthBadges healthFlags={healthFlags} isDeceased={cat.is_deceased ?? false} maxInline={3} />
  ) : null;

  const sections = [
    {
      id: "identity",
      title: "Identity",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          {cat.identifiers?.find((i) => i.id_type === "microchip") && (
            <DetailRow label="Microchip" value={cat.identifiers.find((i) => i.id_type === "microchip")!.id_value} mono />
          )}
          {cat.breed && <DetailRow label="Breed" value={cat.breed} />}
          {cat.sex && <DetailRow label="Sex" value={`${cat.sex}${cat.altered_status ? ` (${cat.altered_status})` : ""}`} />}
          {cat.primary_color && <DetailRow label="Color" value={cat.primary_color} />}
          {cat.age_group && <DetailRow label="Age Group" value={cat.age_group} />}
        </div>
      ),
    },
    {
      id: "medical",
      title: "Medical",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          <DetailRow
            label="Altered"
            value={cat.altered_status === "altered" ? "Yes" : cat.altered_status || "Unknown"}
            valueColor={cat.altered_status === "altered" ? "#16a34a" : "#9ca3af"}
          />
          {cat.conditions?.filter((c) => !c.resolved_at).map((c, i) => (
            <DetailRow key={i} label="Condition" value={c.condition_type} />
          ))}
          {cat.tests?.filter((t) => t.result === "positive").map((t, i) => (
            <DetailRow key={i} label={t.disease_display_name || t.disease_key || "Disease"} value="Positive" valueColor="#dc2626" />
          ))}
          <DetailRow label="Last Visit" value={relTime || "Never"} valueColor={actColor || "#999"} />
        </div>
      ),
    },
    ...(cat.owners?.length || cat.places?.length ? [{
      id: "relationships",
      title: "Relationships",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
          {cat.owners?.slice(0, 3).map((o) => (
            <div key={o.person_id} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{o.display_name}</span>
              <RoleBadge role={o.relationship_type} />
            </div>
          ))}
          {(cat.owners?.length ?? 0) > 3 && <MoreLabel count={(cat.owners?.length ?? 0) - 3} />}
          {cat.places?.slice(0, 2).map((p) => (
            <div key={p.place_id} style={{ color: "var(--text-secondary)" }}>
              {p.display_name}
            </div>
          ))}
        </div>
      ),
    }] : []),
  ];

  return (
    <EntityPreviewPanel
      title={cat.display_name}
      detailHref={`/cats/${cat.cat_id}`}
      onClose={onClose}
      badges={badges}
      stats={stats}
      sections={sections}
    />
  );
}

// --- Shared sub-components ---

function DetailRow({ label, value, mono, valueColor }: { label: string; value: string; mono?: boolean; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 500, fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? "0.8rem" : "inherit", color: valueColor }}>{value}</span>
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
      {role.replace(/_/g, " ")}
    </span>
  );
}

function MoreLabel({ count }: { count: number }) {
  return <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>+{count} more</div>;
}
