"use client";

import { EntityLink } from "@/components/common";
import type { SectionProps } from "@/lib/person-roles/types";

export function RelatedPeopleAdapter({ data }: SectionProps) {
  const relationships = data.person?.person_relationships;
  if (!relationships || relationships.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
      {relationships.map((rel) => (
        <EntityLink
          key={rel.person_id}
          href={`/people/${rel.person_id}`}
          label={rel.person_name}
          badge={rel.relationship_label}
        />
      ))}
    </div>
  );
}
