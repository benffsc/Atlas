import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";
import { syncFromMyMapsKml } from "@/lib/mymaps-sync";

/**
 * MyMaps KML Sync Cron
 *
 * Daily automated sync from Google MyMaps public KML URL.
 * Reads map ID from ops.app_config (map.mymaps.mid).
 *
 * Schedule: 0 6 * * * (6 AM UTC, before google-entry-linking at 7 AM)
 * Auth: Vercel cron header or CRON_SECRET bearer token
 */

export const maxDuration = 120; // 2 minutes for large KML files

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  try {
    // Read map ID from app_config
    const configRow = await queryOne<{ value: string }>(
      `SELECT value::text FROM ops.app_config WHERE key = 'map.mymaps.mid'`
    );

    if (!configRow?.value) {
      return apiSuccess({
        message: "MyMaps sync skipped — no map.mymaps.mid configured",
        skipped: true,
      });
    }

    const mapId = JSON.parse(configRow.value) as string;

    if (!mapId) {
      return apiSuccess({
        message: "MyMaps sync skipped — map.mymaps.mid is empty",
        skipped: true,
      });
    }

    const result = await syncFromMyMapsKml(mapId);

    return apiSuccess({
      message: "Daily MyMaps KML sync complete",
      mapId,
      ...result,
    });
  } catch (error) {
    console.error("MyMaps sync cron error:", error);
    return apiError(
      error instanceof Error ? error.message : "MyMaps sync failed",
      500
    );
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
