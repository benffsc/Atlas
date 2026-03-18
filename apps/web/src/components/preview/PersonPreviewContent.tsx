"use client";

import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { PersonStatusBadges } from "@/components/badges";
import { formatRelativeTime, getActivityColor, formatPhone } from "@/lib/formatters";
import { formatRole } from "@/lib/display-labels";
import type { PersonDetail } from "@/hooks/useEntityDetail";

interface PersonPreviewContentProps {
  person: PersonDetail;
  onClose: () => void;
}

/**
 * Maps PersonDetail data to EntityPreviewPanel props.
 * Used in the split-view panel on the people list page.
 */
export function PersonPreviewContent({ person, onClose }: PersonPreviewContentProps) {
  const relTime = formatRelativeTime(person.last_appointment_date);
  const actColor = getActivityColor(person.last_appointment_date);

  const catCount = person.cat_count ?? person.cats?.length ?? 0;
  const placeCount = person.place_count ?? person.places?.length ?? 0;

  const stats = [
    { label: "Cats", value: catCount },
    { label: "Places", value: placeCount },
    { label: "Last Activity", value: relTime || "Never", color: actColor || "var(--muted)" },
  ];

  const email = person.identifiers?.find((i) => i.id_type === "email")?.id_value || null;
  const phone = person.identifiers?.find((i) => i.id_type === "phone")?.id_value || null;

  const badges = (
    <PersonStatusBadges
      primaryRole={person.primary_role}
      trapperType={person.trapper_type}
      doNotContact={person.do_not_contact}
      entityType={person.entity_type}
      catCount={person.cat_count}
      size="sm"
    />
  );

  const sections = [
    {
      id: "roles",
      title: "Roles & Status",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          {person.primary_role && (
            <DetailRow label="Role" value={formatRole(person.primary_role)} />
          )}
          {person.trapper_type && (
            <DetailRow label="Trapper Type" value={person.trapper_type.replace(/_/g, " ")} />
          )}
          {person.do_not_contact && (
            <DetailRow label="DNC" value="Do Not Contact" valueColor="#dc2626" />
          )}
          {person.is_verified && (
            <DetailRow label="Verified" value="Yes" valueColor="#16a34a" />
          )}
          {person.primary_address && (
            <DetailRow label="Address" value={person.primary_address} />
          )}
        </div>
      ),
    },
    ...(person.cats?.length || person.places?.length ? [{
      id: "relationships",
      title: "Relationships",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
          {person.cats?.slice(0, 4).map((c) => (
            <div key={c.cat_id} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{c.display_name}</span>
              <RoleBadge role={c.relationship_type} />
            </div>
          ))}
          {person.cats && person.cats.length > 4 && (
            <MoreLabel count={person.cats.length - 4} />
          )}
          {person.places?.slice(0, 3).map((p) => (
            <div key={p.place_id} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-secondary)" }}>{p.display_name}</span>
              <RoleBadge role={p.role} />
            </div>
          ))}
        </div>
      ),
    }] : []),
  ];

  return (
    <EntityPreviewPanel
      title={person.display_name}
      detailHref={`/people/${person.person_id}`}
      onClose={onClose}
      badges={badges}
      stats={stats}
      contact={{ phone, email }}
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
