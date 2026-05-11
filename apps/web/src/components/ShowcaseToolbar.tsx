"use client";

/**
 * ShowcaseToolbar — minimal presenter indicator for showcase mode.
 *
 * Shows "Beacon · Live" pill at bottom-right with Walkthrough link
 * and Exit button. Demos are driven through Tippy's chat bubble
 * (ShowcaseTippyChat), not through this toolbar.
 */

import { useEffect, useState } from "react";

interface ShowcaseToolbarProps {
  onExit: () => void;
}

export function ShowcaseToolbar({ onExit }: ShowcaseToolbarProps) {
  const [expanded, setExpanded] = useState(false);

  // ESC exits showcase mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onExit]);

  const isOnDemo = typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/demo") || window.location.pathname.startsWith("/walkthrough"));

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
          {!isOnDemo && (
            <div className="showcase-toolbar-section">
              <a href="/walkthrough/" className="showcase-toolbar-btn">
                Guided Walkthrough
              </a>
            </div>
          )}
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
