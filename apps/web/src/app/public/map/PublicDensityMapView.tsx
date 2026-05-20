"use client";

import { useEffect, useState } from "react";
import { APIProvider, Map } from "@vis.gl/react-google-maps";
import { CatHexbinLayer } from "@/components/map/components/CatHexbinLayer";
import type { AtlasPin } from "@/components/map";

const DEFAULT_CENTER = { lat: 38.45, lng: -122.75 };
const MIN_ZOOM = 11;
const MAX_ZOOM = 13;

interface DensityPoint {
  lat: number;
  lng: number;
  cat_count: number;
}

function toPins(points: DensityPoint[]): AtlasPin[] {
  return points.map((p, i) => ({
    id: String(i),
    address: "",
    display_name: null,
    lat: p.lat,
    lng: p.lng,
    service_zone: null,
    parent_place_id: null,
    place_kind: null,
    unit_identifier: null,
    cat_count: p.cat_count,
    people: [],
    person_count: 0,
    disease_risk: false,
    disease_risk_notes: null,
    disease_badges: [],
    disease_count: 0,
    watch_list: false,
    google_entry_count: 0,
    google_summaries: [],
    request_count: 0,
    active_request_count: 0,
    needs_trapper_count: 0,
    intake_count: 0,
    total_altered: 0,
    last_alteration_at: null,
    pin_style: "reference" as const,
    pin_tier: "reference" as const,
  }));
}

function DensityMap({ pins }: { pins: AtlasPin[] }) {
  return (
    <>
      <style>{`html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}`}</style>
      <div
        className="map-container-v2"
        style={{ position: "fixed", inset: 0 }}
      >
        <Map
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "atlas-map-v2"}
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={MIN_ZOOM}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          disableDefaultUI={true}
          gestureHandling="greedy"
          style={{ width: "100%", height: "100%" }}
        >
          <CatHexbinLayer pins={pins} enabled={true} mode="density" />
        </Map>
      </div>
    </>
  );
}

export default function PublicDensityMapView() {
  const [pins, setPins] = useState<AtlasPin[]>([]);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    fetch("/api/public/map-density")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.points)) {
          setPins(toPins(data.points));
        }
      })
      .catch(console.error);
  }, []);

  if (!apiKey) return null;

  return (
    <APIProvider apiKey={apiKey} libraries={["marker"]} version="quarterly">
      <DensityMap pins={pins} />
    </APIProvider>
  );
}
