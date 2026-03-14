"use client";

import JournalSection from "@/components/sections/JournalSection";
import type { SectionProps } from "@/lib/person-roles/types";

export function JournalSectionAdapter({ personId, data, onDataChange }: SectionProps) {
  return (
    <JournalSection
      entries={data.journal}
      entityType="person"
      entityId={personId}
      onEntryAdded={() => onDataChange?.("journal")}
    />
  );
}
