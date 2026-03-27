"use client";

/**
 * MapLegend - Legend panel for Atlas Map
 *
 * Shows pin styles, badges, and disease codes with visual indicators.
 * Can be toggled open/closed.
 */

import { generateLegendPinSvg } from "@/lib/map-markers";
import { MAP_Z_INDEX } from "@/lib/design-tokens";
import { MAP_COLORS } from "@/lib/map-colors";

interface MapLegendProps {
  showLegend: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  colors?: typeof MAP_COLORS;
}

const ACTIVE_PINS = [
  { color: MAP_COLORS.pinStyle.disease, label: "Disease Risk", pinStyle: "disease" },
  { color: MAP_COLORS.pinStyle.watch_list, label: "Watch List", pinStyle: "watch_list" },
  { color: MAP_COLORS.pinStyle.active, label: "Verified Cats", pinStyle: "active" },
  { color: MAP_COLORS.pinStyle.active_requests, label: "Requests Only", pinStyle: "active_requests" },
];

const REFERENCE_PINS = [
  { color: MAP_COLORS.pinStyle.has_history, label: "History Only", pinStyle: "has_history" },
  { color: MAP_COLORS.pinStyle.minimal, label: "Minimal Data", pinStyle: "minimal" },
];

const DEFAULT_DISEASE_BADGES = [
  { colorKey: "felv" as const, code: "F", label: "FeLV", fallback: MAP_COLORS.disease.felv },
  { colorKey: "fiv" as const, code: "V", label: "FIV", fallback: MAP_COLORS.disease.fiv },
  { colorKey: "ringworm" as const, code: "R", label: "Ringworm", fallback: MAP_COLORS.disease.ringworm },
  { colorKey: "heartworm" as const, code: "H", label: "Heartworm", fallback: MAP_COLORS.disease.heartworm },
  { colorKey: "panleukopenia" as const, code: "P", label: "Panleukopenia", fallback: MAP_COLORS.disease.panleukopenia },
];

export function MapLegend({ showLegend, onToggle, isMobile, colors }: MapLegendProps) {
  const diseaseBadges = DEFAULT_DISEASE_BADGES.map((badge) => ({
    color: colors?.disease?.[badge.colorKey] ?? badge.fallback,
    code: badge.code,
    label: badge.label,
  }));
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
          {/* Active Pins */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--text-tertiary)",
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
              color: "var(--text-tertiary)",
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
              color: "var(--text-tertiary)",
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
                background: MAP_COLORS.volunteerRoles.coordinator,
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
                background: MAP_COLORS.priority.high,
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
              color: "var(--text-tertiary)",
              marginTop: 8,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Disease Badges
          </div>
          {diseaseBadges.map(({ color, code, label }) => (
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
