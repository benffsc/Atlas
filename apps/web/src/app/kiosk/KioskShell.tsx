"use client";

import { ToastProvider } from "@/components/feedback/Toast";
import { KioskGate } from "@/components/kiosk/KioskGate";
import { KioskTabBar } from "@/components/kiosk/KioskTabBar";
import { KioskHomeButton } from "@/components/kiosk/KioskHomeButton";
import { KioskSessionProvider } from "@/components/kiosk/KioskSessionProvider";
import { OfflineBanner } from "@/components/kiosk/OfflineBanner";
import { usePathname } from "next/navigation";

/**
 * Client-side kiosk shell — routes content through the right wrappers.
 *
 * Public routes (splash, help, cats, trapper): no PIN gate, no tab bar.
 * Equipment routes: PIN gate + bottom tab bar.
 * Setup/print routes: no gate, no tab bar.
 *
 * KioskSessionProvider tracks inactivity on ALL kiosk pages and resets
 * to splash after timeout. Does NOT clear PIN (equipment stays unlocked).
 */
export function KioskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isPrintRoute = pathname?.includes("/print");
  const isSetupRoute = pathname?.startsWith("/kiosk/setup");
  const isEquipmentRoute = pathname?.startsWith("/kiosk/equipment");
  const isSplash = pathname === "/kiosk";

  // Equipment routes need PIN gate + tab bar
  // Public routes (help, cats, trapper, splash) need neither
  // Setup/print need neither
  const needsGate = isEquipmentRoute && !isPrintRoute && !isSetupRoute;
  const showTabBar = isEquipmentRoute && !isPrintRoute;
  const showHomeButton = !isSplash && !isSetupRoute && !isPrintRoute;

  // Only add bottom padding for tab bar (equipment) or home button (public pages)
  const bottomPadding = showTabBar
    ? "calc(64px + env(safe-area-inset-bottom, 0px))"
    : showHomeButton
      ? "calc(76px + env(safe-area-inset-bottom, 0px))"
      : "0";

  const content = (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--background, #f9fafb)",
        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        paddingBottom: bottomPadding,
      }}
    >
      <OfflineBanner />
      {children}
    </div>
  );

  return (
    <ToastProvider>
      <KioskSessionProvider>
        {needsGate ? <KioskGate>{content}</KioskGate> : content}
        {showTabBar && <KioskTabBar />}
        {showHomeButton && !showTabBar && <KioskHomeButton />}
      </KioskSessionProvider>
    </ToastProvider>
  );
}
