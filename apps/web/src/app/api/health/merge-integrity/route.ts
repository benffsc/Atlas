import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Merge Integrity Health Check
 *
 * Checks for orphaned merges (merged_into points to a non-existent record).
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects:
 *   data.orphaned_person_merges === 0
 *   data.orphaned_cat_merges === 0
 *   data.orphaned_place_merges === 0
 *
 * GET /api/health/merge-integrity
 */
export async function GET() {
  try {
    const result = await queryOne<{
      orphaned_person_merges: number;
      orphaned_cat_merges: number;
      orphaned_place_merges: number;
      valid_merges: number;
      broken_merges: number;
    }>(`
      SELECT
        -- People merged into non-existent target
        (SELECT COUNT(*)::int FROM sot.people p
         WHERE p.merged_into_person_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sot.people t WHERE t.person_id = p.merged_into_person_id
           )
        ) AS orphaned_person_merges,

        -- Cats merged into non-existent target
        (SELECT COUNT(*)::int FROM sot.cats c
         WHERE c.merged_into_cat_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sot.cats t WHERE t.cat_id = c.merged_into_cat_id
           )
        ) AS orphaned_cat_merges,

        -- Places merged into non-existent target
        (SELECT COUNT(*)::int FROM sot.places p
         WHERE p.merged_into_place_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sot.places t WHERE t.place_id = p.merged_into_place_id
           )
        ) AS orphaned_place_merges,

        -- Valid merges (target exists)
        (
          (SELECT COUNT(*)::int FROM sot.people WHERE merged_into_person_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM sot.people t WHERE t.person_id = people.merged_into_person_id))
          +
          (SELECT COUNT(*)::int FROM sot.cats WHERE merged_into_cat_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM sot.cats t WHERE t.cat_id = cats.merged_into_cat_id))
          +
          (SELECT COUNT(*)::int FROM sot.places WHERE merged_into_place_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM sot.places t WHERE t.place_id = places.merged_into_place_id))
        ) AS valid_merges,

        -- Broken merges (target does not exist)
        (
          (SELECT COUNT(*)::int FROM sot.people WHERE merged_into_person_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM sot.people t WHERE t.person_id = people.merged_into_person_id))
          +
          (SELECT COUNT(*)::int FROM sot.cats WHERE merged_into_cat_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM sot.cats t WHERE t.cat_id = cats.merged_into_cat_id))
          +
          (SELECT COUNT(*)::int FROM sot.places WHERE merged_into_place_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM sot.places t WHERE t.place_id = places.merged_into_place_id))
        ) AS broken_merges
    `);

    return apiSuccess(result ?? {
      orphaned_person_merges: 0,
      orphaned_cat_merges: 0,
      orphaned_place_merges: 0,
      valid_merges: 0,
      broken_merges: 0,
    });
  } catch (error) {
    console.error("Merge integrity check error:", error);
    return apiServerError("Failed to check merge integrity");
  }
}
