"use client";

import { useState, useEffect, useRef } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Icon } from "@/components/ui/Icon";

type BannerState = "hidden" | "offline" | "back-online";

/**
 * Fixed top banner that appears when the device loses internet.
 * Shows a yellow warning while offline, then a brief green
 * "Back online" message for 2 seconds on reconnect.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const [banner, setBanner] = useState<BannerState>("hidden");
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      setBanner("offline");
    } else if (wasOfflineRef.current) {
      // Transitioned from offline -> online
      setBanner("back-online");
      const timeout = setTimeout(() => {
        setBanner("hidden");
        wasOfflineRef.current = false;
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [online]);

  const isVisible = banner !== "hidden";
  const isOffline = banner === "offline";

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        transform: isVisible ? "translateY(0)" : "translateY(-100%)",
        transition: "transform 300ms ease",
        pointerEvents: isVisible ? "auto" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          padding: "0.625rem 1rem",
          paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))",
          fontSize: "0.875rem",
          fontWeight: 600,
          background: isOffline
            ? "var(--warning-bg)"
            : "var(--success-bg, #dcfce7)",
          color: isOffline
            ? "var(--warning-text)"
            : "var(--success-text, #16a34a)",
          borderBottom: isOffline
            ? "2px solid var(--warning-border)"
            : "2px solid var(--success-border, #86efac)",
        }}
      >
        <Icon
          name={isOffline ? "wifi-off" : "wifi"}
          size={16}
          color={
            isOffline
              ? "var(--warning-text)"
              : "var(--success-text, #16a34a)"
          }
        />
        {isOffline
          ? "No internet connection \u2014 check Wi-Fi"
          : "Back online"}
      </div>
    </div>
  );
}
