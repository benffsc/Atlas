"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * Floating home button — returns to kiosk splash screen.
 * Hidden on splash, setup, and print routes.
 */
export function KioskHomeButton() {
  const pathname = usePathname();

  const isSplash = pathname === "/kiosk";
  const isSetup = pathname?.startsWith("/kiosk/setup");
  const isPrint = pathname?.includes("/print");

  if (isSplash || isSetup || isPrint) return null;

  return (
    <Link
      href="/kiosk"
      aria-label="Return to kiosk home"
      style={{
        position: "fixed",
        bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
        left: 20,
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--card-border, #e5e7eb)",
        boxShadow: "var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.12))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 90,
        textDecoration: "none",
        WebkitTapHighlightColor: "transparent",
        transition: "transform 150ms ease, box-shadow 150ms ease",
      }}
    >
      <Icon name="home" size={24} color="var(--primary)" />
    </Link>
  );
}
