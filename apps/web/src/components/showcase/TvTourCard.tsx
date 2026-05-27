"use client";

/**
 * TvTourCard — TV lower-third narration bar for the screensaver tour.
 *
 * Starts as a full-width black bar across the bottom (~25% height),
 * then smoothly shrinks to a corner card after shrinkDelay.
 * One element, one CSS transition. No layers, no glitching.
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
  /** Ms before bar shrinks from full-width to corner card. Default 5000. */
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
  shrinkDelay = 5000,
}: TvTourCardProps) {
  const [wide, setWide] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setWide(true);
    timerRef.current = setTimeout(() => setWide(false), shrinkDelay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [currentStep, shrinkDelay]);

  const classes = [
    "tv-tour-card",
    wide ? "tv-tour-card--wide" : "",
    compact ? "tv-tour-card--compact" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={classes}>
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
