"use client";

import { NearbyEntities } from "@/components/NearbyEntities";

interface NearbyTabProps {
  requestId: string;
  onCountsLoaded: (counts: { requests: number; places: number; people: number; cats: number }) => void;
}

export function NearbyTab({ requestId, onCountsLoaded }: NearbyTabProps) {
  return (
    <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
      <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Nearby Entities</h2>
      <NearbyEntities
        requestId={requestId}
        onCountsLoaded={onCountsLoaded}
      />
    </div>
  );
}
