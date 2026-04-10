import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";

interface ReferenceRow {
  year: number;
  count: number;
  source: string;
  notes: string | null;
  updated_at: string;
}

interface ComparisonRow extends ReferenceRow {
  db_count: number;
  donor_facing_count: number;
  alignment_status: string;
}

/**
 * GET /api/admin/impact-reference
 *
 * Returns all reference counts joined with DB counts for comparison.
 * Admin only — used by the impact reference management page.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const rows = await queryRows<ComparisonRow>(`
      SELECT
        v.year,
        r.count,
        r.source,
        r.notes,
        r.updated_at::text,
        v.db_count,
        v.donor_facing_count,
        v.alignment_status
      FROM ops.alteration_reference_counts r
      JOIN ops.v_alteration_counts_by_year v ON v.year = r.year
      ORDER BY r.year DESC
    `);

    return apiSuccess({ rows });
  } catch (error) {
    console.error("Failed to fetch impact reference data:", error);
    return apiServerError("Failed to fetch reference data");
  }
}

/**
 * PUT /api/admin/impact-reference
 *
 * Update or insert a reference count for a given year.
 * Admin only. Body: { year: number, count: number, notes?: string }
 */
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can update reference data");
  }

  try {
    const body = await request.json();
    const { year, count, notes } = body;

    if (!year || typeof year !== "number" || year < 1980 || year > 2100) {
      return apiBadRequest("Invalid year — must be between 1980 and 2100");
    }
    if (count === undefined || typeof count !== "number" || count < 0) {
      return apiBadRequest("Invalid count — must be a non-negative number");
    }

    const updated = await queryOne<ReferenceRow>(
      `INSERT INTO ops.alteration_reference_counts (year, count, source, notes, updated_at)
       VALUES ($1, $2, 'admin_ui', $3, NOW())
       ON CONFLICT (year) DO UPDATE
         SET count = EXCLUDED.count,
             source = 'admin_ui',
             notes = COALESCE(EXCLUDED.notes, ops.alteration_reference_counts.notes),
             updated_at = NOW()
       RETURNING year, count, source, notes, updated_at::text`,
      [year, count, notes || null]
    );

    return apiSuccess(updated);
  } catch (error) {
    console.error("Failed to update impact reference:", error);
    return apiServerError("Failed to update reference data");
  }
}
