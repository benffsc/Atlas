"use client";

import { Section } from "@/components/layouts";
import { EntityLink } from "@/components/common";
import { CatMovementSection } from "@/components/sections";
import type { CatDetailData } from "@/lib/cat-types";
import type { EntityType } from "@/hooks/useEntityDetail";

interface ConnectionsTabProps {
  data: CatDetailData;
  preview: { handleClick: (type: EntityType, id: string) => (e: React.MouseEvent) => void };
  onTransfer: () => void;
}

export function ConnectionsTab({ data, preview, onTransfer }: ConnectionsTabProps) {
  const cat = data.cat!;

  return (
    <>
      <div className="detail-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>People</h2>
          <button onClick={onTransfer} style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}>
            Transfer Ownership
          </button>
        </div>
        {cat.owners && cat.owners.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {cat.owners.map((owner) => (
              <EntityLink
                key={owner.person_id}
                href={`/people/${owner.person_id}`}
                label={owner.display_name}
                badge={owner.role}
                badgeColor={owner.role === "owner" ? "#0d6efd" : "#6c757d"}
                onClick={preview.handleClick("person", owner.person_id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No people linked to this cat.</p>
        )}
      </div>

      <Section title="Places">
        {cat.places && cat.places.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {cat.places.map((catPlace) => (
              <EntityLink
                key={catPlace.place_id}
                href={`/places/${catPlace.place_id}`}
                label={catPlace.label}
                badge={catPlace.place_kind || catPlace.role}
                badgeColor={catPlace.role === "residence" ? "#198754" : "#6c757d"}
                onClick={preview.handleClick("place", catPlace.place_id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">No places linked to this cat.</p>
        )}
      </Section>

      <Section title="Movement & Reunification">
        <CatMovementSection catId={cat.cat_id} />
      </Section>
    </>
  );
}
