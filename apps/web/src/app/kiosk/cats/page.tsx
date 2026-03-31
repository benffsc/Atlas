"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

/**
 * Adoptable Cats — placeholder page (Phase 3, deferred).
 * Will be replaced with slideshow/browse when ShelterLuv API integration is built.
 */
export default function KioskCatsPage() {
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
        <Icon name="cat" size={36} color="var(--muted)" />
      </div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
        Coming Soon
      </h1>
      <p style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: 0, maxWidth: 360 }}>
        Browse our adoptable cats right here on the kiosk. This feature is on the way!
      </p>
      <Button
        variant="outline"
        size="lg"
        onClick={() => router.push("/kiosk")}
        style={{ minHeight: 48, borderRadius: 12, marginTop: "0.5rem" }}
      >
        Back to Home
      </Button>
    </div>
  );
}
