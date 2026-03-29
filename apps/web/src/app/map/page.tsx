"use client";

import { Suspense } from "react";
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

const AtlasMapV2 = dynamic(() => import("@/components/map/AtlasMapV2"), {
  ssr: false,
  loading: MapSpinner,
});

export default function AtlasMapPage() {
  return (
    <Suspense fallback={<MapSpinner />}>
      <ToastProvider>
        <AtlasMapV2 />
      </ToastProvider>
    </Suspense>
  );
}
