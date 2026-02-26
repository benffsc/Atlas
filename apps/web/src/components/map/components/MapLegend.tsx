"use client";

/**
 * MapLegend - Legend panel for Atlas Map
 *
 * Shows pin styles, badges, and disease codes with visual indicators.
 * Can be toggled open/closed.
 */

import { generateLegendPinSvg } from "@/lib/map-markers";

interface MapLegendProps {
  showLegend: boolean;
  onToggle: () => void;
  isMobile?: boolean;
}

const ACTIVE_PINS = [
  { color: "#ea580c", label: "Disease Risk", pinStyle: "disease" },
  { color: "#8b5cf6", label: "Watch List", pinStyle: "watch_list" },
  { color: "#22c55e", label: "Verified Cats", pinStyle: "active" },
  { color: "#14b8a6", label: "Requests Only", pinStyle: "active_requests" },
];

const REFERENCE_PINS = [
  { color: "#6366f1", label: "History Only", pinStyle: "has_history" },
  { color: "#94a3b8", label: "Minimal Data", pinStyle: "minimal" },
];

const DISEASE_BADGES = [
  { color: "#dc2626", code: "F", label: "FeLV" },
  { color: "#ea580c", code: "V", label: "FIV" },
  { color: "#ca8a04", code: "R", label: "Ringworm" },
  { color: "#7c3aed", code: "H", label: "Heartworm" },
  { color: "#be185d", code: "P", label: "Panleukopenia" },
];

export function MapLegend({ showLegend, onToggle, isMobile }: MapLegendProps) {
  return (
    <div
      className="map-legend"
      style={{
        position: "absolute",
        bottom: 24,
        left: 16,
        zIndex: 1002,
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
          {/* Active Pins */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#9ca3af",
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Active Pins
          </div>
          {ACTIVE_PINS.map(({ color, label, pinStyle }) => (
            <div key={label} className="map-legend-item">
              <span
                dangerouslySetInnerHTML={{
                  __html: generateLegendPinSvg(color, pinStyle, 14),
                }}
                style={{
                  display: "inline-flex",
                  width: 14,
                  height: 19,
                  flexShrink: 0,
                }}
              />
              <span className="map-legend-label">{label}</span>
            </div>
          ))}

          {/* Reference Pins */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#9ca3af",
              marginTop: 8,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Reference Pins
          </div>
          {REFERENCE_PINS.map(({ color, label, pinStyle }) => (
            <div key={label} className="map-legend-item">
              <span
                dangerouslySetInnerHTML={{
                  __html: generateLegendPinSvg(color, pinStyle, 12),
                }}
                style={{
                  display: "inline-flex",
                  width: 12,
                  height: 16,
                  flexShrink: 0,
                  opacity: 0.65,
                }}
              />
              <span className="map-legend-label">{label}</span>
            </div>
          ))}

          {/* Pin Badges */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#9ca3af",
              marginTop: 8,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Pin Badges
          </div>
          <div className="map-legend-item">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#7c3aed",
                flexShrink: 0,
              }}
            >
              <svg width="8" height="8" viewBox="-3.5 -3.5 7 7">
                <polygon
                  points="0,-3.2 1.2,-1 3.4,-1 1.6,0.6 2.4,3 0,1.6 -2.4,3 -1.6,0.6 -3.4,-1 -1.2,-1"
                  fill="white"
                  transform="scale(0.7)"
                />
              </svg>
            </span>
            <span className="map-legend-label">Volunteer / Staff</span>
          </div>
          <div className="map-legend-item">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#f97316",
                flexShrink: 0,
                color: "white",
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              T
            </span>
            <span className="map-legend-label">Needs Trapper</span>
          </div>

          {/* Disease Badges */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#9ca3af",
              marginTop: 8,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Disease Badges
          </div>
          {DISEASE_BADGES.map(({ color, code, label }) => (
            <div key={code} className="map-legend-item">
              <span
                className="map-legend-swatch"
                style={{
                  background: color,
                  borderRadius: "50%",
                  width: 14,
                  height: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontSize: 8,
                  fontWeight: 700,
                }}
              >
                {code}
              </span>
              <span className="map-legend-label">{label}</span>
            </div>
          ))}

          {/* Keyboard shortcut hint */}
          {!isMobile && (
            <div
              style={{
                borderTop: "1px solid #e5e7eb",
                marginTop: 8,
                paddingTop: 6,
                fontSize: 10,
                color: "#9ca3af",
              }}
            >
              <kbd
                style={{
                  background: "#f3f4f6",
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
