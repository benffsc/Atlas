"use client";

/**
 * TvTourCard — TV lower-third narration bar for the screensaver tour.
 *
 * Wide (8s) → shrinking (1.2s, text hidden) → corner (text fades back).
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
  shrinkDelay = 8000,
}: TvTourCardProps) {
  const [phase, setPhase] = useState<"wide" | "shrinking" | "corner">("wide");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer2Ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPhase("wide");
    // After shrinkDelay, start shrinking (text hides)
    timerRef.current = setTimeout(() => {
      setPhase("shrinking");
      // After the CSS width transition (1.2s), text can reappear
      timer2Ref.current = setTimeout(() => setPhase("corner"), 1400);
    }, shrinkDelay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (timer2Ref.current) clearTimeout(timer2Ref.current);
    };
  }, [currentStep, shrinkDelay]);

  const classes = [
    "tv-tour-card",
    phase === "wide" ? "tv-tour-card--wide" : "",
    phase === "shrinking" ? "tv-tour-card--shrinking" : "",
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
