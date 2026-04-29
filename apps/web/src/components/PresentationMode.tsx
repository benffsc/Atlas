"use client";

/**
 * PresentationMode — Distraction-free demo view for gala presentations.
 *
 * When enabled, applies a body class (.presentation-mode) that:
 *   - Scales fonts up (default 1.2x, configurable)
 *   - Hides admin chrome (sidebar becomes more spacious, technical elements dim)
 *   - Keeps the Beacon hero and impact numbers prominent
 *
 * State persists via localStorage (key: "beacon.presentation_mode") so
 * Ben can toggle it once at the start of the gala and stay in the mode.
 *
 * ESC exits the mode. A floating indicator shows when it's active.
 *
 * The toggle itself lives in the user menu in AppShell. This component
 * manages the body class, the keyboard handler, and the indicator.
 *
 * Epic: FFS-1196 (Tier 3: Gala Mode)
 */

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "beacon.presentation_mode";
const BODY_CLASS = "presentation-mode";

export function usePresentationMode() {
  const [enabled, setEnabled] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored === "true") {
      setEnabled(true);
    }
  }, []);

  // Apply/remove body class on state change
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (enabled) {
      document.body.classList.add(BODY_CLASS);
      window.localStorage.setItem(STORAGE_KEY, "true");
    } else {
      document.body.classList.remove(BODY_CLASS);
      window.localStorage.setItem(STORAGE_KEY, "false");
    }
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);
  const exit = useCallback(() => setEnabled(false), []);

  return { enabled, toggle, exit };
}

interface IndicatorConfig {
  text: string;
  fontScale: number;
}

/**
 * PresentationModeIndicator — floating indicator shown when mode is active.
 * Also handles the ESC-to-exit keyboard shortcut and shows a "Start Demo"
 * button so the presenter can launch the guided deck from any page.
 */
export function PresentationModeIndicator({
  enabled,
  onExit,
  config,
}: {
  enabled: boolean;
  onExit: () => void;
  config: IndicatorConfig;
}) {
  // Apply font scale as a CSS variable on the root element
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (enabled) {
      document.documentElement.style.setProperty("--presentation-font-scale", String(config.fontScale));
    } else {
      document.documentElement.style.removeProperty("--presentation-font-scale");
    }
  }, [enabled, config.fontScale]);

  // ESC to exit
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, onExit]);

  if (!enabled) return null;

  // Don't show the demo button if we're already on a demo page
  const isOnDemo = typeof window !== "undefined" && window.location.pathname.startsWith("/demo");

  return (
    <div className="presentation-indicator" role="status" aria-live="polite">
      <span className="presentation-indicator-dot" aria-hidden="true" />
      <span className="presentation-indicator-text">{config.text}</span>
      {!isOnDemo && (
        <a
          href="/demo/walkthrough"
          className="presentation-indicator-demo"
          aria-label="Start product walkthrough"
        >
          Start Demo
        </a>
      )}
      <button
        type="button"
        onClick={onExit}
        className="presentation-indicator-exit"
        aria-label="Exit presentation mode"
      >
        Exit
      </button>
    </div>
  );
}
