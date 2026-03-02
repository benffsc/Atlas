import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Beacon Health Check Endpoint
 *
 * Quick check that Beacon views exist and can return data.
 * Used for:
 * - Fast health checks (doesn't query full data)
 * - Deployment verification
 * - Diagnosing 500 errors from Beacon endpoints
 */

interface ViewStatus {
  exists: boolean;
  hasData?: boolean;
  error?: string;
}

async function checkViewWithData(viewName: string, schema = "trapper"): Promise<ViewStatus> {
  try {
    // First check if view exists
    const existsResult = await queryOne<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_views
        WHERE schemaname = $1 AND viewname = $2
        UNION
        SELECT 1 FROM pg_matviews
        WHERE schemaname = $1 AND matviewname = $2
      ) as exists
    `, [schema, viewName]);

    if (!existsResult?.exists) {
      return { exists: false };
    }

    // Check if it has data
    const dataResult = await queryOne<{ has_data: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM ${schema}.${viewName} LIMIT 1) as has_data
    `, []);

    return {
      exists: true,
      hasData: dataResult?.has_data ?? false,
    };
  } catch (error) {
    return { exists: false, error: String(error) };
  }
}

export async function GET() {
  try {
    const [summary, places, clusters, seasonal] = await Promise.all([
      checkViewWithData("v_beacon_summary"),
      checkViewWithData("v_beacon_place_metrics"),
      checkViewWithData("mv_beacon_clusters"),
      checkViewWithData("v_seasonal_dashboard"),
    ]);

    const allExist = summary.exists && places.exists && clusters.exists;
    const anyHasData = summary.hasData || places.hasData || clusters.hasData;

    if (!allExist) {
      const missing = [
        !summary.exists && "v_beacon_summary (MIG_340)",
        !places.exists && "v_beacon_place_metrics (MIG_340)",
        !clusters.exists && "mv_beacon_clusters (MIG_341)",
        !seasonal.exists && "v_seasonal_dashboard (MIG_291)",
      ].filter(Boolean);

      return apiServerError(`Views missing: ${missing.join(", ")}. Run deploy-critical-migrations.sh`);
    }

    if (!anyHasData) {
      return apiSuccess({
        healthy: true,
        status: "no_data",
        views: { summary, places, clusters, seasonal },
        hint: "Views exist but contain no data. Run data ingestion scripts.",
      });
    }

    return apiSuccess({
      healthy: true,
      status: "operational",
      views: { summary, places, clusters, seasonal },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiServerError("Database connection issue or schema problem");
  }
}
