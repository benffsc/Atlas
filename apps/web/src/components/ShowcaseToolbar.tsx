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
  const [tvTourActive, setTvTourActive] = useState(false);
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
      window.dispatchEvent(new CustomEvent("showcase:maptour"));
    } else {
      window.location.href = "/map";
      sessionStorage.setItem("showcase:maptour-pending", "1");
    }
    setExpanded(false);
  }, [isOnMap]);

  const toggleTvTour = useCallback(() => {
    if (tvTourActive) {
      // Stop: dispatch toggle to the ScreensaverTour on the map page
      window.dispatchEvent(new CustomEvent("screensaver:toggle"));
      setTvTourActive(false);
    } else {
      setTvTourActive(true);
      if (isOnMap) {
        window.dispatchEvent(new CustomEvent("screensaver:toggle"));
      } else {
        sessionStorage.setItem("screensaver:pending", "1");
        window.location.href = "/map";
      }
    }
    setExpanded(false);
  }, [isOnMap, tvTourActive]);

  // Sync with tour state changes
  useEffect(() => {
    const handler = () => setTvTourActive(false);
    // When tour stops externally (ESC, etc.)
    window.addEventListener("screensaver:stopped", handler);
    return () => window.removeEventListener("screensaver:stopped", handler);
  }, []);

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
              Map Tour
            </button>
            {!isOnDemo && (
              <a href="/walkthrough/" className="showcase-toolbar-btn">
                Informational Deck
              </a>
            )}
          </div>
          <div className="showcase-toolbar-divider" />
          <div className="showcase-toolbar-section">
            <span className="showcase-toolbar-label">Loop</span>
            <button
              className={`showcase-toolbar-btn ${tvTourActive ? "showcase-toolbar-btn--active" : ""}`}
              onClick={toggleTvTour}
            >
              {tvTourActive ? "Stop Loop" : "TV Screensaver"}
            </button>
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
