"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ToastProvider } from "@/components/feedback/Toast";

const MapSpinner = () => (
  <div
    style={{
      height: "100dvh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#f3f4f6",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}
  >
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: 40,
          height: 40,
          border: "3px solid #e5e7eb",
          borderTopColor: "#3b82f6",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          margin: "0 auto 12px",
        }}
      />
      <div style={{ color: "#6b7280", fontSize: 14 }}>Loading Atlas Map...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  </div>
);

// Leaflet map (legacy)
const AtlasMap = dynamic(() => import("@/components/map/AtlasMap"), {
  ssr: false,
  loading: MapSpinner,
});

// Google Maps (default)
const AtlasMapV2 = dynamic(() => import("@/components/map/AtlasMapV2"), {
  ssr: false,
  loading: MapSpinner,
});

function MapPageInner() {
  const searchParams = useSearchParams();
  const [useV2, setUseV2] = useState(searchParams.get("v1") !== "1");

  return (
    <ToastProvider>
      {/* Map version toggle */}
      <div style={{
        position: "fixed", top: 12, right: 80, zIndex: 9999,
        background: "var(--background, #fff)", borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)", padding: "4px",
        display: "flex", gap: 2, fontSize: 12, fontWeight: 500,
      }}>
        <button
          onClick={() => setUseV2(true)}
          style={{
            padding: "5px 10px", borderRadius: 6, border: "none", cursor: "pointer",
            background: useV2 ? "var(--primary, #3b82f6)" : "transparent",
            color: useV2 ? "white" : "var(--text-secondary, #6b7280)",
          }}
        >
          Google Maps
        </button>
        <button
          onClick={() => setUseV2(false)}
          style={{
            padding: "5px 10px", borderRadius: 6, border: "none", cursor: "pointer",
            background: !useV2 ? "var(--primary, #3b82f6)" : "transparent",
            color: !useV2 ? "white" : "var(--text-secondary, #6b7280)",
          }}
        >
          Leaflet (legacy)
        </button>
      </div>

      {useV2 ? <AtlasMapV2 /> : <AtlasMap />}
    </ToastProvider>
  );
}

export default function AtlasMapPage() {
  return (
    <Suspense fallback={<MapSpinner />}>
      <MapPageInner />
    </Suspense>
  );
}
