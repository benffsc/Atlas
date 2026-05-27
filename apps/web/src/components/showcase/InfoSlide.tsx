"use client";

/**
 * InfoSlide — full-viewport info slide for the screensaver tour.
 *
 * stat-grid: all 4 stats live in the grid from the start. The "featured"
 * one is transformed to center+large via CSS, then the transform transitions
 * back to none. Same DOM element the whole time = smooth animation.
 */

import { useEffect, useState, useRef } from "react";
import type { SlideVariant } from "./screensaver-tour-config";

const LOGO_SRC = "/beacon-logo-transparent.png";

if (typeof window !== "undefined") {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = LOGO_SRC;
  if (!document.head.querySelector(`link[href="${LOGO_SRC}"]`)) {
    document.head.appendChild(link);
  }
}

interface InfoSlideProps {
  variant: SlideVariant;
  heading: string;
  body?: string;
  stats?: { value: string; label: string }[];
  showLogo?: boolean;
  progress: number;
  /** When true, hero body text is visible (logo has raised) */
  heroRevealed?: boolean;
}

const FEATURE_MS = 2200;
const SETTLE_MS = 900;

export function InfoSlide({ variant, heading, body, stats, showLogo, progress, heroRevealed = true }: InfoSlideProps) {
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Each stat: "hidden" | "featured" | "settled"
  // featured = transformed to center+large; settled = back in grid position
  const [statPhases, setStatPhases] = useState<string[]>([]);

  useEffect(() => {
    if (!showLogo) {
      requestAnimationFrame(() => setReady(true));
      return () => setReady(false);
    }
    const img = new Image();
    img.src = LOGO_SRC;
    imgRef.current = img;
    if (img.complete) {
      requestAnimationFrame(() => setReady(true));
    } else {
      img.onload = () => requestAnimationFrame(() => setReady(true));
      const fallback = setTimeout(() => setReady(true), 300);
      return () => { clearTimeout(fallback); setReady(false); };
    }
    return () => setReady(false);
  }, [showLogo]);

  // Stat sequencing: feature one at a time, then settle
  useEffect(() => {
    if (variant !== "stat-grid" || !stats?.length) return;
    const n = stats.length;
    setStatPhases(new Array(n).fill("hidden"));
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cycle = FEATURE_MS + SETTLE_MS;

    for (let i = 0; i < n; i++) {
      // Show + feature stat i (transformed to center)
      timers.push(setTimeout(() => {
        setStatPhases(prev => prev.map((p, j) => j === i ? "featured" : p));
      }, i * cycle));
      // Settle stat i (remove transform, transition back to grid)
      timers.push(setTimeout(() => {
        setStatPhases(prev => prev.map((p, j) => j === i ? "settled" : p));
      }, i * cycle + FEATURE_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [variant, stats?.length]);

  // CSS custom property offsets for each grid quadrant
  // Grid is 2x2: stat 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right
  const quadrantStyles: React.CSSProperties[] = [
    { "--q-tx": "50%", "--q-ty": "50%" } as React.CSSProperties,
    { "--q-tx": "-50%", "--q-ty": "50%" } as React.CSSProperties,
    { "--q-tx": "50%", "--q-ty": "-50%" } as React.CSSProperties,
    { "--q-tx": "-50%", "--q-ty": "-50%" } as React.CSSProperties,
  ];

  return (
    <div className={`info-slide info-slide--${variant} ${ready ? "info-slide--visible" : ""}`}>
      <div className="info-slide__progress">
        <div className="info-slide__progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="info-slide__content">
        {showLogo && (
          <img src={LOGO_SRC} alt="Beacon" className="info-slide__logo" />
        )}

        {heading && <h1 className="info-slide__heading">{heading}</h1>}
        {body && (
          <p
            className="info-slide__body"
            style={variant === "hero" ? {
              opacity: heroRevealed ? 1 : 0,
              transform: heroRevealed ? "translateY(0)" : "translateY(20px)",
              transition: "opacity 1s ease, transform 1s ease",
            } : undefined}
          >
            {body}
          </p>
        )}

        {variant === "stat-grid" && stats && stats.length > 0 && (
          <div className="info-slide__stats">
            {stats.map((s, i) => {
              const phase = statPhases[i] || "hidden";
              return (
                <div
                  key={i}
                  className={`info-slide__stat info-slide__stat--${phase}`}
                  style={quadrantStyles[i]}
                >
                  <span className="info-slide__stat-value">{s.value}</span>
                  <span className="info-slide__stat-label">{s.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
