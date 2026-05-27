"use client";

/**
 * InfoSlide — full-viewport info slide for the screensaver tour.
 *
 * stat-grid variant: each stat starts centered/huge, then physically
 * shrinks and moves into its grid quadrant position.
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
}

const FEATURE_MS = 2200;

export function InfoSlide({ variant, heading, body, stats, showLogo, progress }: InfoSlideProps) {
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // For stat-grid: tracks the state of each stat
  // "hidden" → "featured" (centered/big) → "settling" (animating to grid) → "settled" (in grid)
  const [statStates, setStatStates] = useState<Array<"hidden" | "featured" | "settling" | "settled">>([]);

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

  // Stat animation sequencing
  useEffect(() => {
    if (variant !== "stat-grid" || !stats?.length) return;
    const n = stats.length;
    setStatStates(new Array(n).fill("hidden"));

    const timers: ReturnType<typeof setTimeout>[] = [];
    const settleMs = 800;

    for (let i = 0; i < n; i++) {
      const base = i * (FEATURE_MS + settleMs);
      // Feature this stat
      timers.push(setTimeout(() => {
        setStatStates(prev => prev.map((s, j) => j === i ? "featured" : s));
      }, base));
      // Start settling (shrink to grid)
      timers.push(setTimeout(() => {
        setStatStates(prev => prev.map((s, j) => j === i ? "settling" : s));
      }, base + FEATURE_MS));
      // Settled
      timers.push(setTimeout(() => {
        setStatStates(prev => prev.map((s, j) => j === i ? "settled" : s));
      }, base + FEATURE_MS + settleMs));
    }
    return () => timers.forEach(clearTimeout);
  }, [variant, stats?.length]);

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
        {body && <p className="info-slide__body">{body}</p>}

        {variant === "stat-grid" && stats && stats.length > 0 && (
          <div className="info-slide__stats">
            {stats.map((s, i) => {
              const state = statStates[i] || "hidden";
              return (
                <div
                  key={i}
                  className={`info-slide__stat info-slide__stat--${state}`}
                  data-quadrant={i}
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
