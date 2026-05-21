"use client";

import { useEffect, useRef, useState } from "react";

interface UseIdleDetectionOptions {
  /** Milliseconds of inactivity before considered idle */
  timeoutMs: number;
  /** Called when user becomes idle */
  onIdle?: () => void;
  /** Called when user becomes active again */
  onActive?: () => void;
  /** Whether detection is enabled */
  enabled?: boolean;
}

/**
 * Detects user idle state by listening to mouse, keyboard, and touch events.
 * Throttles mousemove to 200ms. Single setTimeout ref — no leaks.
 *
 * Callbacks are stored in refs so listener registration only happens once
 * (when `enabled` or `timeoutMs` changes), not on every render.
 */
export function useIdleDetection({
  timeoutMs,
  onIdle,
  onActive,
  enabled = true,
}: UseIdleDetectionOptions) {
  const [isIdle, setIsIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttleRef = useRef<number>(0);
  const idleRef = useRef(false);
  const onIdleRef = useRef(onIdle);
  const onActiveRef = useRef(onActive);

  // Keep callback refs current without causing effect re-runs
  onIdleRef.current = onIdle;
  onActiveRef.current = onActive;

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (idleRef.current) {
        idleRef.current = false;
        setIsIdle(false);
      }
      return;
    }

    const resetTimer = () => {
      if (idleRef.current) {
        idleRef.current = false;
        setIsIdle(false);
        onActiveRef.current?.();
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        idleRef.current = true;
        setIsIdle(true);
        onIdleRef.current?.();
      }, timeoutMs);
    };

    const handleMouseMove = () => {
      const now = Date.now();
      if (now - throttleRef.current < 200) return;
      throttleRef.current = now;
      resetTimer();
    };

    const handleActivity = () => resetTimer();

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("mousedown", handleActivity);
    window.addEventListener("touchstart", handleActivity);

    // Start the initial timer
    resetTimer();

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, timeoutMs]);

  return { isIdle };
}
