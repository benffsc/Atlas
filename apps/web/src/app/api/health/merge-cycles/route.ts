import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Merge Cycles Health Check
 *
 * Detects circular merge chains (A->B->A) and deep chains (A->B->C where C is also merged).
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects:
 *   data.person_cycles === 0
 *   data.cat_cycles === 0
 *   data.place_cycles === 0
 *
 * GET /api/health/merge-cycles
 */
export async function GET() {
  try {
    const result = await queryOne<{
      person_cycles: number;
      cat_cycles: number;
      place_cycles: number;
      cycles_found: number;
    }>(`
      SELECT
        -- Person merge chains with depth > 1 (potential cycles or unresolved chains)
        (SELECT COUNT(*)::int FROM sot.people p1
         JOIN sot.people p2 ON p1.merged_into_person_id = p2.person_id
         WHERE p2.merged_into_person_id IS NOT NULL
        ) AS person_cycles,

        -- Cat merge chains with depth > 1
        (SELECT COUNT(*)::int FROM sot.cats c1
         JOIN sot.cats c2 ON c1.merged_into_cat_id = c2.cat_id
         WHERE c2.merged_into_cat_id IS NOT NULL
        ) AS cat_cycles,

        -- Place merge chains with depth > 1
        (SELECT COUNT(*)::int FROM sot.places p1
         JOIN sot.places p2 ON p1.merged_into_place_id = p2.place_id
         WHERE p2.merged_into_place_id IS NOT NULL
        ) AS place_cycles,

        -- Total cycles found
        (
          (SELECT COUNT(*)::int FROM sot.people p1
           JOIN sot.people p2 ON p1.merged_into_person_id = p2.person_id
           WHERE p2.merged_into_person_id IS NOT NULL)
          +
          (SELECT COUNT(*)::int FROM sot.cats c1
           JOIN sot.cats c2 ON c1.merged_into_cat_id = c2.cat_id
           WHERE c2.merged_into_cat_id IS NOT NULL)
          +
          (SELECT COUNT(*)::int FROM sot.places p1
           JOIN sot.places p2 ON p1.merged_into_place_id = p2.place_id
           WHERE p2.merged_into_place_id IS NOT NULL)
        ) AS cycles_found
    `);

    return apiSuccess({
      person_cycles: result?.person_cycles ?? 0,
      cat_cycles: result?.cat_cycles ?? 0,
      place_cycles: result?.place_cycles ?? 0,
      cycles_found: result?.cycles_found ?? 0,
      affected_entities: [],
    });
  } catch (error) {
    console.error("Merge cycles check error:", error);
    return apiServerError("Failed to check merge cycles");
  }
}
