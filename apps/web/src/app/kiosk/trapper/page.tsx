"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

/**
 * Trapper Request — placeholder page (Phase 5, deferred).
 * Colony situations are handled by the help form's scoring engine,
 * which auto-routes to colony_tnr call_type.
 */
export default function KioskTrapperPage() {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.5rem",
        textAlign: "center",
        gap: "1.5rem",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "var(--muted-bg, #f3f4f6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="map-pin" size={36} color="var(--muted)" />
      </div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
        Coming Soon
      </h1>
      <p style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: 0, maxWidth: 360 }}>
        Need help with outdoor cats? Use the &ldquo;Get Help&rdquo; option — our system will automatically connect you with a trapper if needed.
      </p>
      <Button
        variant="primary"
        size="lg"
        onClick={() => router.push("/kiosk/help")}
        style={{ minHeight: 48, borderRadius: 12, marginTop: "0.5rem" }}
      >
        Get Help With a Cat
      </Button>
      <Button
        variant="ghost"
        size="lg"
        onClick={() => router.push("/kiosk")}
        style={{ minHeight: 48, borderRadius: 12 }}
      >
        Back to Home
      </Button>
    </div>
  );
}
