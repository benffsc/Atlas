"use client";

import dynamic from "next/dynamic";

// Dynamically import the modern map component to avoid SSR issues with Leaflet
const BeaconMapModern = dynamic(() => import("@/components/BeaconMapModern"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "calc(100vh - 100px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f3f4f6",
        borderRadius: "0.5rem",
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
  ),
});

export default function AdminBeaconMapPage() {
  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
              Beacon Map
            </h1>
            <p style={{ margin: "0.25rem 0 0", color: "#6b7280", fontSize: "0.875rem" }}>
              Visualize cat activity, historical data, and TNR priorities
            </p>
          </div>
          <a
            href="/map"
            target="_blank"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#3b82f6",
              color: "white",
              borderRadius: "0.375rem",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            Open Fullscreen
          </a>
        </div>
      </div>

      {/* Full-featured map with built-in search, layers, and controls */}
      <div style={{ height: "calc(100vh - 180px)", minHeight: "500px" }}>
        <BeaconMapModern />
      </div>
    </div>
  );
}
