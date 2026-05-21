"use client";

/**
 * InfoSlide — full-viewport info slide for the screensaver tour.
 *
 * Four variants: hero, stat-grid, explainer, cta.
 * All dark navy gradients, white text, clamp() for responsive sizing.
 * TV-optimized: 4rem+ headings, 1.5rem body text.
 */

import { useEffect, useState } from "react";
import type { SlideVariant } from "./screensaver-tour-config";

interface InfoSlideProps {
  variant: SlideVariant;
  heading: string;
  body?: string;
  stats?: { value: string; label: string }[];
  showLogo?: boolean;
  progress: number;
}

export function InfoSlide({ variant, heading, body, stats, showLogo, progress }: InfoSlideProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
    return () => setMounted(false);
  }, []);

  return (
    <div className={`info-slide info-slide--${variant} ${mounted ? "info-slide--visible" : ""}`}>
      {/* Progress bar */}
      <div className="info-slide__progress">
        <div className="info-slide__progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="info-slide__content">
        {showLogo && (
          <img
            src="/beacon-logo.jpeg"
            alt="Beacon"
            className="info-slide__logo"
          />
        )}

        <h1 className="info-slide__heading">{heading}</h1>

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
