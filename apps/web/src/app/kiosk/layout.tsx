import type { Metadata } from "next";
import { KioskShell } from "./KioskShell";

export const metadata: Metadata = {
  title: {
    default: "Kiosk",
    template: "%s | Kiosk",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "mobile-web-app-capable": "yes",
  },
};

/**
 * Kiosk layout — no sidebar, safe-area padding.
 * Designed for iPad/phone "Add to Home Screen" standalone mode.
 * Supports both public modules (help, cats) and PIN-gated equipment.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <KioskShell>{children}</KioskShell>;
}
