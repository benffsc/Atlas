"use client";

/**
 * MapLegend - Legend panel for Atlas Map V2
 *
 * Shows the new pin system: shape by tier (teardrop vs circle),
 * size tiers, color by status, and single status dot indicator.
 */

import { MAP_Z_INDEX } from "@/lib/design-tokens";
import { MAP_COLORS } from "@/lib/map-colors";

interface MapLegendProps {
  showLegend: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  colors?: typeof MAP_COLORS;
}

const PIN_COLORS = [
  { color: MAP_COLORS.pinStyle.disease, label: "Disease Risk" },
  { color: MAP_COLORS.pinStyle.watch_list, label: "Watch List" },
  { color: MAP_COLORS.pinStyle.active, label: "Verified Cats" },
  { color: MAP_COLORS.pinStyle.active_requests, label: "Requests Only" },
  { color: MAP_COLORS.pinStyle.has_history, label: "History Only" },
  { color: MAP_COLORS.pinStyle.minimal, label: "Minimal Data" },
];

const SIZE_TIERS = [
  { size: 40, label: "Hot Spot", detail: "10+ cats / 2+ disease / 2+ requests" },
  { size: 32, label: "Active", detail: "1+ cats" },
  { size: 24, label: "Pending", detail: "Requests only" },
  { size: 14, label: "Reference", detail: "History / minimal (circle)" },
];

const STATUS_DOTS = [
  { color: "#dc2626", label: "Disease at location" },
  { color: "#f97316", label: "Needs trapper" },
  { color: "#7c3aed", label: "Has volunteer / staff" },
];

/** Small teardrop SVG for legend use */
function LegendTeardrop({ color, size }: { color: string; size: number }) {
  const h = Math.round(size * 1.35);
  return (
    <svg width={size} height={h} viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
      <path
        fill={color}
        stroke="#fff"
        strokeWidth="1.5"
        d="M12 0C6.5 0 2 4.5 2 10c0 7 10 20 10 20s10-13 10-20c0-5.5-4.5-10-10-10z"
      />
      <circle cx="12" cy="10" r="5" fill="white" />
      <circle cx="12" cy="10" r="2.5" fill={color} />
    </svg>
  );
}

const sectionTitleStyle = {
  fontSize: 10,
  fontWeight: 600 as const,
  color: "var(--text-tertiary)",
  marginBottom: 4,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
};

const sectionGapStyle = { marginTop: 8 };

export function MapLegend({ showLegend, onToggle, isMobile }: MapLegendProps) {
  return (
    <div
      className="map-legend"
      style={{
        position: "absolute",
        bottom: 24,
        left: 16,
        zIndex: MAP_Z_INDEX.legend,
      }}
    >
      <button
        onClick={onToggle}
        className="map-legend-toggle"
        title="Toggle legend"
      >
        {showLegend ? "Legend \u25BC" : "?"}
      </button>

      {showLegend && (
        <div className="map-legend-panel">
          {/* ── Color = Status ── */}
          <div style={sectionTitleStyle}>Color = Status</div>
          {PIN_COLORS.map(({ color, label }) => (
            <div key={label} className="map-legend-item">
              <span style={{ display: "inline-flex", width: 14, height: 19, flexShrink: 0 }}>
                <LegendTeardrop color={color} size={14} />
              </span>
              <span className="map-legend-label">{label}</span>
            </div>
          ))}

          {/* ── Size = Magnitude ── */}
          <div style={{ ...sectionTitleStyle, ...sectionGapStyle }}>Size = Magnitude</div>
          {SIZE_TIERS.map(({ size, label, detail }) => (
            <div key={label} className="map-legend-item" style={{ alignItems: "center" }}>
              {size === 14 ? (
                /* Reference tier: circle */
                <span style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: MAP_COLORS.pinStyle.minimal,
                  border: "2px solid white",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                  opacity: 0.6,
                  flexShrink: 0,
                }} />
              ) : (
                <span style={{
                  display: "inline-flex",
                  width: Math.max(14, size * 0.4),
                  height: Math.round(Math.max(14, size * 0.4) * 1.35),
                  flexShrink: 0,
                }}>
                  <LegendTeardrop color={MAP_COLORS.pinStyle.active} size={Math.max(14, size * 0.4)} />
                </span>
              )}
              <span className="map-legend-label">
                <span style={{ fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: 9, color: "var(--text-tertiary)", display: "block" }}>{detail}</span>
              </span>
            </div>
          ))}

          {/* ── Status Dot ── */}
          <div style={{ ...sectionTitleStyle, ...sectionGapStyle }}>Status Indicator</div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 4 }}>
            Single dot at bottom-right (zoom 11+)
          </div>
          {STATUS_DOTS.map(({ color, label }) => (
            <div key={label} className="map-legend-item">
              <span style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                border: "1.5px solid white",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.1)",
                flexShrink: 0,
                marginLeft: 3,
                marginRight: 3,
              }} />
              <span className="map-legend-label">{label}</span>
            </div>
          ))}

          {/* Keyboard shortcut hint */}
          {!isMobile && (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                marginTop: 8,
                paddingTop: 6,
                fontSize: 10,
                color: "var(--text-tertiary)",
              }}
            >
              <kbd
                style={{
                  background: "var(--bg-secondary)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  fontSize: 9,
                }}
              >
                K
              </kbd>{" "}
              toggle legend
            </div>
          )}
        </div>
      )}
    </div>
  );
}
