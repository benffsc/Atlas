"use client";

import dynamic from "next/dynamic";

const PublicDensityMapView = dynamic(() => import("./PublicDensityMapView"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100dvh", background: "#e5e7eb" }} />
  ),
});

export default function PublicMapLoader() {
  return <PublicDensityMapView />;
}
