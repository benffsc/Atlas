"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { ToastProvider } from "@/components/feedback/Toast";

/**
 * BeaconMapView — analyst-framed wrapper around AtlasMapV2.
 *
 * Renders the same underlying map component used at /map but with
 * `analystMode={true}`, which opts into Beacon-friendly defaults
 * (heatmap-first layers, choropleth zones, time slider, read-only
 * pin previews). Each of those behaviors is implemented incrementally
 * by sibling sub-issues under FFS-1172.
 *
 * This wrapper is the stable extension point — sibling issues add
 * props or new components and pipe them through here without
 * touching consumers.
 */
const AtlasMapV2 = dynamic(() => import("@/components/map/AtlasMapV2"), {
  ssr: false,
  loading: () => <BeaconMapSpinner />,
});

function BeaconMapSpinner() {
  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--background-subtle, #f3f4f6)",
        fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif)",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 40,
            height: 40,
            border: "3px solid var(--border, #e5e7eb)",
            borderTopColor: "var(--primary, #3b82f6)",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 12px",
          }}
        />
        <div style={{ color: "var(--foreground-muted, #6b7280)", fontSize: 14 }}>
          Loading Beacon Map…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default function BeaconMapView() {
  return (
    <Suspense fallback={<BeaconMapSpinner />}>
      <ToastProvider>
        <AtlasMapV2 analystMode={true} />
      </ToastProvider>
    </Suspense>
  );
}
