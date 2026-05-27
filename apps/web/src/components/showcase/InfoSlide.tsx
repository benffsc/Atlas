"use client";

/**
 * InfoSlide — full-viewport info slide for the screensaver tour.
 *
 * stat-grid variant: each stat appears centered/huge, then settles
 * into its quadrant while the next stat takes center stage.
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

/** Ms each stat is featured center before settling */
const FEATURE_MS = 2500;
/** Ms for the settle transition */
const SETTLE_MS = 800;

export function InfoSlide({ variant, heading, body, stats, showLogo, progress }: InfoSlideProps) {
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // For stat-grid: index of the stat currently featured (-1 = all settled)
  const [featured, setFeatured] = useState(0);
  // How many stats have settled into their grid position
  const [settled, setSettled] = useState(0);

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

  // Stat-grid animation: feature each stat, then settle it
  useEffect(() => {
    if (variant !== "stat-grid" || !stats?.length) return;
    setFeatured(0);
    setSettled(0);

    const timers: ReturnType<typeof setTimeout>[] = [];
    const total = stats.length;
    const cycleMs = FEATURE_MS + SETTLE_MS;

    for (let i = 0; i < total; i++) {
      // Feature stat i
      timers.push(setTimeout(() => setFeatured(i), i * cycleMs));
      // Settle stat i into grid (and feature next, or finish)
      timers.push(setTimeout(() => {
        setSettled(i + 1);
        if (i + 1 >= total) setFeatured(-1);
      }, i * cycleMs + FEATURE_MS));
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
          <div className="info-slide__stat-stage">
            {/* Grid of already-settled stats */}
            <div className="info-slide__stats">
              {stats.map((s, i) => (
                <div
                  key={i}
                  className="info-slide__stat"
                  style={{
                    opacity: i < settled ? 1 : 0,
                    transform: i < settled ? "scale(1)" : "scale(0.8)",
                    transition: `opacity ${SETTLE_MS}ms ease, transform ${SETTLE_MS}ms ease`,
                  }}
                >
                  <span className="info-slide__stat-value">{s.value}</span>
                  <span className="info-slide__stat-label">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Currently featured stat — centered overlay */}
            {featured >= 0 && featured < stats.length && (
              <div className="info-slide__stat-spotlight" key={featured}>
                <span className="info-slide__stat-spotlight-value">
                  {stats[featured].value}
                </span>
                <span className="info-slide__stat-spotlight-label">
                  {stats[featured].label}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
