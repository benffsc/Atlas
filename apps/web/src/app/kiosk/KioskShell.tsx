"use client";

import { ToastProvider } from "@/components/feedback/Toast";
import { KioskGate } from "@/components/kiosk/KioskGate";
import { KioskTabBar } from "@/components/kiosk/KioskTabBar";
import { OfflineBanner } from "@/components/kiosk/OfflineBanner";
import { usePathname } from "next/navigation";

/**
 * Client-side kiosk shell with PIN gate, bottom tab bar, and toast support.
 * KioskGate shows a PIN pad on first visit, then is transparent afterward.
 * Hides tab bar on print sub-routes.
 */
export function KioskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPrintRoute = pathname?.includes("/print");

  return (
    <ToastProvider>
      <KioskGate>
        <div
          style={{
            minHeight: "100dvh",
            background: "var(--background, #f9fafb)",
            fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            paddingBottom: isPrintRoute ? 0 : "calc(64px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <OfflineBanner />
          {children}
        </div>
        {!isPrintRoute && <KioskTabBar />}
      </KioskGate>
    </ToastProvider>
  );
}
