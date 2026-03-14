"use client";

import { PersonPlaceGoogleContext } from "@/components/cards";
import type { SectionProps } from "@/lib/person-roles/types";

export function LocationContextAdapter({ personId }: SectionProps) {
  return <PersonPlaceGoogleContext personId={personId} />;
}
