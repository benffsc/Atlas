import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export const revalidate = 3600;

interface YearlyRow {
  year: number;
  reference_count: number;
  db_count: number;
  donor_facing_count: number;
  alignment_status: string;
}

/**
 * GET /api/dashboard/impact/yearly
 *
 * Returns the year-by-year alteration breakdown from the reference view.
 * Shows both the ED's reference count and the DB's provable count so
 * users can see which years have gaps.
 *
 * Used by: the audit drawer (chronological breakdown) and any future
 * year-over-year chart component.
 *
 * Data source: ops.v_alteration_counts_by_year (MIG_3073)
 * Epic: FFS-1196 (Tier 3: Gala Mode), data gap tracking
 */
export async function GET() {
  try {
    const rows = await queryRows<YearlyRow>(`
      SELECT
        year,
        reference_count,
        db_count,
        donor_facing_count,
        alignment_status
      FROM ops.v_alteration_counts_by_year
      ORDER BY year
    `);

    const totals = rows.reduce(
      (acc, r) => ({
        reference: acc.reference + r.reference_count,
        db: acc.db + r.db_count,
        donor_facing: acc.donor_facing + r.donor_facing_count,
      }),
      { reference: 0, db: 0, donor_facing: 0 }
    );

    return apiSuccess(
      {
        years: rows,
        totals,
        start_year: rows.length > 0 ? rows[0].year : new Date().getFullYear(),
        end_year: rows.length > 0 ? rows[rows.length - 1].year : new Date().getFullYear(),
      },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch (error) {
    console.error("Error fetching yearly impact:", error);
    return apiServerError("Failed to fetch yearly breakdown");
  }
}
