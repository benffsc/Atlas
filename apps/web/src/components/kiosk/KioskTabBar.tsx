"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

const TABS = [
  { href: "/kiosk/equipment/scan", icon: "scan-barcode", label: "Scan" },
  { href: "/kiosk/equipment/add", icon: "plus", label: "Add" },
  { href: "/kiosk/equipment/inventory", icon: "list", label: "List" },
  { href: "/kiosk/equipment/print", icon: "printer", label: "Print" },
] as const;

/**
 * Fixed bottom tab bar for the kiosk layout.
 * 64px tall + safe-area inset for notched devices.
 * Active tab uses --primary color.
 */
export function KioskTabBar() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: "calc(64px + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        background: "var(--card-bg, #fff)",
        borderTop: "1px solid var(--card-border, #e5e7eb)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        zIndex: 100,
        boxShadow: "0 -2px 8px rgba(0,0,0,0.06)",
      }}
    >
      {TABS.map((tab) => {
        const isActive = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "2px",
              flex: 1,
              height: "64px",
              textDecoration: "none",
              color: isActive ? "var(--primary)" : "var(--muted)",
              fontSize: "0.7rem",
              fontWeight: isActive ? 600 : 400,
              transition: "color 150ms ease",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Icon name={tab.icon} size={24} color={isActive ? "var(--primary)" : "var(--muted)"} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
