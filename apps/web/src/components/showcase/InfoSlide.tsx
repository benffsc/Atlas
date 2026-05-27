"use client";

/**
 * InfoSlide — full-viewport info slide for the screensaver tour.
 *
 * Four variants: hero, stat-grid, explainer, cta.
 * Pure black background, white text, TV-optimized sizing.
 * Logo is preloaded on mount so it never pops in late.
 */

import { useEffect, useState, useRef } from "react";
import type { SlideVariant } from "./screensaver-tour-config";

const LOGO_SRC = "/beacon-logo-transparent.png";

// Preload the logo image globally so it's cached for all slides
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

  useEffect(() => {
    if (!showLogo) {
      // No logo needed — fade in immediately
      requestAnimationFrame(() => setReady(true));
      return () => setReady(false);
    }
    // Wait for logo to be loaded before fading in
    const img = new Image();
    img.src = LOGO_SRC;
    imgRef.current = img;
    if (img.complete) {
      requestAnimationFrame(() => setReady(true));
    } else {
      img.onload = () => requestAnimationFrame(() => setReady(true));
      // Fallback: show after 300ms even if image hasn't loaded
      const fallback = setTimeout(() => setReady(true), 300);
      return () => { clearTimeout(fallback); setReady(false); };
    }
    return () => setReady(false);
  }, [showLogo]);

  return (
    <div className={`info-slide info-slide--${variant} ${ready ? "info-slide--visible" : ""}`}>
      {/* Progress bar */}
      <div className="info-slide__progress">
        <div className="info-slide__progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="info-slide__content">
        {showLogo && (
          <img
            src={LOGO_SRC}
            alt="Beacon"
            className="info-slide__logo"
          />
        )}

        {heading && <h1 className="info-slide__heading">{heading}</h1>}

        {body && <p className="info-slide__body">{body}</p>}

        {variant === "stat-grid" && stats && stats.length > 0 && (
          <div className="info-slide__stats">
            {stats.map((s, i) => (
              <div key={i} className="info-slide__stat" style={{ animationDelay: `${i * 200}ms` }}>
                <span className="info-slide__stat-value">{s.value}</span>
                <span className="info-slide__stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
