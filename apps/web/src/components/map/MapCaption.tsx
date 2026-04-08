"use client";

/**
 * MapCaption — Floating caption overlay for the main map page.
 *
 * Renders in the top-left corner as a subtle semi-transparent card with:
 *   - Product name / title ("Beacon Map")
 *   - Tagline ("Real-time TNR tracking across Sonoma County")
 *   - Live colony count ("· 47 active colonies")
 *
 * All text is admin-configurable via ops.app_config (category: "map",
 * keys: map.caption_enabled, map.caption_title, map.caption_subtitle).
 * White-label friendly.
 *
 * Pattern: map header caption gives the gala audience a "what am I looking
 * at?" glance without cluttering the map surface. Backdrop-filter blur +
 * rounded corners keeps it visually separate from the map pins.
 *
 * Hidden on mobile to preserve map real estate.
 *
 * Epic: FFS-1195 (Tier 2: Mission Visibility)
 */

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api-client";

interface CaptionData {
  enabled: boolean;
  title: string;
  subtitle: string;
  active_colonies: number;
}

export function MapCaption() {
  const [data, setData] = useState<CaptionData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApi<CaptionData>("/api/map/caption")
      .then((result) => {
        if (cancelled) return;
        if (result && typeof result === "object" && "title" in result) {
          setData(result as CaptionData);
        }
      })
      .catch(() => {
        // Silent fail — caption is decorative, map works without it
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || !data.enabled) return null;

  return (
    <div
      className="map-caption-overlay"
      role="complementary"
      aria-label="Map description"
    >
      <div className="map-caption-title">{data.title}</div>
      <div className="map-caption-subtitle">
        {data.subtitle}
        {data.active_colonies > 0 && (
          <>
            {" · "}
            <strong>{data.active_colonies.toLocaleString()}</strong> active{" "}
            {data.active_colonies === 1 ? "colony" : "colonies"}
          </>
        )}
      </div>
    </div>
  );
}
