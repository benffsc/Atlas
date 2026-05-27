"use client";

/**
 * ScreensaverTour — auto-playing, looping TV screensaver for gala displays.
 *
 * State machine: IDLE → PLAYING → PAUSED → PLAYING → ...
 *
 * On idle: navigates to /map, adds body.tv-tour-active, starts step 0.
 * Map steps: dispatches "screensaver:fly-to" + "showcase:layers" events.
 * Slide steps: renders InfoSlide as full-screen overlay.
 * On mouse activity: pauses, records remaining time.
 * On idle again: resumes from same step with remaining time.
 * ESC or exit showcase: cleans up everything.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useIdleDetection } from "@/hooks/useIdleDetection";
import { InfoSlide } from "./InfoSlide";
import { TvTourCard } from "./TvTourCard";
import { SCREENSAVER_STEPS, type ScreensaverStep } from "./screensaver-tour-config";

type TourState = "idle" | "playing" | "paused";

interface ScreensaverTourProps {
  /** Only mount when showcase/presentation mode is active */
  enabled: boolean;
}

const IDLE_TIMEOUT_MS = 20_000;

export function ScreensaverTour({ enabled }: ScreensaverTourProps) {
  const pathname = usePathname();
  const [tourState, setTourState] = useState<TourState>("idle");
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [showPausedPill, setShowPausedPill] = useState(false);

  // Time tracking for pause/resume
  const stepStartRef = useRef(0);
  const remainingRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);
  const tourStateRef = useRef<TourState>("idle");

  // Keep ref in sync for event handlers
  tourStateRef.current = tourState;

  const steps = SCREENSAVER_STEPS;
  const step = steps[currentStep] as ScreensaverStep | undefined;
  const stepDuration = step?.pauseMs ?? 7000;

  // Cleanup helper
  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  // Start playing a step
  const playStep = useCallback(
    (stepIndex: number, durationOverride?: number) => {
      const s = steps[stepIndex];
      if (!s) return;

      // Cancel any lingering RAF/timer from previous step
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const duration = durationOverride ?? s.pauseMs;
      stepStartRef.current = Date.now();
      remainingRef.current = duration;

      if (s.type === "map") {
        // Dispatch fly-to event for the map
        window.dispatchEvent(
          new CustomEvent("screensaver:fly-to", {
            detail: { lat: s.lat, lng: s.lng, zoom: s.zoom },
          })
        );
        // Dispatch layer activation
        window.dispatchEvent(
          new CustomEvent("showcase:layers", {
            detail: s.layers ?? [],
          })
        );
        // Dispatch basemap change if specified
        if (s.basemap) {
          window.dispatchEvent(
            new CustomEvent("screensaver:basemap", {
              detail: s.basemap,
            })
          );
        }
      }

      // Progress animation
      setProgress(0);
      const totalDuration = s.pauseMs;
      const startProgress = 1 - duration / totalDuration;

      const tick = () => {
        const elapsed = Date.now() - stepStartRef.current;
        const pct = Math.min(startProgress + (elapsed / totalDuration) * (1 - startProgress), 1);
        setProgress(pct);
        if (pct < 1) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);

      // Advance to next step after duration
      timerRef.current = setTimeout(() => {
        const nextIdx = stepIndex + 1;
        if (nextIdx >= steps.length) {
          // Loop back to start
          setCurrentStep(0);
          playStep(0);
        } else {
          setCurrentStep(nextIdx);
          playStep(nextIdx);
        }
      }, duration);
    },
    [steps]
  );

  // Start the tour
  const startTour = useCallback(() => {
    // Navigate to map if not already there
    const isOnMap = window.location.pathname === "/map";
    if (!isOnMap) {
      sessionStorage.setItem("screensaver:pending", "1");
      window.location.href = "/map";
      return;
    }

    document.body.classList.add("tv-tour-active");
    setTourState("playing");
    setCurrentStep(0);
    setProgress(0);
    playStep(0);
  }, [playStep]);

  // Stop the tour completely
  const stopTour = useCallback(() => {
    clearTimers();
    document.body.classList.remove("tv-tour-active");
    setTourState("idle");
    setCurrentStep(0);
    setProgress(0);
    setShowPausedPill(false);
    // Reset map layers and basemap
    window.dispatchEvent(new CustomEvent("showcase:layers", { detail: [] }));
    window.dispatchEvent(new CustomEvent("screensaver:basemap", { detail: "street" }));
    // Notify toolbar
    window.dispatchEvent(new CustomEvent("screensaver:stopped"));
  }, [clearTimers]);

  // Pause the tour
  const pauseTour = useCallback(() => {
    if (tourStateRef.current !== "playing") return;
    clearTimers();
    const elapsed = Date.now() - stepStartRef.current;
    remainingRef.current = Math.max(stepDuration - elapsed, 500);
    setTourState("paused");
    setShowPausedPill(true);
  }, [clearTimers, stepDuration]);

  // Resume the tour
  const resumeTour = useCallback(() => {
    if (tourStateRef.current !== "paused") return;
    setShowPausedPill(false);
    setTourState("playing");
    playStep(currentStep, remainingRef.current);
  }, [currentStep, playStep]);

  // Idle detection — only active when tour is playing/paused or waiting to start
  useIdleDetection({
    timeoutMs: IDLE_TIMEOUT_MS,
    enabled: enabled,
    onIdle: () => {
      if (tourStateRef.current === "idle") {
        startTour();
      } else if (tourStateRef.current === "paused") {
        resumeTour();
      }
    },
    onActive: () => {
      if (tourStateRef.current === "playing") {
        pauseTour();
      }
    },
  });

  // Check for pending screensaver on map page load
  useEffect(() => {
    if (!enabled) return;
    if (pathname !== "/map") return;
    if (sessionStorage.getItem("screensaver:pending")) {
      sessionStorage.removeItem("screensaver:pending");
      const delay = setTimeout(() => {
        document.body.classList.add("tv-tour-active");
        setTourState("playing");
        setCurrentStep(0);
        setProgress(0);
        playStep(0);
      }, 1500);
      return () => clearTimeout(delay);
    }
  }, [pathname, enabled, playStep]);

  // ESC to exit
  useEffect(() => {
    if (tourState === "idle") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stopTour();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tourState, stopTour]);

  // Stop tour when showcase mode is disabled
  useEffect(() => {
    if (!enabled && tourStateRef.current !== "idle") {
      stopTour();
    }
  }, [enabled, stopTour]);

  // Cleanup on unmount only — NOT on state changes
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      document.body.classList.remove("tv-tour-active");
    };
  }, []);

  // Listen for manual trigger (T key dispatches screensaver:toggle)
  // Only starts the tour — ESC stops it. This avoids the race condition
  // where T keydown triggers idle-detection onActive (pausing the tour)
  // before the toggle handler runs (which would then see "paused" and stop).
  useEffect(() => {
    const handler = () => {
      if (tourStateRef.current === "idle") {
        startTour();
      }
      // If already playing/paused, ignore — use ESC to stop
    };
    window.addEventListener("screensaver:toggle", handler);
    return () => window.removeEventListener("screensaver:toggle", handler);
  }, [startTour]);

  // Nothing to render when idle
  if (tourState === "idle" || !step) return null;

  return (
    <>
      {/* Info slide overlay (for slide steps) */}
      {step.type === "slide" && (
        <InfoSlide
          variant={step.variant}
          heading={step.heading}
          body={step.body}
          stats={step.stats}
          showLogo={step.showLogo}
          progress={progress}
        />
      )}

      {/* TV tour card (for map steps) */}
      {step.type === "map" && (
        <TvTourCard
          label={step.label}
          description={step.description}
          stat={step.stat}
          progress={progress}
          currentStep={currentStep}
          totalSteps={steps.length}
        />
      )}

      {/* Paused pill indicator */}
      {showPausedPill && (
        <div className="screensaver-paused-pill">Paused</div>
      )}
    </>
  );
}
