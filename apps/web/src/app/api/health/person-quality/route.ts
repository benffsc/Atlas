import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Person Data Quality Health Check
 *
 * Reports on people with/without contact information (email or phone).
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.with_contact, data.total_unmerged_people
 *
 * GET /api/health/person-quality
 */
export async function GET() {
  try {
    const result = await queryOne<{
      total_unmerged_people: number;
      with_contact: number;
      people_without_contact: number;
      contact_rate: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM sot.people
         WHERE merged_into_person_id IS NULL AND canonical = TRUE
        ) AS total_unmerged_people,

        (SELECT COUNT(DISTINCT p.person_id)::int
         FROM sot.people p
         JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
         WHERE p.merged_into_person_id IS NULL
           AND p.canonical = TRUE
           AND pi.confidence >= 0.5
           AND pi.id_type IN ('email', 'phone')
        ) AS with_contact,

        (SELECT COUNT(*)::int FROM sot.people p
         WHERE p.merged_into_person_id IS NULL
           AND p.canonical = TRUE
           AND NOT EXISTS (
             SELECT 1 FROM sot.person_identifiers pi
             WHERE pi.person_id = p.person_id
               AND pi.confidence >= 0.5
               AND pi.id_type IN ('email', 'phone')
           )
        ) AS people_without_contact,

        CASE
          WHEN (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL AND canonical = TRUE) = 0 THEN 0
          ELSE ROUND(100.0 *
            (SELECT COUNT(DISTINCT p.person_id)
             FROM sot.people p
             JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
             WHERE p.merged_into_person_id IS NULL
               AND p.canonical = TRUE
               AND pi.confidence >= 0.5
               AND pi.id_type IN ('email', 'phone')
            ) /
            (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL AND canonical = TRUE)
          , 1)
        END AS contact_rate
    `);

    return apiSuccess(result ?? {
      total_unmerged_people: 0,
      with_contact: 0,
      people_without_contact: 0,
      contact_rate: 0,
    });
  } catch (error) {
    console.error("Person quality check error:", error);
    return apiServerError("Failed to check person quality");
  }
}
