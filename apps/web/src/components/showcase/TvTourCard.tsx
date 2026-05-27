"use client";

/**
 * TvTourCard — TV-sized map narration card for the screensaver tour.
 *
 * Starts with a fullscreen title overlay (same visual as InfoSlide),
 * then fades it out after shrinkDelay to reveal the map + corner card.
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
  /** Ms before the fullscreen title fades to reveal the map. Default 5000. */
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
  const [showTitle, setShowTitle] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show fullscreen title on each new step, fade out after delay
  useEffect(() => {
    setShowTitle(true);
    timerRef.current = setTimeout(() => setShowTitle(false), shrinkDelay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [currentStep, shrinkDelay]);

  const cardClasses = [
    "tv-tour-card",
    compact ? "tv-tour-card--compact" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      {/* Fullscreen title overlay — fades out to reveal map */}
      <div
        className="tv-tour-title"
        style={{ opacity: showTitle ? 1 : 0, pointerEvents: showTitle ? "auto" : "none" }}
      >
        <div className="tv-tour-title__content">
          {stat && (
            <div className="tv-tour-title__stat">
              <span className="tv-tour-title__stat-value">{stat.value}</span>
              <span className="tv-tour-title__stat-label">{stat.label}</span>
            </div>
          )}
          <h2 className="tv-tour-title__heading">{label}</h2>
          <p className="tv-tour-title__body">{description}</p>
        </div>
      </div>

      {/* Corner card — always present, visible once title fades */}
      <div className={cardClasses}>
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
    </>
  );
}
