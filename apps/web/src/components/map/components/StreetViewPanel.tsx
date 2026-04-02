"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

interface StreetViewCoords {
  lat: number;
  lng: number;
  address?: string;
}

interface StreetViewPanelProps {
  coords: StreetViewCoords;
  onClose: () => void;
  /** Called when panorama position changes (for cone marker on map) */
  onPositionChange?: (lat: number, lng: number) => void;
  /** Called when panorama heading changes (for cone rotation) */
  onHeadingChange?: (heading: number) => void;
}

type ViewMode = "split" | "fullscreen";

/**
 * Street View Panel — Google Maps-inspired redesign.
 *
 * Split mode: 50/50 side-by-side (map left, street view right) on desktop,
 *             60% height bottom panel on mobile.
 * Fullscreen: Takes over the entire viewport.
 *
 * Entry/exit feel instant — no intermediate states.
 */
export function StreetViewPanel({ coords, onClose, onPositionChange, onHeadingChange }: StreetViewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [mode, setMode] = useState<ViewMode>("split");
  const [currentAddress, setCurrentAddress] = useState(coords.address || "");
  const [heading, setHeading] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null); // null = loading

  // Initialize Street View panorama
  useEffect(() => {
    if (!containerRef.current) return;

    const panorama = new google.maps.StreetViewPanorama(containerRef.current, {
      position: { lat: coords.lat, lng: coords.lng },
      pov: { heading: 0, pitch: 0 },
      zoom: 1,
      addressControl: true,
      showRoadLabels: true,
      linksControl: true,
      fullscreenControl: false,
      enableCloseButton: false,
      motionTracking: false,
    });
    panoramaRef.current = panorama;

    // Check coverage
    const service = new google.maps.StreetViewService();
    service.getPanorama({ location: { lat: coords.lat, lng: coords.lng }, radius: 100 }, (data, status) => {
      setAvailable(status === google.maps.StreetViewStatus.OK);
    });

    // Track heading for cone marker
    let raf: number | null = null;
    panorama.addListener("pov_changed", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const h = panorama.getPov().heading;
        setHeading(h);
        onHeadingChange?.(h);
      });
    });

    // Track position for cone marker + address updates
    panorama.addListener("position_changed", () => {
      const pos = panorama.getPosition();
      if (pos) {
        onPositionChange?.(pos.lat(), pos.lng());
        // Reverse geocode for address bar
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat: pos.lat(), lng: pos.lng() } }, (results, geoStatus) => {
          if (geoStatus === "OK" && results?.[0]) {
            setCurrentAddress(results[0].formatted_address);
          }
        });
      }
    });

    return () => {
      google.maps.event.clearInstanceListeners(panorama);
      panoramaRef.current = null;
    };
  }, [coords.lat, coords.lng]); // Only re-init when coords change

  // Keyboard: Escape exits
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode === "fullscreen") setMode("split");
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, onClose]);

  const compassDirection = getCompassDirection(heading);

  const googleMapsUrl = `https://www.google.com/maps/@${coords.lat},${coords.lng},3a,75y,${Math.round(heading)}h,90t/data=!3m4!1e1!3m2!1s!2e0`;

  if (mode === "fullscreen") {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: MAP_Z_INDEX.streetViewFullscreen,
        background: "#000", display: "flex", flexDirection: "column",
      }}>
        <StreetViewHeader
          address={currentAddress}
          coords={coords}
          compassDirection={compassDirection}
          heading={heading}
          googleMapsUrl={googleMapsUrl}
          mode="fullscreen"
          onModeChange={() => setMode("split")}
          onClose={onClose}
        />
        <div ref={containerRef} style={{ flex: 1 }} />
      </div>
    );
  }

  // Split mode
  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0,
      width: "50%",
      zIndex: MAP_Z_INDEX.panel,
      background: "#000",
      display: "flex", flexDirection: "column",
      borderLeft: "2px solid var(--border, #374151)",
      animation: "sv-slide-in 0.2s ease-out",
    }}>
      <style>{`
        @keyframes sv-slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @media (max-width: 768px) {
          .sv-split-panel { width: 100% !important; top: 40% !important; border-left: none !important; border-top: 2px solid var(--border, #374151) !important; }
        }
      `}</style>
      <StreetViewHeader
        address={currentAddress}
        coords={coords}
        compassDirection={compassDirection}
        heading={heading}
        googleMapsUrl={googleMapsUrl}
        mode="split"
        onModeChange={() => setMode("fullscreen")}
        onClose={onClose}
      />
      {available === false && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          color: "#9ca3af", gap: 8, padding: 24, textAlign: "center",
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3" /><path d="M12 8v4" /><path d="M6.5 17.5C6.5 15 9 13 12 13s5.5 2 5.5 4.5" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No Street View coverage</div>
          <div style={{ fontSize: 13 }}>Google Street View imagery is not available at this location.</div>
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: "#93c5fd", fontSize: 13, marginTop: 4 }}>
            Try in Google Maps
          </a>
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, display: available === false ? "none" : "block" }} />
    </div>
  );
}

// ── Header bar ─────────────────────────────────────────────────────────────

function StreetViewHeader({
  address, coords, compassDirection, heading, googleMapsUrl, mode, onModeChange, onClose,
}: {
  address: string;
  coords: StreetViewCoords;
  compassDirection: string;
  heading: number;
  googleMapsUrl: string;
  mode: ViewMode;
  onModeChange: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 12px", background: "#111827", color: "white", fontSize: 13,
      flexShrink: 0, gap: 8, minHeight: 40,
    }}>
      {/* Left: Pegman icon + address */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="5" r="3" /><path d="M12 8v4" /><path d="M6.5 17.5C6.5 15 9 13 12 13s5.5 2 5.5 4.5" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 500 }}>
          {address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`}
        </span>
      </div>

      {/* Center: Compass */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, color: "#9ca3af", fontSize: 11 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: `rotate(${-heading}deg)`, transition: "transform 0.3s" }}>
          <polygon points="12 2, 15 10, 12 8, 9 10" fill="#ef4444" stroke="none" />
          <polygon points="12 22, 9 14, 12 16, 15 14" fill="#94a3b8" stroke="none" />
        </svg>
        <span>{compassDirection}</span>
      </div>

      {/* Right: Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer"
          style={{ color: "#93c5fd", fontSize: 12, textDecoration: "none", padding: "4px 8px", borderRadius: 4 }}
          title="Open in Google Maps"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
        <button onClick={onModeChange} title={mode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
          style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", padding: "4px", display: "flex" }}>
          {mode === "fullscreen" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
        <button onClick={onClose} title="Close Street View (Esc)"
          style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", padding: "4px", fontSize: 18, lineHeight: 1, display: "flex" }}>
          &#x2715;
        </button>
      </div>
    </div>
  );
}

// ── Compass helper ─────────────────────────────────────────────────────────

function getCompassDirection(heading: number): string {
  const normalized = ((heading % 360) + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(normalized / 45) % 8];
}
