/**
 * mymaps-sync — Shared module for Google MyMaps KML sync.
 *
 * Extracts placemarks from a public MyMaps KML URL, upserts into
 * source.google_map_entries with content_hash change detection.
 *
 * Used by:
 * - /api/admin/google-maps-sync (PUT handler — manual "Sync from MyMaps" button)
 * - /api/cron/mymaps-sync (daily automated sync)
 */

import { queryRows, queryOne } from "@/lib/db";
import { parseStringPromise } from "xml2js";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Placemark {
  name: string;
  description: string;
  lat: number;
  lng: number;
  styleUrl: string;
  folder: string;
}

export interface SyncResult {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// KML Parsing (extracted from google-maps-sync/route.ts)
// ---------------------------------------------------------------------------

export function parseStyleId(styleUrl: string): {
  iconType: string | null;
  iconColor: string | null;
  styleId: string | null;
} {
  if (!styleUrl) return { iconType: null, iconColor: null, styleId: null };

  const match = styleUrl.match(/#?(icon-\d+)-([A-F0-9]+)/i);
  if (match) {
    return {
      iconType: match[1].toLowerCase(),
      iconColor: match[2].toUpperCase(),
      styleId: `${match[1].toLowerCase()}-${match[2].toUpperCase()}`,
    };
  }
  return { iconType: null, iconColor: null, styleId: styleUrl };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractPlacemarks(node: any, folderName = ""): Placemark[] {
  const placemarks: Placemark[] = [];

  if (!node) return placemarks;

  // Handle Folder
  if (node.Folder) {
    const folders = Array.isArray(node.Folder) ? node.Folder : [node.Folder];
    for (const folder of folders) {
      const name = folder.name?.[0] || "";
      placemarks.push(...extractPlacemarks(folder, name));
    }
  }

  // Handle Placemark
  if (node.Placemark) {
    const pms = Array.isArray(node.Placemark) ? node.Placemark : [node.Placemark];
    for (const pm of pms) {
      const name = pm.name?.[0] || "";
      const description = pm.description?.[0] || "";
      const styleUrl = pm.styleUrl?.[0] || "";
      const coords = pm.Point?.[0]?.coordinates?.[0] || "";

      const [lng, lat] = coords.split(",").map((s: string) => parseFloat(s.trim()));

      if (lat && lng) {
        placemarks.push({
          name,
          description,
          lat,
          lng,
          styleUrl,
          folder: folderName,
        });
      }
    }
  }

  // Handle Document
  if (node.Document) {
    const docs = Array.isArray(node.Document) ? node.Document : [node.Document];
    for (const doc of docs) {
      placemarks.push(...extractPlacemarks(doc, folderName));
    }
  }

  return placemarks;
}

// ---------------------------------------------------------------------------
// Content hash for change detection
// ---------------------------------------------------------------------------

function computeHash(name: string, description: string): string {
  return createHash("md5")
    .update(`${name || ""}||${description || ""}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Fetch KML from a public Google MyMaps URL, parse placemarks, and upsert
 * into source.google_map_entries with content_hash change detection.
 *
 * - New entries: INSERT
 * - Changed descriptions: UPDATE (content_hash changed)
 * - Unchanged: SKIP (only touch synced_at)
 * - Removed entries: NOT hard-deleted — set sync_status = 'removed'
 */
export async function syncFromMyMapsKml(mapId: string): Promise<SyncResult> {
  const startTime = Date.now();

  // Fetch KML from the public MyMaps URL
  const kmlUrl = `https://www.google.com/maps/d/kml?forcekml=1&mid=${mapId}`;
  const response = await fetch(kmlUrl, {
    headers: {
      "User-Agent": "Atlas-KML-Sync/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch KML: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";

  // Detect Google blocking (CAPTCHA, HTML error pages)
  if (contentType.includes("text/html") && !contentType.includes("xml")) {
    const bodyPreview = (await response.text()).slice(0, 500);
    if (bodyPreview.includes("CAPTCHA") || bodyPreview.includes("sorry")) {
      throw new Error("Google returned a CAPTCHA/block page. Try again later or use a manual KML export.");
    }
    throw new Error(`Expected KML but got HTML. Content preview: ${bodyPreview.slice(0, 200)}`);
  }

  const kmlContent = await response.text();

  // Parse KML
  const result = await parseStringPromise(kmlContent);
  const placemarks = extractPlacemarks(result.kml);

  if (placemarks.length === 0) {
    throw new Error("No placemarks found in KML. The map may be empty or the URL may be a NetworkLink.");
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  // Upsert each placemark
  for (const pm of placemarks) {
    const hash = computeHash(pm.name, pm.description);
    const { iconType, iconColor } = parseStyleId(pm.styleUrl);

    try {
      const upsertResult = await queryOne<{ action: string }>(`
        INSERT INTO source.google_map_entries (
          kml_name, original_content, lat, lng, kml_folder, source_file,
          icon_type, icon_color, content_hash, synced_at, sync_source, sync_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'mymaps_kml', 'active')
        ON CONFLICT (lat, lng, kml_name) WHERE kml_name IS NOT NULL
        DO UPDATE SET
          original_content = CASE
            WHEN source.google_map_entries.content_hash IS DISTINCT FROM EXCLUDED.content_hash
            THEN EXCLUDED.original_content
            ELSE source.google_map_entries.original_content
          END,
          icon_type = COALESCE(EXCLUDED.icon_type, source.google_map_entries.icon_type),
          icon_color = COALESCE(EXCLUDED.icon_color, source.google_map_entries.icon_color),
          kml_folder = COALESCE(EXCLUDED.kml_folder, source.google_map_entries.kml_folder),
          content_hash = EXCLUDED.content_hash,
          synced_at = NOW(),
          sync_status = 'active',
          updated_at = CASE
            WHEN source.google_map_entries.content_hash IS DISTINCT FROM EXCLUDED.content_hash
            THEN NOW()
            ELSE source.google_map_entries.updated_at
          END
        RETURNING CASE
          WHEN xmax = 0 THEN 'inserted'
          WHEN source.google_map_entries.content_hash IS DISTINCT FROM $9 THEN 'updated'
          ELSE 'unchanged'
        END AS action
      `, [
        pm.name || null,
        pm.description || null,
        pm.lat,
        pm.lng,
        pm.folder || null,
        `mymaps:${mapId}`,
        iconType,
        iconColor,
        hash,
      ]);

      const action = upsertResult?.action || "unchanged";
      if (action === "inserted") inserted++;
      else if (action === "updated") updated++;
      else unchanged++;
    } catch (err) {
      console.error(`Error upserting placemark "${pm.name}" at ${pm.lat},${pm.lng}:`, err);
      errors++;
    }
  }

  // Mark entries not seen in this sync as removed (soft delete)
  // Only for entries that were previously synced from this map
  await queryRows(`
    UPDATE source.google_map_entries
    SET sync_status = 'removed', updated_at = NOW()
    WHERE sync_source = 'mymaps_kml'
      AND source_file = $1
      AND (synced_at IS NULL OR synced_at < NOW() - INTERVAL '1 hour')
      AND sync_status = 'active'
  `, [`mymaps:${mapId}`]);

  return {
    total: placemarks.length,
    inserted,
    updated,
    unchanged,
    errors,
    duration_ms: Date.now() - startTime,
  };
}
