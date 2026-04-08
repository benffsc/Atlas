"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { ToastProvider } from "@/components/feedback/Toast";
import { MapCaption } from "@/components/map/MapCaption";

const MapSpinner = () => (
  <div
    style={{
      height: "100dvh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      // Subtle radial glow from center — reinforces the "guiding light" metaphor
      background: "radial-gradient(ellipse at center, rgba(66, 145, 223, 0.08) 0%, var(--background, #f3f4f6) 60%)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}
  >
    <div style={{ textAlign: "center" }}>
      <img
        src="/beacon-logo.jpeg"
        alt="Beacon"
        style={{ width: "140px", height: "auto", marginBottom: "1.5rem", opacity: 0.75 }}
      />
      <div
        style={{
          width: 40,
          height: 40,
          border: "3px solid var(--border, #e5e7eb)",
          borderTopColor: "var(--primary, #4291df)",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          margin: "0 auto 14px",
        }}
      />
      <div style={{ color: "var(--text-secondary, #6b7280)", fontSize: 14, letterSpacing: "0.02em" }}>
        Illuminating the map&hellip;
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  </div>
);

const AtlasMapV2 = dynamic(() => import("@/components/map/AtlasMapV2"), {
  ssr: false,
  loading: MapSpinner,
});

export default function AtlasMapPage() {
  return (
    <Suspense fallback={<MapSpinner />}>
      <ToastProvider>
        <AtlasMapV2 />
        <MapCaption />
      </ToastProvider>
    </Suspense>
  );
}
