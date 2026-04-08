import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

// Short cache — the live counter should feel "live"
export const revalidate = 300; // 5 minutes

interface CounterRow {
  count: number;
  enabled: boolean;
  label: string;
  suffix: string;
  year: number;
}

/**
 * GET /api/dashboard/live-counter
 *
 * Returns the count of cats altered in the current calendar year plus
 * the admin-configurable label and suffix for the live ticker.
 *
 * Used by: components/dashboard/LiveCounter.tsx
 * Epic: FFS-1196 (Tier 3: Gala Mode)
 */
export async function GET() {
  try {
    const row = await queryOne<CounterRow>(`
      SELECT
        (
          SELECT COUNT(DISTINCT a.cat_id)::int
          FROM ops.appointments a
          WHERE a.cat_id IS NOT NULL
            AND (a.is_spay = TRUE OR a.is_neuter = TRUE)
            AND EXTRACT(YEAR FROM a.appointment_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        ) AS count,
        (ops.get_config_value('live_counter.enabled', 'true') = 'true') AS enabled,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'live_counter.label'), 'Cats altered in {year}') AS label,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'live_counter.suffix'), 'and counting') AS suffix,
        EXTRACT(YEAR FROM CURRENT_DATE)::int AS year
    `);

    if (!row) {
      return apiServerError("Live counter query returned no row");
    }

    // Replace {year} token in label
    const label = row.label.replace("{year}", String(row.year));

    return apiSuccess(
      {
        enabled: row.enabled,
        label,
        suffix: row.suffix,
        count: row.count,
        year: row.year,
      },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
    );
  } catch (error) {
    console.error("Error fetching live counter:", error);
    return apiServerError("Failed to fetch live counter");
  }
}
