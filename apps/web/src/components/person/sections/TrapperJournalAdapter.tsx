"use client";

import JournalSection from "@/components/sections/JournalSection";
import type { SectionProps } from "@/lib/person-roles/types";

/**
 * Journal adapter for trapper tab. Uses same JournalSection but refetches
 * from trapper data context.
 */
export function TrapperJournalAdapter({ personId, data, onDataChange }: SectionProps) {
  return (
    <JournalSection
      entries={data.journal}
      entityType="person"
      entityId={personId}
      onEntryAdded={() => onDataChange?.("journal")}
    />
  );
}
