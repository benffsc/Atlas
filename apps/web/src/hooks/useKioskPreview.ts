"use client";

import { useMemo } from "react";

/**
 * useKioskPreview — admin preview mode for kiosk flows.
 *
 * When ?preview=1 is in the URL, all kiosk forms become clickable
 * without filling in required fields, the PIN gate is bypassed, and
 * actual API submissions are blocked. A persistent banner shows at
 * the top so it's obvious the kiosk is in preview mode.
 *
 * Usage: append ?preview=1 to any /kiosk/* URL.
 * Example: /kiosk?preview=1 or /kiosk/equipment/scan?preview=1
 *
 * Components that check this:
 * - KioskGate (bypass PIN)
 * - CheckoutForm (canSubmit = true, skip actual POST)
 * - KioskClinicPage (canGoNext = true)
 * - KioskAgreementModal (auto-agree available)
 */
export function useKioskPreview(): boolean {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("preview") === "1";
  }, []);
}
