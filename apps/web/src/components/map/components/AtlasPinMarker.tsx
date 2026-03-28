"use client";

import React from "react";

interface AtlasPinMarkerProps {
  color: string;
  pinStyle?: "disease" | "watch_list" | "active" | "active_requests" | "has_history" | "minimal";
  isClustered?: boolean;
  unitCount?: number;
  catCount?: number;
  hasVolunteer?: boolean;
  needsTrapper?: boolean;
  diseaseBadges?: Array<{ short_code: string; color: string }>;
  isSelected?: boolean;
  isReference?: boolean;
  size?: number;
}

// Shared SVG defs injected once into the page via CSS drop-shadow instead of per-instance SVG filters.
// Gradient is replaced with a simple fill + lighter stroke for performance.

const EMPTY_BADGES: Array<{ short_code: string; color: string }> = [];

function AtlasPinMarkerInner({
  color,
  pinStyle = "minimal",
  isClustered = false,
  unitCount = 1,
  catCount = 0,
  hasVolunteer = false,
  needsTrapper = false,
  diseaseBadges = EMPTY_BADGES,
  isSelected = false,
  isReference = false,
  size = 32,
}: AtlasPinMarkerProps) {
  // Inner icon by status
  let innerContent: React.ReactNode;
  if (isClustered && unitCount > 1) {
    innerContent = (
      <>
        <rect x="8" y="12" width="8" height="6" fill={color} rx="1" />
        <text x="12" y="9" textAnchor="middle" fill={color} fontSize="6" fontWeight="bold" fontFamily="system-ui">{unitCount}</text>
      </>
    );
  } else if (pinStyle === "disease") {
    innerContent = (
      <>
        <path d="M12 6 L16 14 H8 Z" fill={color} stroke="white" strokeWidth="0.5" />
        <text x="12" y="13" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">!</text>
      </>
    );
  } else if (pinStyle === "watch_list") {
    innerContent = (
      <>
        <ellipse cx="12" cy="10" rx="4" ry="2.5" fill="none" stroke={color} strokeWidth="1.5" />
        <circle cx="12" cy="10" r="1.5" fill={color} />
      </>
    );
  } else if (pinStyle === "active" && catCount > 0) {
    innerContent = (
      <>
        <circle cx="12" cy="10" r="4" fill={color} />
        <text x="12" y="12.5" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="system-ui">
          {catCount > 9 ? "9+" : catCount}
        </text>
      </>
    );
  } else if (pinStyle === "active_requests") {
    innerContent = (
      <>
        <rect x="9" y="7" width="6" height="7" fill="none" stroke={color} strokeWidth="1.2" rx="0.5" />
        <line x1="10.5" y1="9.5" x2="13.5" y2="9.5" stroke={color} strokeWidth="0.8" />
        <line x1="10.5" y1="11.5" x2="13.5" y2="11.5" stroke={color} strokeWidth="0.8" />
      </>
    );
  } else if (pinStyle === "has_history") {
    innerContent = (
      <>
        <rect x="9" y="6" width="6" height="8" fill={color} rx="1" />
        <line x1="10" y1="8" x2="14" y2="8" stroke="white" strokeWidth="0.8" />
        <line x1="10" y1="10" x2="14" y2="10" stroke="white" strokeWidth="0.8" />
        <line x1="10" y1="12" x2="12" y2="12" stroke="white" strokeWidth="0.8" />
      </>
    );
  } else {
    innerContent = <circle cx="12" cy="10" r="3" fill={color} />;
  }

  // Badges
  const maxBadges = 3;
  const visibleBadges = diseaseBadges.slice(0, maxBadges);
  const overflowCount = diseaseBadges.length - maxBadges;
  const hasDiseaseBadges = diseaseBadges.length > 0;
  const badgeRadius = 4.5;
  const badgeSpacing = 10;
  const badgeStartX = 12 - ((Math.min(diseaseBadges.length, maxBadges + (overflowCount > 0 ? 1 : 0)) - 1) * badgeSpacing) / 2;
  const badgeY = 27;

  // ViewBox
  const viewBoxTop = (hasVolunteer || needsTrapper) ? -7 : 0;
  const viewBoxBottom = hasDiseaseBadges ? 35 : 32;
  const viewBoxTotalHeight = viewBoxBottom - viewBoxTop;
  const heightScale = viewBoxTotalHeight / 32;
  const svgHeight = Math.round(size * 1.35 * heightScale);

  const finalSize = isReference ? size * 0.8 : size;
  const finalSvgHeight = isReference ? Math.round(svgHeight * 0.8) : svgHeight;

  return (
    <div
      style={{
        opacity: isReference ? 0.65 : 1,
        transform: isSelected ? "scale(1.2)" : undefined,
        transition: "transform 0.15s ease",
        cursor: "pointer",
        // CSS drop-shadow is GPU-composited — far cheaper than per-instance SVG feDropShadow
        filter: isSelected
          ? "drop-shadow(0 0 4px #facc15) drop-shadow(0 2px 1.5px rgba(0,0,0,0.35))"
          : "drop-shadow(0 2px 1.5px rgba(0,0,0,0.35))",
      }}
    >
      <svg
        width={finalSize}
        height={finalSvgHeight}
        viewBox={`0 ${viewBoxTop} 24 ${viewBoxTotalHeight}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Ground shadow */}
        <ellipse cx="12" cy="30" rx="5" ry="2" fill="rgba(0,0,0,0.2)" />
        {/* Pin body — solid fill (no per-instance gradient/filter) */}
        <path
          fill={color}
          stroke="#fff"
          strokeWidth="1.5"
          d="M12 0C6.5 0 2 4.5 2 10c0 7 10 20 10 20s10-13 10-20c0-5.5-4.5-10-10-10z"
        />
        {/* Inner white circle */}
        <circle cx="12" cy="10" r="6" fill="white" />
        {/* Status icon */}
        {innerContent}
        {/* Volunteer/staff star badge (top-right) */}
        {hasVolunteer && (
          <g transform="translate(17, 0)">
            <circle cx="0" cy="0" r="5" fill="#7c3aed" stroke="white" strokeWidth="1" />
            <polygon
              points="0,-3.2 1.2,-1 3.4,-1 1.6,0.6 2.4,3 0,1.6 -2.4,3 -1.6,0.6 -3.4,-1 -1.2,-1"
              fill="white"
              transform="scale(0.7)"
            />
          </g>
        )}
        {/* Needs trapper badge (top-left) */}
        {needsTrapper && (
          <g transform="translate(7, 0)">
            <circle cx="0" cy="0" r="5" fill="#f97316" stroke="white" strokeWidth="1" />
            <text x="0" y="3" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="system-ui">T</text>
          </g>
        )}
        {/* Disease sub-badges (bottom row) */}
        {visibleBadges.map((b, i) => (
          <g key={i}>
            <circle cx={badgeStartX + i * badgeSpacing} cy={badgeY} r={badgeRadius} fill={b.color} stroke="white" strokeWidth="1" />
            <text x={badgeStartX + i * badgeSpacing} y={badgeY + 2.5} textAnchor="middle" fill="white" fontSize="5.5" fontWeight="bold" fontFamily="system-ui">
              {b.short_code}
            </text>
          </g>
        ))}
        {overflowCount > 0 && (
          <g>
            <circle cx={badgeStartX + maxBadges * badgeSpacing} cy={badgeY} r={badgeRadius} fill="#6b7280" stroke="white" strokeWidth="1" />
            <text x={badgeStartX + maxBadges * badgeSpacing} y={badgeY + 2.5} textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="system-ui">
              +{overflowCount}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// React.memo prevents re-rendering when props haven't changed.
// Without this, every click/pan/zoom re-renders ALL pin components.
export const AtlasPinMarker = React.memo(AtlasPinMarkerInner);
