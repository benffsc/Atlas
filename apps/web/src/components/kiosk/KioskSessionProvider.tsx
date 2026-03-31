"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { KioskInactivityModal } from "./KioskInactivityModal";

interface KioskSessionContextValue {
  resetTimer: () => void;
}

const KioskSessionContext = createContext<KioskSessionContextValue>({
  resetTimer: () => {},
});

export function useKioskSession() {
  return useContext(KioskSessionContext);
}

/**
 * KioskSessionProvider — tracks inactivity on public kiosk pages.
 *
 * When the user is idle for longer than the configured timeout, shows
 * a "Are you still there?" modal with a 30-second countdown. If they
 * don't interact, resets to the splash screen.
 *
 * Does NOT clear PIN state — equipment stays unlocked for the staff shift.
 */
export function KioskSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const isEquipmentRoute = pathname?.startsWith("/kiosk/equipment");
  const { value: publicTimeout } = useAppConfig<number>("kiosk.session_timeout_public");
  const { value: equipmentTimeout } = useAppConfig<number>("kiosk.session_timeout_equipment");

  const timeout = isEquipmentRoute ? equipmentTimeout : publicTimeout;

  const lastInteractionRef = useRef(Date.now());
  const [showModal, setShowModal] = useState(false);

  const resetTimer = useCallback(() => {
    lastInteractionRef.current = Date.now();
    setShowModal(false);
  }, []);

  // Track user interactions
  useEffect(() => {
    const onInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    const events = ["touchstart", "click", "keypress", "scroll"] as const;
    events.forEach((e) => document.addEventListener(e, onInteraction, { passive: true }));
    return () => {
      events.forEach((e) => document.removeEventListener(e, onInteraction));
    };
  }, []);

  // Check elapsed time every second
  useEffect(() => {
    if (!timeout || timeout <= 0) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastInteractionRef.current) / 1000;
      if (elapsed >= timeout && !showModal) {
        setShowModal(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timeout, showModal]);

  const handleDismiss = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  const handleTimeout = useCallback(() => {
    setShowModal(false);
    lastInteractionRef.current = Date.now();
    router.push("/kiosk");
  }, [router]);

  return (
    <KioskSessionContext.Provider value={{ resetTimer }}>
      {children}
      {showModal && (
        <KioskInactivityModal
          onDismiss={handleDismiss}
          onTimeout={handleTimeout}
          countdownSeconds={30}
        />
      )}
    </KioskSessionContext.Provider>
  );
}
