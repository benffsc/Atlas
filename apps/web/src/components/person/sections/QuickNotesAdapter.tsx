"use client";

import { QuickNotes } from "@/components/common";
import type { SectionProps } from "@/lib/person-roles/types";

export function QuickNotesAdapter({ personId, data, onDataChange }: SectionProps) {
  return (
    <QuickNotes
      entityType="person"
      entityId={personId}
      entries={data.journal}
      onNoteAdded={() => onDataChange?.("journal")}
    />
  );
}
