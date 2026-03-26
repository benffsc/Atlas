import type { Metadata } from "next";
import { KioskShell } from "./KioskShell";

export const metadata: Metadata = {
  title: {
    default: "Equipment Kiosk",
    template: "%s | Equipment Kiosk",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "mobile-web-app-capable": "yes",
  },
};

/**
 * Kiosk layout — no sidebar, bottom tab bar, safe-area padding.
 * Designed for iPad/phone "Add to Home Screen" standalone mode.
 */
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <KioskShell>{children}</KioskShell>;
}
