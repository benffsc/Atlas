"use client";

/**
 * TvTourCard — TV-sized map narration card for the screensaver tour.
 *
 * Starts near-fullscreen (title card), then shrinks to bottom-left
 * after `shrinkDelay` ms to reveal the map underneath.
 */

import { useState, useEffect, useRef } from "react";

interface TvTourCardProps {
  label: string;
  description: string;
  stat?: { value: string; label: string };
  progress: number;
  currentStep: number;
  totalSteps: number;
  compact?: boolean;
  /** Ms before card shrinks from fullscreen to corner. Default 6000. */
  shrinkDelay?: number;
}

export function TvTourCard({
  label,
  description,
  stat,
  progress,
  currentStep,
  totalSteps,
  compact = false,
  shrinkDelay = 6000,
}: TvTourCardProps) {
  const [shrunk, setShrunk] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset to expanded on step change, then auto-shrink after delay
  useEffect(() => {
    setShrunk(false);
    timerRef.current = setTimeout(() => setShrunk(true), shrinkDelay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [currentStep, shrinkDelay]);

  const classes = [
    "tv-tour-card",
    shrunk ? "tv-tour-card--shrunk" : "",
    compact ? "tv-tour-card--compact" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      {/* Progress bar */}
      <div className="tv-tour-card__progress">
        <div
          className="tv-tour-card__progress-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="tv-tour-card__body">
        {stat && (
          <div className="tv-tour-card__stat">
            <span className="tv-tour-card__stat-value">{stat.value}</span>
            <span className="tv-tour-card__stat-label">{stat.label}</span>
          </div>
        )}

        <div className="tv-tour-card__label">{label}</div>
        <div className="tv-tour-card__desc">{description}</div>

        <div className="tv-tour-card__dots">
          {Array.from({ length: totalSteps }, (_, i) => (
            <span
              key={i}
              className={`tv-tour-card__dot ${i === currentStep ? "tv-tour-card__dot--active" : ""} ${i < currentStep ? "tv-tour-card__dot--done" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
