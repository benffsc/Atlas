"use client";

import { useState, useCallback, useRef } from "react";
import { fetchApi } from "@/lib/api-client";

type EntityType = "cat" | "person" | "place" | "request";

interface HoverData {
  title: string;
  fields: Array<{ label: string; value: string }>;
  href: string;
}

// Module-level cache — survives re-renders, cleared on page nav
const hoverCache = new Map<string, HoverData>();

function cacheKey(type: EntityType, id: string) {
  return `${type}:${id}`;
}

function extractHoverData(type: EntityType, id: string, data: Record<string, unknown>): HoverData {
  switch (type) {
    case "cat":
      return {
        title: (data.name as string) || (data.display_name as string) || "Unknown Cat",
        fields: [
          { label: "Microchip", value: (data.microchip_id as string) || "None" },
          { label: "Sex", value: (data.sex as string) || "Unknown" },
          { label: "Altered", value: (data.is_altered as boolean) ? "Yes" : "No" },
        ],
        href: `/cats/${id}`,
      };
    case "person":
      return {
        title: (data.display_name as string) || "Unknown Person",
        fields: [
          ...(data.email ? [{ label: "Email", value: data.email as string }] : []),
          ...(data.phone ? [{ label: "Phone", value: data.phone as string }] : []),
          ...(data.role ? [{ label: "Role", value: data.role as string }] : []),
        ].slice(0, 3),
        href: `/people/${id}`,
      };
    case "place":
      return {
        title: (data.display_name as string) || (data.formatted_address as string) || "Unknown Place",
        fields: [
          ...(data.formatted_address ? [{ label: "Address", value: data.formatted_address as string }] : []),
          ...(data.cat_count !== undefined ? [{ label: "Cats", value: String(data.cat_count) }] : []),
          ...(data.colony_size !== undefined ? [{ label: "Colony", value: String(data.colony_size) }] : []),
        ].slice(0, 3),
        href: `/places/${id}`,
      };
    case "request":
      return {
        title: (data.display_name as string) || (data.formatted_address as string) || `Request`,
        fields: [
          { label: "Status", value: (data.status as string) || "Unknown" },
          ...(data.formatted_address ? [{ label: "Address", value: data.formatted_address as string }] : []),
          ...(data.estimated_cat_count !== undefined ? [{ label: "Cats", value: String(data.estimated_cat_count) }] : []),
        ].slice(0, 3),
        href: `/requests/${id}`,
      };
  }
}

/**
 * Fetches entity data for hover cards with caching.
 */
export function useEntityHoverData(type: EntityType, id: string) {
  const [data, setData] = useState<HoverData | null>(() => hoverCache.get(cacheKey(type, id)) || null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const fetch = useCallback(async () => {
    const key = cacheKey(type, id);
    if (hoverCache.has(key)) {
      setData(hoverCache.get(key)!);
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    setLoading(true);
    try {
      const apiMap: Record<EntityType, string> = {
        cat: `/api/cats/${id}`,
        person: `/api/people/${id}`,
        place: `/api/places/${id}`,
        request: `/api/requests/${id}`,
      };
      const raw = await fetchApi<Record<string, unknown>>(apiMap[type]);
      const hoverData = extractHoverData(type, id, raw);
      hoverCache.set(key, hoverData);
      setData(hoverData);
    } catch {
      // Silently fail — hover card is non-critical
    } finally {
      setLoading(false);
    }
  }, [type, id]);

  return { data, loading, fetch };
}
