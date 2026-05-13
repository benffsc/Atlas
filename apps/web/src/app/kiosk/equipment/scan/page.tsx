"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Kiosk equipment scan — redirects to the unified staff scan page.
 *
 * The staff scan page (/equipment/scan) is THE scan experience for all
 * contexts. This redirect preserves existing bookmarks, PWA installs,
 * and the kiosk setup QR code.
 *
 * The kiosk layout (KioskShell) still wraps this route, so PIN/auth
 * gating is preserved if the kiosk is configured that way.
 */
export default function KioskScanRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/equipment/scan");
  }, [router]);

  return (
    <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
      Redirecting to equipment scan...
    </div>
  );
}
