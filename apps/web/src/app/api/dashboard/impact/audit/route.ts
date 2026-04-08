import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

export const revalidate = 3600;

interface SampleAltered {
  cat_id: string;
  cat_name: string | null;
  microchip: string | null;
  appointment_date: string | null;
  procedure: string;
  clinic_name: string | null;
  source_system: string;
}

type Metric = "cats_altered" | "kittens_prevented" | "shelter_cost_avoided";

/**
 * GET /api/dashboard/impact/audit?metric=cats_altered&limit=10
 *
 * Returns sample records for spot-checking the impact summary numbers.
 * Lets a donor or board member click a stat on the dashboard and verify
 * the underlying data — "these are the actual records that generated
 * this number."
 *
 * Currently only `cats_altered` has raw records to return (derived metrics
 * like kittens_prevented and shelter_cost_avoided are computed from that
 * number via multipliers, so they share the same underlying sample).
 *
 * Epic: FFS-1194 (Tier 1 Beacon Polish)
 */
export async function GET(request: NextRequest) {
  try {
    const metric = request.nextUrl.searchParams.get("metric") as Metric | null;
    if (!metric || !["cats_altered", "kittens_prevented", "shelter_cost_avoided"].includes(metric)) {
      return apiBadRequest("Invalid or missing `metric` param (expected: cats_altered | kittens_prevented | shelter_cost_avoided)");
    }

    const { limit } = parsePagination(request.nextUrl.searchParams, { defaultLimit: 10, maxLimit: 50 });

    // All three metrics ultimately derive from the same underlying population
    // of altered cats, so we return the same sample for each. The drawer UI
    // explains the derivation for the computed metrics.
    const rows = await queryRows<SampleAltered>(
      `
      SELECT
        c.cat_id::text AS cat_id,
        COALESCE(c.display_name, c.name) AS cat_name,
        c.microchip,
        a.appointment_date::text AS appointment_date,
        CASE
          WHEN a.is_spay = TRUE AND a.is_neuter = TRUE THEN 'spay + neuter'
          WHEN a.is_spay = TRUE THEN 'spay'
          WHEN a.is_neuter = TRUE THEN 'neuter'
          ELSE 'altered'
        END AS procedure,
        p.display_name AS clinic_name,
        a.source_system
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
      LEFT JOIN sot.places p ON p.place_id = a.place_id
      WHERE a.cat_id IS NOT NULL
        AND (a.is_spay = TRUE OR a.is_neuter = TRUE)
        AND c.merged_into_cat_id IS NULL
      ORDER BY a.appointment_date DESC NULLS LAST
      LIMIT $1
      `,
      [limit]
    );

    return apiSuccess(
      {
        metric,
        sample: rows,
        sample_size: rows.length,
        note: "These are the most recent altered-cat records in the database. Click any row to see the full record.",
      },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch (error) {
    console.error("Error fetching impact audit:", error);
    return apiServerError("Failed to fetch audit sample");
  }
}
