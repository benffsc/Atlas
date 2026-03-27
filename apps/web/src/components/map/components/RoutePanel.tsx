"use client";

import { MAP_Z_INDEX } from "@/lib/design-tokens";

interface RouteLeg {
  distance_text: string;
  duration_text: string;
  start_address: string;
  end_address: string;
}

interface RoutePanelProps {
  legs: RouteLeg[];
  totalDistance: string;
  totalDuration: string;
  waypointOrder: number[] | null;
  onClose: () => void;
}

/**
 * Floating panel showing optimized route details with numbered stops.
 */
export function RoutePanel({ legs, totalDistance, totalDuration, waypointOrder, onClose }: RoutePanelProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 80,
        left: 16,
        zIndex: MAP_Z_INDEX.controls,
        background: "var(--background, #fff)",
        borderRadius: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        width: 300,
        maxHeight: "50dvh",
        overflowY: "auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Route Plan</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            {totalDistance} · {totalDuration}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-tertiary)", padding: 4 }} aria-label="Close route panel">&times;</button>
      </div>

      {waypointOrder && (
        <div style={{ padding: "8px 16px", fontSize: 11, color: "var(--text-tertiary)", background: "var(--section-bg)", borderBottom: "1px solid var(--border)" }}>
          Route optimized for shortest travel time
        </div>
      )}

      <div style={{ padding: "8px 0" }}>
        {legs.map((leg, i) => (
          <div key={i} style={{ padding: "8px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              background: "var(--primary, #3b82f6)", color: "white",
              fontSize: 12, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {leg.start_address}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                {leg.distance_text} · {leg.duration_text}
              </div>
            </div>
          </div>
        ))}
        {/* Final destination */}
        {legs.length > 0 && (
          <div style={{ padding: "8px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              background: "var(--success-text, #059669)", color: "white",
              fontSize: 12, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              &#x2713;
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {legs[legs.length - 1].end_address}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
