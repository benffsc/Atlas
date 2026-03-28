"use client";

import React from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PinStyle = "disease" | "watch_list" | "active" | "active_requests" | "has_history" | "minimal";
type PinTier = "active" | "reference";

interface AtlasPinMarkerProps {
  pinStyle?: PinStyle;
  pinTier?: PinTier;
  color: string;
  catCount?: number;
  activeRequestCount?: number;
  diseaseCount?: number;
  needsTrapper?: boolean;
  hasVolunteer?: boolean;
  diseaseBadges?: Array<{ short_code: string; color: string }>;
  isSelected?: boolean;
  zoomLevel?: number; // quantized to bands: 8, 11, 14, 16
  title?: string;     // native tooltip (address)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_BADGES: Array<{ short_code: string; color: string }> = [];

// Status dot colors — priority cascade
const STATUS_DOT_RED = "#dc2626";
const STATUS_DOT_ORANGE = "#f97316";
const STATUS_DOT_VIOLET = "#7c3aed";

// ---------------------------------------------------------------------------
// Size computation (exported for legend use)
// ---------------------------------------------------------------------------

export function computePinSize(
  pinTier: PinTier,
  catCount: number,
  diseaseCount: number,
  activeRequestCount: number,
): number {
  if (pinTier === "reference") return 14;
  if (catCount >= 10 || diseaseCount >= 2 || activeRequestCount >= 2) return 40;
  if (catCount >= 1) return 32;
  return 24;
}

// ---------------------------------------------------------------------------
// Reference pin (simple circle div — cheap to render)
// ---------------------------------------------------------------------------

function ReferencePinInner({
  color,
  isSelected,
  zoomLevel,
  title,
}: {
  color: string;
  isSelected: boolean;
  zoomLevel: number;
  title?: string;
}) {
  // Reference pins hidden at zoom < 11 (handled by parent, but just in case)
  const opacity = zoomLevel >= 16 ? 0.8 : zoomLevel >= 14 ? 0.65 : 0.5;

  return (
    <div
      title={title}
      className="atlas-pin-ref"
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: color,
        border: "2px solid white",
        opacity,
        cursor: "pointer",
        transition: "transform 0.12s ease, box-shadow 0.12s ease",
        transform: isSelected ? "scale(1.25)" : undefined,
        boxShadow: isSelected
          ? `0 0 0 3px #facc15, 0 1px 3px rgba(0,0,0,0.3)`
          : "0 1px 3px rgba(0,0,0,0.3)",
      }}
    />
  );
}

const ReferencePin = React.memo(ReferencePinInner);

// ---------------------------------------------------------------------------
// Active pin (teardrop SVG with status dot + zoom-aware content)
// ---------------------------------------------------------------------------

function ActivePinInner({
  color,
  pinStyle = "minimal",
  catCount = 0,
  diseaseCount = 0,
  needsTrapper = false,
  hasVolunteer = false,
  diseaseBadges = EMPTY_BADGES,
  isSelected = false,
  zoomLevel = 11,
  size,
  title,
}: {
  color: string;
  pinStyle: PinStyle;
  catCount: number;
  diseaseCount: number;
  needsTrapper: boolean;
  hasVolunteer: boolean;
  diseaseBadges: Array<{ short_code: string; color: string }>;
  isSelected: boolean;
  zoomLevel: number;
  size: number;
  title?: string;
}) {
  // ── Status dot (single, priority cascade) ──
  // Only at zoom >= 11
  let statusDotColor: string | null = null;
  if (zoomLevel >= 11) {
    if (diseaseCount > 0) statusDotColor = STATUS_DOT_RED;
    else if (needsTrapper) statusDotColor = STATUS_DOT_ORANGE;
    else if (hasVolunteer) statusDotColor = STATUS_DOT_VIOLET;
  }

  // ── Inner content by zoom level ──
  let innerContent: React.ReactNode;

  if (zoomLevel < 11) {
    // Zoom < 11: color-filled teardrop only, no inner content
    innerContent = null;
  } else if (zoomLevel >= 16 && diseaseBadges.length > 0) {
    // Zoom 16+: disease code bar below (up to 3 codes as text)
    const codes = diseaseBadges.slice(0, 3).map(b => b.short_code).join(" ");
    innerContent = (
      <>
        <circle cx="12" cy="10" r="5" fill="white" />
        {catCount > 0 ? (
          <text x="12" y="12.5" textAnchor="middle" fill={color} fontSize="7" fontWeight="bold" fontFamily="system-ui">
            {catCount > 99 ? "99" : catCount}
          </text>
        ) : (
          <circle cx="12" cy="10" r="2" fill={color} />
        )}
        {/* Disease code bar below pin */}
        <rect x={12 - (codes.length * 2.2)} y="27" width={codes.length * 4.4} height="7" rx="2" fill="rgba(0,0,0,0.7)" />
        <text x="12" y="32.5" textAnchor="middle" fill="white" fontSize="4.5" fontWeight="bold" fontFamily="system-ui" letterSpacing="0.5">
          {codes}
        </text>
      </>
    );
  } else if (zoomLevel >= 14 && catCount > 0) {
    // Zoom 14-15: white center + cat count number
    innerContent = (
      <>
        <circle cx="12" cy="10" r="5" fill="white" />
        <text x="12" y="12.5" textAnchor="middle" fill={color} fontSize="7" fontWeight="bold" fontFamily="system-ui">
          {catCount > 99 ? "99" : catCount}
        </text>
      </>
    );
  } else {
    // Zoom 11-13: white center + colored dot center
    innerContent = (
      <>
        <circle cx="12" cy="10" r="5" fill="white" />
        <circle cx="12" cy="10" r="2.5" fill={color} />
      </>
    );
  }

  // ViewBox — extend slightly if disease bar shown at zoom 16+
  const hasCodeBar = zoomLevel >= 16 && diseaseBadges.length > 0;
  const viewBoxBottom = hasCodeBar ? 38 : 32;
  const viewBoxHeight = viewBoxBottom;
  const svgHeight = Math.round(size * 1.35 * (viewBoxHeight / 32));

  // At zoom < 11: no white center, just filled teardrop
  const showInnerCircle = zoomLevel >= 11;

  return (
    <div
      title={title}
      className="atlas-pin-active"
      style={{
        cursor: "pointer",
        transition: "transform 0.12s ease",
        transform: isSelected ? "scale(1.25)" : undefined,
        filter: isSelected
          ? "drop-shadow(0 0 4px #facc15) drop-shadow(0 2px 1.5px rgba(0,0,0,0.35))"
          : "drop-shadow(0 2px 1.5px rgba(0,0,0,0.35))",
      }}
    >
      <svg
        width={size}
        height={svgHeight}
        viewBox={`0 0 24 ${viewBoxHeight}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Ground shadow */}
        <ellipse cx="12" cy="30" rx="5" ry="2" fill="rgba(0,0,0,0.2)" />
        {/* Pin body */}
        <path
          fill={color}
          stroke="#fff"
          strokeWidth="1.5"
          d="M12 0C6.5 0 2 4.5 2 10c0 7 10 20 10 20s10-13 10-20c0-5.5-4.5-10-10-10z"
        />
        {/* Inner content (zoom-aware) */}
        {showInnerCircle && innerContent}
        {/* Status indicator dot (bottom-right of teardrop) */}
        {statusDotColor && (
          <circle cx="19" cy="16" r="4" fill={statusDotColor} stroke="white" strokeWidth="1.5" />
        )}
      </svg>
    </div>
  );
}

const ActivePin = React.memo(ActivePinInner);

// ---------------------------------------------------------------------------
// Main export — delegates to ActivePin or ReferencePin
// ---------------------------------------------------------------------------

function AtlasPinMarkerInner({
  color,
  pinStyle = "minimal",
  pinTier = "active",
  catCount = 0,
  activeRequestCount = 0,
  diseaseCount = 0,
  needsTrapper = false,
  hasVolunteer = false,
  diseaseBadges = EMPTY_BADGES,
  isSelected = false,
  zoomLevel = 11,
  title,
}: AtlasPinMarkerProps) {
  if (pinTier === "reference") {
    return (
      <ReferencePin
        color={color}
        isSelected={isSelected}
        zoomLevel={zoomLevel}
        title={title}
      />
    );
  }

  const size = computePinSize(pinTier, catCount, diseaseCount, activeRequestCount);

  return (
    <ActivePin
      color={color}
      pinStyle={pinStyle}
      catCount={catCount}
      diseaseCount={diseaseCount}
      needsTrapper={needsTrapper}
      hasVolunteer={hasVolunteer}
      diseaseBadges={diseaseBadges}
      isSelected={isSelected}
      zoomLevel={zoomLevel}
      size={size}
      title={title}
    />
  );
}

export const AtlasPinMarker = React.memo(AtlasPinMarkerInner);
