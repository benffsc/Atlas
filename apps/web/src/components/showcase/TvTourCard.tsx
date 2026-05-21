"use client";

/**
 * TvTourCard — TV-sized map narration card for the screensaver tour.
 *
 * 660px wide, bottom-left positioned, large text.
 * Fully automated — no manual Next/End buttons.
 * Dot-based step indicator instead of "3/10" counter.
 */

interface TvTourCardProps {
  label: string;
  description: string;
  stat?: { value: string; label: string };
  progress: number;
  currentStep: number;
  totalSteps: number;
}

export function TvTourCard({
  label,
  description,
  stat,
  progress,
  currentStep,
  totalSteps,
}: TvTourCardProps) {
  return (
    <div className="tv-tour-card">
      {/* Progress bar */}
      <div className="tv-tour-card__progress">
        <div
          className="tv-tour-card__progress-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="tv-tour-card__body">
        {/* Stat highlight */}
        {stat && (
          <div className="tv-tour-card__stat">
            <span className="tv-tour-card__stat-value">{stat.value}</span>
            <span className="tv-tour-card__stat-label">{stat.label}</span>
          </div>
        )}

        <div className="tv-tour-card__label">{label}</div>
        <div className="tv-tour-card__desc">{description}</div>

        {/* Dot step indicator */}
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
