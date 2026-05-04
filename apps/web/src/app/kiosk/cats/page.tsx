"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";

/**
 * Adoptable Cats — embeds the ShelterLuv adoption widget.
 *
 * Uses shelter_id=15108 (FFSC). The embed page is designed for iframing —
 * no X-Frame-Options or CSP restrictions. Visitors can browse cats, view
 * photos/descriptions, and tap "Apply to Adopt" directly in the widget.
 *
 * The iframe fills the available viewport below the kiosk header. A loading
 * overlay shows while the widget bootstraps its JS-rendered content.
 */
const SHELTERLUV_EMBED_URL =
  "https://www.shelterluv.com/embed/animal/list?shelter_id=15108";

export default function KioskCatsPage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg, #fff)",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <Button
          variant="ghost"
          size="lg"
          icon="arrow-left"
          onClick={() => router.push("/kiosk")}
          style={{ minHeight: 48, borderRadius: 12 }}
        >
          Back
        </Button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Icon name="heart" size={20} color="var(--primary)" />
          <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>
            Adoptable Cats
          </h1>
        </div>
        <div style={{ width: 96 }} />
      </div>

      {/* ShelterLuv embed */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Loading state — shown until iframe fires onLoad */}
        {!loaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
              zIndex: 1,
              background: "var(--bg, #fff)",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                border: "3px solid var(--border)",
                borderTopColor: "var(--primary)",
                borderRadius: "50%",
                animation: "btn-spin 0.7s linear infinite",
              }}
            />
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>
              Loading adoptable cats...
            </p>
          </div>
        )}

        <iframe
          src={SHELTERLUV_EMBED_URL}
          title="Adoptable Cats — Forgotten Felines"
          onLoad={() => setLoaded(true)}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
          allow="autoplay"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </div>
    </div>
  );
}
