"use client";

import { LinkedPlacesSection } from "@/components/sections";
import type { SectionProps } from "@/lib/person-roles/types";
import type { AssociatedPlace, PersonPlace } from "@/hooks/usePersonDetail";

export function LinkedPlacesSectionAdapter({ data }: SectionProps) {
  const person = data.person;
  if (!person) return null;

  const placesForSection = (person.associated_places || person.places || []).map(p => {
    if ('source_type' in p) {
      const ap = p as AssociatedPlace;
      return {
        place_id: ap.place_id,
        display_name: ap.display_name,
        formatted_address: ap.formatted_address,
        place_kind: ap.place_kind,
        relationship_type: ap.source_type,
        is_primary: person.primary_address_id ? ap.formatted_address === person.primary_address : false,
      };
    } else {
      const pl = p as PersonPlace;
      return {
        place_id: pl.place_id,
        display_name: pl.place_name,
        formatted_address: pl.formatted_address,
        place_kind: pl.place_kind,
        relationship_type: pl.role,
        is_primary: false,
      };
    }
  });

  return (
    <LinkedPlacesSection
      places={placesForSection}
      context="person"
      emptyMessage="No places linked"
      showCount={false}
      title=""
      compact
    />
  );
}
