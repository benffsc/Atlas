"use client";

/**
 * ScreensaverTour — auto-playing, looping TV screensaver for gala displays.
 *
 * State machine: IDLE → PLAYING → PAUSED → PLAYING → ...
 *
 * On idle: navigates to /map, adds body.tv-tour-active, starts step 0.
 * Map steps: dispatches "screensaver:fly-to" + "showcase:layers" events.
 * Slide steps: renders InfoSlide as full-screen overlay.
 * On mouse activity or T key: pauses with prev/next controls visible.
 * On idle again: resumes from same step with remaining time.
 * ESC: exits tour completely.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useIdleDetection } from "@/hooks/useIdleDetection";
import { InfoSlide } from "./InfoSlide";
import { TvTourCard } from "./TvTourCard";
import { DemoPlaceCard, DEMO_PLACES } from "./DemoPlaceCard";
import { SCREENSAVER_STEPS, type ScreensaverStep, type TourAction } from "./screensaver-tour-config";

type TourState = "idle" | "playing" | "paused";

interface ScreensaverTourProps {
  enabled: boolean;
}

const IDLE_TIMEOUT_MS = 20_000;

export function ScreensaverTour({ enabled }: ScreensaverTourProps) {
  const pathname = usePathname();
  const [tourState, setTourState] = useState<TourState>("idle");
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeDemoCard, setActiveDemoCard] = useState<string | null>(null);

  const stepStartRef = useRef(0);
  const remainingRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafRef = useRef<number>(0);
  const tourStateRef = useRef<TourState>("idle");

  tourStateRef.current = tourState;

  const steps = SCREENSAVER_STEPS;
  const step = steps[currentStep] as ScreensaverStep | undefined;
  const stepDuration = step?.pauseMs ?? 7000;

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    for (const t of actionTimerRefs.current) clearTimeout(t);
    actionTimerRefs.current = [];
  }, []);

  const playStep = useCallback(
    (stepIndex: number, durationOverride?: number) => {
      const s = steps[stepIndex];
      if (!s) return;

      // Cancel previous step's timers/actions
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      for (const t of actionTimerRefs.current) clearTimeout(t);
      actionTimerRefs.current = [];

      const duration = durationOverride ?? s.pauseMs;
      stepStartRef.current = Date.now();
      remainingRef.current = duration;

      if (s.type === "map") {
        // Dismiss any open drawers
        window.dispatchEvent(new CustomEvent("screensaver:action", { detail: { type: "dismiss" } }));
        // Fly to location
        window.dispatchEvent(new CustomEvent("screensaver:fly-to", {
          detail: { lat: s.lat, lng: s.lng, zoom: s.zoom },
        }));
        // Set layers
        window.dispatchEvent(new CustomEvent("showcase:layers", {
          detail: s.layers ?? [],
        }));
        // Set basemap
        if (s.basemap) {
          window.dispatchEvent(new CustomEvent("screensaver:basemap", { detail: s.basemap }));
        } else {
          window.dispatchEvent(new CustomEvent("screensaver:basemap", { detail: "street" }));
        }
        // Schedule scripted actions
        if (s.actions) {
          for (const action of s.actions) {
            const tid = setTimeout(() => {
              window.dispatchEvent(new CustomEvent("screensaver:action", { detail: action }));
            }, action.delay);
            actionTimerRefs.current.push(tid);
          }
        }
      } else {
        // Slide step: dismiss map drawers and clear layers so nothing bleeds through
        window.dispatchEvent(new CustomEvent("screensaver:action", { detail: { type: "dismiss" } }));
        window.dispatchEvent(new CustomEvent("showcase:layers", { detail: [] }));
      }

      // Progress animation
      setProgress(0);
      const totalDuration = s.pauseMs;
      const startProgress = 1 - duration / totalDuration;
      const tick = () => {
        const elapsed = Date.now() - stepStartRef.current;
        const pct = Math.min(startProgress + (elapsed / totalDuration) * (1 - startProgress), 1);
        setProgress(pct);
        if (pct < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      // Advance to next step
      timerRef.current = setTimeout(() => {
        const nextIdx = stepIndex + 1;
        if (nextIdx >= steps.length) {
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

  const startTour = useCallback(() => {
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
    setShowControls(false);
    playStep(0);
  }, [playStep]);

  const stopTour = useCallback(() => {
    clearTimers();
    document.body.classList.remove("tv-tour-active");
    setTourState("idle");
    setCurrentStep(0);
    setProgress(0);
    setShowControls(false);
    window.dispatchEvent(new CustomEvent("screensaver:action", { detail: { type: "dismiss" } }));
    window.dispatchEvent(new CustomEvent("showcase:layers", { detail: [] }));
    window.dispatchEvent(new CustomEvent("screensaver:basemap", { detail: "street" }));
    window.dispatchEvent(new CustomEvent("screensaver:stopped"));
  }, [clearTimers]);

  const pauseTour = useCallback(() => {
    if (tourStateRef.current !== "playing") return;
    clearTimers();
    const elapsed = Date.now() - stepStartRef.current;
    remainingRef.current = Math.max(stepDuration - elapsed, 500);
    setTourState("paused");
    setShowControls(true);
  }, [clearTimers, stepDuration]);

  const resumeTour = useCallback(() => {
    if (tourStateRef.current !== "paused") return;
    setShowControls(false);
    setTourState("playing");
    playStep(currentStep, remainingRef.current);
  }, [currentStep, playStep]);

  // Navigate to a specific step (for prev/next controls)
  const goToStep = useCallback((idx: number) => {
    const clamped = ((idx % steps.length) + steps.length) % steps.length;
    setCurrentStep(clamped);
    setTourState("playing");
    setShowControls(false);
    playStep(clamped);
  }, [steps.length, playStep]);

  // Idle detection for auto-start only (when tour hasn't started yet)
  useIdleDetection({
    timeoutMs: IDLE_TIMEOUT_MS,
    enabled: enabled,
    onIdle: () => {
      if (tourStateRef.current === "idle") startTour();
    },
  });

  // Direct mouse/key listener for pause/resume while tour is active.
  // This works regardless of how the tour was started (T key, idle, toolbar).
  // Clicks on the screensaver controls are ignored (they handle their own logic).
  useEffect(() => {
    if (!enabled) return;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let throttle = 0;

    const handleActivity = (e: Event) => {
      // Don't pause when clicking on the tour controls themselves
      if (e.target instanceof HTMLElement && e.target.closest(".screensaver-controls")) return;

      const now = Date.now();
      if (now - throttle < 200) return;
      throttle = now;

      if (tourStateRef.current === "playing") {
        pauseTour();
      }
      // Reset the resume-after-idle timer
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (tourStateRef.current === "paused") resumeTour();
      }, IDLE_TIMEOUT_MS);
    };

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("mousedown", handleActivity);
    window.addEventListener("touchstart", handleActivity);
    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      if (resumeTimer) clearTimeout(resumeTimer);
    };
  }, [enabled, pauseTour, resumeTour]);

  // Pending screensaver on map load
  useEffect(() => {
    if (!enabled || pathname !== "/map") return;
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

  // ESC to exit, arrow keys for prev/next when paused
  useEffect(() => {
    if (tourState === "idle") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { stopTour(); return; }
      if (tourStateRef.current === "paused") {
        if (e.key === "ArrowLeft") goToStep(currentStep - 1);
        else if (e.key === "ArrowRight") goToStep(currentStep + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tourState, stopTour, goToStep, currentStep]);

  // Stop on showcase disable
  useEffect(() => {
    if (!enabled && tourStateRef.current !== "idle") stopTour();
  }, [enabled, stopTour]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      for (const t of actionTimerRefs.current) clearTimeout(t);
      actionTimerRefs.current = [];
      document.body.classList.remove("tv-tour-active");
    };
  }, []);

  // Track drawer open/close for card compact mode + demo card
  useEffect(() => {
    const onOpen = () => setDrawerOpen(true);
    const onClose = () => { setDrawerOpen(false); setActiveDemoCard(null); };
    const onAction = (e: Event) => {
      const action = (e as CustomEvent).detail;
      if (action?.type === "show-demo-card") setActiveDemoCard(action.cardKey);
      else if (action?.type === "dismiss") setActiveDemoCard(null);
    };
    window.addEventListener("screensaver:drawer-open", onOpen);
    window.addEventListener("screensaver:drawer-close", onClose);
    window.addEventListener("screensaver:action", onAction);
    return () => {
      window.removeEventListener("screensaver:drawer-open", onOpen);
      window.removeEventListener("screensaver:drawer-close", onClose);
      window.removeEventListener("screensaver:action", onAction);
    };
  }, []);

  // T key: start if idle, pause/resume if playing
  useEffect(() => {
    const handler = () => {
      if (tourStateRef.current === "idle") startTour();
      else if (tourStateRef.current === "playing") pauseTour();
      else if (tourStateRef.current === "paused") resumeTour();
    };
    window.addEventListener("screensaver:toggle", handler);
    return () => window.removeEventListener("screensaver:toggle", handler);
  }, [startTour, pauseTour, resumeTour]);

  if (tourState === "idle" || !step) return null;

  return (
    <>
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

      {step.type === "map" && (
        <TvTourCard
          label={step.label}
          description={step.description}
          stat={step.stat}
          progress={progress}
          currentStep={currentStep}
          totalSteps={steps.length}
          compact={drawerOpen}
        />
      )}

      {/* Demo place card (replaces real drawer — instant, no PII) */}
      {activeDemoCard && DEMO_PLACES[activeDemoCard] && (
        <DemoPlaceCard
          place={DEMO_PLACES[activeDemoCard]}
          onClose={() => setActiveDemoCard(null)}
        />
      )}

      {/* Pause controls — prev/next/resume */}
      {showControls && (
        <div className="screensaver-controls">
          <button
            className="screensaver-controls__btn"
            onClick={() => goToStep(currentStep - 1)}
            title="Previous (←)"
          >
            ‹ Prev
          </button>
          <button
            className="screensaver-controls__btn screensaver-controls__btn--primary"
            onClick={resumeTour}
            title="Resume"
          >
            ▶ Resume
          </button>
          <button
            className="screensaver-controls__btn"
            onClick={() => goToStep(currentStep + 1)}
            title="Next (→)"
          >
            Next ›
          </button>
          <span className="screensaver-controls__step">
            {currentStep + 1} / {steps.length}
          </span>
          <button
            className="screensaver-controls__btn screensaver-controls__btn--exit"
            onClick={stopTour}
            title="Exit (Esc)"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
