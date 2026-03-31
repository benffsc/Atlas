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

/** Routes where the session timeout should NOT run */
const EXEMPT_ROUTES = ["/kiosk", "/kiosk/setup"];

function isExemptRoute(pathname: string | null): boolean {
  if (!pathname) return true;
  return EXEMPT_ROUTES.includes(pathname) || pathname.includes("/print");
}

/**
 * KioskSessionProvider — tracks inactivity on kiosk pages.
 *
 * Exempt on splash (/kiosk), setup, and print routes.
 * When idle past timeout, shows countdown modal → reset to splash.
 * Does NOT clear PIN — equipment stays unlocked for the staff shift.
 */
export function KioskSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const isEquipmentRoute = pathname?.startsWith("/kiosk/equipment");
  const exempt = isExemptRoute(pathname);
  const { value: publicTimeout } = useAppConfig<number>("kiosk.session_timeout_public");
  const { value: equipmentTimeout } = useAppConfig<number>("kiosk.session_timeout_equipment");

  const timeout = exempt ? 0 : isEquipmentRoute ? equipmentTimeout : publicTimeout;

  const lastInteractionRef = useRef(Date.now());
  const showModalRef = useRef(false);
  const [showModal, setShowModal] = useState(false);

  const resetTimer = useCallback(() => {
    lastInteractionRef.current = Date.now();
    showModalRef.current = false;
    setShowModal(false);
  }, []);

  // Reset timer when route changes (prevents jarring modal on navigate)
  useEffect(() => {
    lastInteractionRef.current = Date.now();
  }, [pathname]);

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

  // Check elapsed time every second (using ref to avoid re-creating interval on modal toggle)
  useEffect(() => {
    if (!timeout || timeout <= 0) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastInteractionRef.current) / 1000;
      if (elapsed >= timeout && !showModalRef.current) {
        showModalRef.current = true;
        setShowModal(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timeout]);

  const handleDismiss = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  const handleTimeout = useCallback(() => {
    showModalRef.current = false;
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
