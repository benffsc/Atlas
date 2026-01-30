"use client";

import JournalSection, { JournalEntry } from "@/components/JournalSection";

interface ActivityTabProps {
  requestId: string;
  journalEntries: JournalEntry[];
  onEntryAdded: () => void;
  currentStaffId?: string;
  currentStaffName?: string;
}

export function ActivityTab({ requestId, journalEntries, onEntryAdded, currentStaffId, currentStaffName }: ActivityTabProps) {
  return (
    <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
      <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Journal</h2>
      <JournalSection
        entries={journalEntries}
        entityType="request"
        entityId={requestId}
        onEntryAdded={onEntryAdded}
        currentStaffId={currentStaffId}
        currentStaffName={currentStaffName}
      />
    </div>
  );
}
