"use client";

/**
 * ShowcaseToolbar — minimal presenter indicator for showcase mode.
 *
 * Shows "Beacon · Live" pill at bottom-right with Walkthrough link
 * and Exit button. Demos are driven through Tippy's chat bubble
 * (ShowcaseTippyChat), not through this toolbar.
 */

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

interface ShowcaseToolbarProps {
  onExit: () => void;
}

export function ShowcaseToolbar({ onExit }: ShowcaseToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();

  // ESC exits showcase mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onExit]);

  const isOnDemo = pathname?.startsWith("/demo") || pathname?.startsWith("/walkthrough");
  const isOnMap = pathname === "/map";

  const startMapTour = useCallback(() => {
    if (isOnMap) {
      // Already on map — just dispatch the event
      window.dispatchEvent(new CustomEvent("showcase:maptour"));
    } else {
      // Navigate to map, then dispatch after a delay for load
      window.location.href = "/map";
      // The tour will be triggered by the map page detecting showcase mode
      // OR we store intent in sessionStorage and the map picks it up
      sessionStorage.setItem("showcase:maptour-pending", "1");
    }
    setExpanded(false);
  }, [isOnMap]);

  return (
    <div className="showcase-toolbar" role="toolbar" aria-label="Showcase controls">
      <button
        type="button"
        className="showcase-toolbar-pill"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="presentation-indicator-dot" aria-hidden="true" />
        <span>Beacon &middot; Live</span>
        <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>{expanded ? "\u25BC" : "\u25B2"}</span>
      </button>

      {expanded && (
        <div className="showcase-toolbar-panel">
          <div className="showcase-toolbar-section">
            <span className="showcase-toolbar-label">Demos</span>
            <button
              className="showcase-toolbar-btn"
              onClick={startMapTour}
            >
              Colony Tour
            </button>
            {!isOnDemo && (
              <a href="/walkthrough/" className="showcase-toolbar-btn">
                Guided Walkthrough
              </a>
            )}
          </div>
          <div className="showcase-toolbar-divider" />
          <button
            className="showcase-toolbar-btn showcase-toolbar-exit"
            onClick={onExit}
          >
            Exit Showcase
          </button>
        </div>
      )}
    </div>
  );
}
