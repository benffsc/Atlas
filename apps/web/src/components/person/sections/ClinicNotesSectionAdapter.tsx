"use client";

import { ClinicNotesSection } from "@/components/sections";
import type { SectionProps } from "@/lib/person-roles/types";

export function ClinicNotesSectionAdapter({ personId }: SectionProps) {
  return <ClinicNotesSection personId={personId} />;
}
