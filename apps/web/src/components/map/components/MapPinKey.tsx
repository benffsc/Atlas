"use client";

/**
 * MapPinKey — Always-visible collapsible pin legend for the atlas map.
 *
 * Shows the 4-color palette, 3 status dots, and 3 size tiers.
 * Starts collapsed (small "?" pill). Expands on click.
 * Derived from admin-configurable MapPinConfig for white-label support.
 */

import { useState } from "react";
import { MAP_Z_INDEX } from "@/lib/design-tokens";
import type { MapPinConfig } from "@/components/map/types";

interface MapPinKeyProps {
  pinConfig: MapPinConfig;
  isMobile?: boolean;
}

/** Small teardrop SVG for key use */
function KeyTeardrop({ color, size }: { color: string; size: number }) {
  const h = Math.round(size * 1.35);
  return (
    <svg width={size} height={h} viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
      <path
        fill={color}
        stroke="#fff"
        strokeWidth="1.5"
        d="M12 0C6.5 0 2 4.5 2 10c0 7 10 20 10 20s10-13 10-20c0-5.5-4.5-10-10-10z"
      />
      <circle cx="12" cy="10" r="4" fill="white" />
      <circle cx="12" cy="10" r="2" fill={color} />
    </svg>
  );
}

function KeyCircle({ color, size }: { color: string; size: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: "2px solid white",
        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        opacity: 0.6,
        flexShrink: 0,
      }}
    />
  );
}

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-tertiary)",
  marginBottom: 3,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const ITEM_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "1.5px 0",
};

const ITEM_LABEL: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  lineHeight: 1.3,
};

export function MapPinKey({ pinConfig, isMobile }: MapPinKeyProps) {
  const [expanded, setExpanded] = useState(false);

  if (isMobile) return null;

  const c = pinConfig.colors;
  const l = pinConfig.labels;
  const s = pinConfig.statusDots;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 80,
        left: 16,
        zIndex: MAP_Z_INDEX.legend,
      }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          background: "var(--background)",
          border: "none",
          borderRadius: expanded ? "8px 8px 0 0" : 8,
          boxShadow: "var(--shadow-sm)",
          padding: "5px 10px",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--text-secondary)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {expanded ? "Pin Key ▾" : "?"}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div
          style={{
            background: "var(--background)",
            borderRadius: "0 8px 8px 8px",
            boxShadow: "var(--shadow-sm)",
            padding: "8px 12px 10px",
            minWidth: 160,
          }}
        >
          {/* Color = Status */}
          <div style={SECTION_TITLE}>Color</div>
          <div style={ITEM_ROW}>
            <KeyTeardrop color={c.disease || "#dc2626"} size={12} />
            <span style={ITEM_LABEL}>{l.disease || "Disease Risk"}</span>
          </div>
          <div style={ITEM_ROW}>
            <KeyTeardrop color={c.watch_list || "#d97706"} size={12} />
            <span style={ITEM_LABEL}>{l.watch_list || "Watch List"}</span>
          </div>
          <div style={ITEM_ROW}>
            <KeyTeardrop color={c.active || "#3b82f6"} size={12} />
            <span style={ITEM_LABEL}>{l.active || "Active"}</span>
          </div>
          <div style={ITEM_ROW}>
            <KeyCircle color={c.reference || "#94a3b8"} size={12} />
            <span style={ITEM_LABEL}>{l.reference || "Reference"}</span>
          </div>

          {/* Status dots */}
          <div style={{ ...SECTION_TITLE, marginTop: 6 }}>Status Dot</div>
          <div style={ITEM_ROW}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.disease || "#dc2626", border: "1.5px solid white", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.15)", flexShrink: 0 }} />
            <span style={ITEM_LABEL}>Disease</span>
          </div>
          <div style={ITEM_ROW}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.needs_trapper || "#f97316", border: "1.5px solid white", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.15)", flexShrink: 0 }} />
            <span style={ITEM_LABEL}>Needs trapper</span>
          </div>
          <div style={ITEM_ROW}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.has_volunteer || "#7c3aed", border: "1.5px solid white", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.15)", flexShrink: 0 }} />
            <span style={ITEM_LABEL}>Volunteer / staff</span>
          </div>

          {/* Size */}
          <div style={{ ...SECTION_TITLE, marginTop: 6 }}>Size</div>
          <div style={ITEM_ROW}>
            <KeyTeardrop color="#94a3b8" size={14} />
            <span style={ITEM_LABEL}>Hotspot (10+ cats)</span>
          </div>
          <div style={ITEM_ROW}>
            <KeyTeardrop color="#94a3b8" size={10} />
            <span style={ITEM_LABEL}>Active</span>
          </div>
          <div style={ITEM_ROW}>
            <KeyCircle color="#94a3b8" size={8} />
            <span style={ITEM_LABEL}>Reference</span>
          </div>
        </div>
      )}
    </div>
  );
}
