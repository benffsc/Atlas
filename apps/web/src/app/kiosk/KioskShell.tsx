"use client";

import React from "react";
import { ToastProvider } from "@/components/feedback/Toast";
import { KioskGate } from "@/components/kiosk/KioskGate";
import { KioskTabBar } from "@/components/kiosk/KioskTabBar";
import { KioskHomeButton } from "@/components/kiosk/KioskHomeButton";
import { KioskSessionProvider } from "@/components/kiosk/KioskSessionProvider";
import { KioskStaffProvider } from "@/components/kiosk/KioskStaffContext";
import { KioskStaffBadge } from "@/components/kiosk/KioskStaffBadge";
import { OfflineBanner } from "@/components/kiosk/OfflineBanner";
import { Icon } from "@/components/ui/Icon";
import { usePathname } from "next/navigation";
import { useKioskPreview } from "@/hooks/useKioskPreview";

/**
 * Client-side kiosk shell — routes content through the right wrappers.
 *
 * FFS-1225: Unified Kiosk Hub. Equipment checkout/return (scan page) is
 * now a public-facing action — borrowers stand at the kiosk and do it.
 * Only equipment ADMIN pages (add, inventory, restock, print) are PIN-gated.
 *
 * Public routes: splash, help, cats, clinic, rehome, equipment/scan
 * PIN-gated routes: equipment/add, equipment/inventory, equipment/restock, equipment/print
 * Setup/print routes: no gate, no tab bar.
 *
 * Includes error boundary so a crash in any kiosk page doesn't white-screen.
 */
export function KioskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPreview = useKioskPreview();

  const isPrintRoute = pathname?.includes("/print");
  const isSetupRoute = pathname?.startsWith("/kiosk/setup");
  const isEquipmentRoute = pathname?.startsWith("/kiosk/equipment");
  const isSplash = pathname === "/kiosk";

  // FFS-1225: The scan page is public (checkout + return are borrower-facing actions).
  // Only admin equipment pages (add, inventory, restock, print) stay behind the PIN.
  // Preview mode (?preview=1) bypasses the PIN gate entirely.
  const isEquipmentScan = pathname === "/kiosk/equipment/scan";
  const isEquipmentAdmin = isEquipmentRoute && !isEquipmentScan && !isPrintRoute && !isSetupRoute;

  const needsGate = isEquipmentAdmin && !isPreview;
  const showTabBar = isEquipmentAdmin && !isPrintRoute;
  const showHomeButton = !isSplash && !isSetupRoute && !isPrintRoute;

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
      {isPreview && (
        <div
          style={{
            background: "#7c3aed",
            color: "#fff",
            padding: "6px 16px",
            fontSize: "0.8rem",
            fontWeight: 700,
            textAlign: "center",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            position: "sticky",
            top: 0,
            zIndex: 999,
          }}
        >
          Preview Mode — submissions disabled, validation bypassed
        </div>
      )}
      {children}
    </div>
  );

  return (
    <ToastProvider>
      <KioskStaffProvider>
        <KioskSessionProvider>
          <KioskErrorBoundary>
            {needsGate ? <KioskGate>{content}</KioskGate> : content}
          </KioskErrorBoundary>
          {showTabBar && <KioskTabBar />}
          {showTabBar && <KioskStaffBadge />}
          {showHomeButton && !showTabBar && <KioskHomeButton />}
        </KioskSessionProvider>
      </KioskStaffProvider>
    </ToastProvider>
  );
}

/**
 * Error boundary for kiosk — shows a recovery screen instead of white-screening.
 * Staff can tap "Return to Home" to get back to the splash screen.
 */
class KioskErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[KIOSK] Error boundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            textAlign: "center",
            gap: "1.5rem",
            background: "var(--background, #f9fafb)",
            fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "var(--warning-bg, #fffbeb)",
              border: "2px solid var(--warning-border, #fcd34d)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="alert-triangle" size={36} color="var(--warning-text, #92400e)" />
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: 0, maxWidth: 360 }}>
            The kiosk encountered an error. Tap below to return to the home screen.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false });
              window.location.href = "/kiosk";
            }}
            style={{
              padding: "0.875rem 2rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              background: "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: 14,
              cursor: "pointer",
              minHeight: 56,
            }}
          >
            Return to Home
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
