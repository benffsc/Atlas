"use client";

import { LinkedCatsSection } from "@/components/sections";
import type { SectionProps } from "@/lib/person-roles/types";

export function LinkedCatsSectionAdapter({ data }: SectionProps) {
  const person = data.person;
  if (!person) return null;

  const catsForSection = person.cats?.map(c => ({
    cat_id: c.cat_id,
    cat_name: c.cat_name,
    relationship_type: c.relationship_type,
    microchip: c.microchip,
    altered_status: null,
    linked_at: person.created_at,
  })) || [];

  if (catsForSection.length === 0) {
    return <p className="text-muted">No cats linked to this person.</p>;
  }

  return (
    <>
      <p className="text-muted text-sm" style={{ marginBottom: "0.75rem" }}>
        <span style={{ color: "#198754", fontWeight: 500 }}>ClinicHQ</span> = actual clinic patient,{" "}
        <span style={{ color: "var(--muted)" }}>PetLink</span> = microchip only
      </p>
      <LinkedCatsSection cats={catsForSection} context="person" emptyMessage="No cats linked" compact />
    </>
  );
}
