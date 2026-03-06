"use client";

import { useState, useEffect } from "react";

interface RequestCounts {
  [key: string]: number;
  new: number;
  working: number;
  paused: number;
  completed: number;
  needs_trapper: number;
  urgent: number;
}

/**
 * Fetches request status counts from /api/requests/counts.
 * Polls every 60 seconds. Non-critical — returns zeroes on error.
 */
export function useRequestCounts() {
  const [counts, setCounts] = useState<RequestCounts>({
    new: 0,
    working: 0,
    paused: 0,
    completed: 0,
    needs_trapper: 0,
    urgent: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchCounts = async () => {
      try {
        const response = await fetch("/api/requests/counts");
        if (response.ok) {
          const data = await response.json();
          if (!cancelled && data.success) {
            setCounts(data.data);
          }
        }
      } catch {
        /* counts are a non-critical enhancement */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCounts();
    const interval = setInterval(fetchCounts, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { counts, loading };
}
