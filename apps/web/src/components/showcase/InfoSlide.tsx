"use client";

/**
 * InfoSlide — full-viewport info slide for the screensaver tour.
 *
 * stat-grid variant: each stat appears centered/huge one at a time,
 * then all settle into their quadrant positions.
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

export function InfoSlide({ variant, heading, body, stats, showLogo, progress }: InfoSlideProps) {
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // For stat-grid: which stat is currently "featured" (centered/large)
  // -1 = all settled in grid, 0-3 = that stat is featured
  const [featuredStat, setFeaturedStat] = useState(0);

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

  // Stat-grid: cycle through stats then settle
  useEffect(() => {
    if (variant !== "stat-grid" || !stats?.length) return;
    setFeaturedStat(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const perStat = 2200; // ms each stat is featured
    for (let i = 1; i < stats.length; i++) {
      timers.push(setTimeout(() => setFeaturedStat(i), i * perStat));
    }
    // After all stats shown, settle into grid
    timers.push(setTimeout(() => setFeaturedStat(-1), stats.length * perStat));
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
          featuredStat >= 0 ? (
            // Featured mode: one stat centered and huge
            <div className="info-slide__stat-featured">
              <span className="info-slide__stat-featured-value" key={featuredStat}>
                {stats[featuredStat].value}
              </span>
              <span className="info-slide__stat-featured-label" key={`l-${featuredStat}`}>
                {stats[featuredStat].label}
              </span>
            </div>
          ) : (
            // Settled mode: all stats in grid
            <div className="info-slide__stats info-slide__stats--settled">
              {stats.map((s, i) => (
                <div key={i} className="info-slide__stat">
                  <span className="info-slide__stat-value">{s.value}</span>
                  <span className="info-slide__stat-label">{s.label}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
