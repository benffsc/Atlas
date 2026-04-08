"use client";

import dynamic from "next/dynamic";

// Dynamically import the map component to avoid SSR issues
const AtlasMap = dynamic(() => import("@/components/map/AtlasMapV2"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "calc(100vh - 100px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at center, rgba(66, 145, 223, 0.08) 0%, var(--background, #f3f4f6) 60%)",
        borderRadius: "0.5rem",
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
  ),
});

export default function AdminAtlasMapPage() {
  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
              Atlas Map
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
              backgroundColor: "var(--primary, #3b82f6)",
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
        <AtlasMap />
      </div>
    </div>
  );
}
