import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export const revalidate = 3600; // 1 hour

interface CaptionRow {
  enabled: boolean;
  title: string;
  subtitle: string;
  active_colonies: number;
}

/**
 * GET /api/map/caption
 *
 * Returns the config-driven caption overlay shown on the main map
 * (components/map/MapCaption.tsx). Also returns a live colony count so
 * the caption can show "X active colonies" dynamically.
 *
 * Per white-label rules (CLAUDE.md), all user-visible text lives in
 * ops.app_config. Admins can change the caption without a code change
 * via /admin/config → "map" category → map.caption_*.
 *
 * Used by: components/map/MapCaption.tsx
 * Epic: FFS-1195 (Tier 2: Mission Visibility)
 */
export async function GET() {
  try {
    const row = await queryOne<CaptionRow>(`
      SELECT
        (ops.get_config_value('map.caption_enabled', 'true') = 'true') AS enabled,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'map.caption_title'), 'Beacon Map') AS title,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'map.caption_subtitle'), 'Real-time TNR tracking') AS subtitle,
        (
          SELECT COUNT(DISTINCT r.place_id)::int
          FROM ops.requests r
          WHERE r.merged_into_request_id IS NULL
            AND r.status NOT IN ('completed', 'cancelled')
            AND r.place_id IS NOT NULL
        ) AS active_colonies
    `);

    if (!row) {
      return apiServerError("Map caption query returned no row");
    }

    return apiSuccess(
      {
        enabled: row.enabled,
        title: row.title,
        subtitle: row.subtitle,
        active_colonies: row.active_colonies,
      },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200" } }
    );
  } catch (error) {
    console.error("Error fetching map caption:", error);
    return apiServerError("Failed to fetch map caption");
  }
}
