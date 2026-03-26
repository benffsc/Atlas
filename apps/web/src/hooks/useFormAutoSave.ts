"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Saves form state to sessionStorage on change (debounced) and on
 * visibility-change (app backgrounded). Restores on mount if data
 * is less than 30 minutes old.
 *
 * @returns [state, setState, clearSavedState, wasRestored]
 */
export function useFormAutoSave<T>(
  key: string,
  initialState: T,
): [T, (value: T | ((prev: T) => T)) => void, () => void, boolean] {
  const storageKey = `kiosk_form_${key}`;
  const [wasRestored, setWasRestored] = useState(false);

  const [state, setStateInner] = useState<T>(() => {
    if (typeof window === "undefined") return initialState;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const { data, timestamp } = JSON.parse(saved);
        if (Date.now() - timestamp < EXPIRY_MS) {
          return data;
        }
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // Ignore parse errors
    }
    return initialState;
  });

  // Detect if we restored from saved state
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const { timestamp } = JSON.parse(saved);
        if (Date.now() - timestamp < EXPIRY_MS) {
          setWasRestored(true);
        }
      }
    } catch {
      // Ignore
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep ref current for visibility-change handler
  const stateRef = useRef(state);
  stateRef.current = state;

  // Save on state change (debounced 500ms)
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ data: stateRef.current, timestamp: Date.now() }),
        );
      } catch {
        // sessionStorage full or unavailable
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [state, storageKey]);

  // Save immediately when page is backgrounded
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ data: stateRef.current, timestamp: Date.now() }),
          );
        } catch {
          // Ignore
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [storageKey]);

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateInner(value);
    },
    [],
  );

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore
    }
  }, [storageKey]);

  return [state, setState, clear, wasRestored];
}
