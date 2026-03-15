import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Review Queues Health Check
 *
 * Reports on pending review queue sizes (org/address persons, first-name-only, etc.).
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.org_person_review >= 0, data.firstname_only_review >= 0
 *
 * GET /api/health/review-queues
 */
export async function GET() {
  try {
    const result = await queryOne<{
      org_person_review: number;
      firstname_only_review: number;
      pending_reviews: number;
      high_priority: number;
    }>(`
      SELECT
        -- Org/address persons needing review
        (SELECT COUNT(*)::int FROM sot.people
         WHERE merged_into_person_id IS NULL
           AND is_organization = TRUE
        ) AS org_person_review,

        -- People with first name only (no last name)
        (SELECT COUNT(*)::int FROM sot.people
         WHERE merged_into_person_id IS NULL
           AND canonical = TRUE
           AND (last_name IS NULL OR last_name = '')
           AND first_name IS NOT NULL
           AND first_name != ''
        ) AS firstname_only_review,

        -- Total pending reviews (combined)
        (SELECT COUNT(*)::int FROM sot.people
         WHERE merged_into_person_id IS NULL
           AND (is_organization = TRUE
             OR ((last_name IS NULL OR last_name = '') AND first_name IS NOT NULL AND first_name != ''))
        ) AS pending_reviews,

        -- High priority: orgs that may be real people
        (SELECT COUNT(*)::int FROM sot.people
         WHERE merged_into_person_id IS NULL
           AND is_organization = TRUE
           AND EXISTS (
             SELECT 1 FROM sot.person_identifiers pi
             WHERE pi.person_id = people.person_id
               AND pi.confidence >= 0.5
           )
        ) AS high_priority
    `);

    return apiSuccess(result ?? {
      org_person_review: 0,
      firstname_only_review: 0,
      pending_reviews: 0,
      high_priority: 0,
    });
  } catch (error) {
    console.error("Review queues check error:", error);
    return apiServerError("Failed to check review queues");
  }
}
