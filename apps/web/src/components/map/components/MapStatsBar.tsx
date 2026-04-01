import { MAP_Z_INDEX } from "@/lib/design-tokens";
import type { MapSummary } from "@/components/map/types";

interface MapStatsBarProps {
  summary: MapSummary;
}

/**
 * Bottom-left stats bar showing total places and cats linked.
 * Only rendered on desktop (mobile hides this in parent).
 */
export function MapStatsBar({ summary }: MapStatsBarProps) {
  return (
    <div style={{
      position: "absolute", bottom: 24, left: 16, zIndex: MAP_Z_INDEX.statsBar,
      background: "var(--background)", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      padding: "10px 16px", display: "flex", gap: 24,
    }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-secondary)" }}>{summary.total_places.toLocaleString()}</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Total Places</div>
      </div>
      <div style={{ borderLeft: "1px solid var(--border-default)", paddingLeft: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-secondary)" }}>{summary.total_cats.toLocaleString()}</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Cats Linked</div>
      </div>
    </div>
  );
}
