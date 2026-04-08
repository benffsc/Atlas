"use client";

/**
 * LiveCounter — "Cats altered in 2026: 1,247 and counting" ticker.
 *
 * Shows a year-to-date count of cats altered with a smooth tick-up
 * animation when the number updates. Creates forward momentum for the
 * gala audience — emotional connection to ongoing work.
 *
 * Refreshes every 5 minutes from /api/dashboard/live-counter.
 * All text is admin-configurable via ops.app_config (live_counter.*).
 *
 * Pattern: nonprofit data storytelling — "engaging visuals turn cold
 * data into a story that creates emotional connection."
 *
 * Epic: FFS-1196 (Tier 3: Gala Mode)
 */

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api-client";

interface CounterData {
  enabled: boolean;
  label: string;
  suffix: string;
  count: number;
  year: number;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Smoothly animate a number from `from` to `to` over `duration` ms. */
function useAnimatedNumber(target: number, duration = 1500): number {
  const [display, setDisplay] = useState(target);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(target);

  useEffect(() => {
    if (display === target) return;
    startRef.current = null;
    fromRef.current = display;

    let raf: number;
    const step = (timestamp: number) => {
      if (startRef.current == null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setDisplay(current);
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, display]);

  return display;
}

export function LiveCounter() {
  const [data, setData] = useState<CounterData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchCount = () => {
      fetchApi<CounterData>("/api/dashboard/live-counter")
        .then((result) => {
          if (cancelled) return;
          if (result && typeof result === "object" && "count" in result) {
            setData(result as CounterData);
          }
        })
        .catch(() => {
          // Silent fail — decorative
        });
    };

    fetchCount();
    const interval = setInterval(fetchCount, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Animate the display number when the data updates
  const animatedCount = useAnimatedNumber(data?.count ?? 0);

  if (!data || !data.enabled || data.count === 0) return null;

  return (
    <div className="live-counter" role="status" aria-live="polite">
      <span className="live-counter-dot" aria-hidden="true" />
      <span className="live-counter-label">{data.label}:</span>
      <span className="live-counter-value">{animatedCount.toLocaleString()}</span>
      <span className="live-counter-suffix">{data.suffix}</span>
    </div>
  );
}
