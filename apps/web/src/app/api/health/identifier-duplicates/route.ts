import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Identifier Duplicates Health Check
 *
 * Detects email/phone identifiers assigned to multiple unmerged people.
 * After Data Engine, there should be 0 duplicate emails.
 * Used by data-quality-comprehensive.spec.ts
 *
 * Test expects: data.duplicate_emails === 0
 *
 * GET /api/health/identifier-duplicates
 */
export async function GET() {
  try {
    const result = await queryOne<{
      duplicate_emails: number;
      duplicate_phones: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM (
          SELECT id_value_norm
          FROM sot.person_identifiers pi
          JOIN sot.people p ON p.person_id = pi.person_id
          WHERE pi.id_type = 'email'
            AND pi.confidence >= 0.5
            AND p.merged_into_person_id IS NULL
          GROUP BY id_value_norm
          HAVING COUNT(DISTINCT pi.person_id) > 1
        ) dup_emails) AS duplicate_emails,

        (SELECT COUNT(*)::int FROM (
          SELECT id_value_norm
          FROM sot.person_identifiers pi
          JOIN sot.people p ON p.person_id = pi.person_id
          WHERE pi.id_type = 'phone'
            AND pi.confidence >= 0.5
            AND p.merged_into_person_id IS NULL
          GROUP BY id_value_norm
          HAVING COUNT(DISTINCT pi.person_id) > 1
        ) dup_phones) AS duplicate_phones
    `);

    return apiSuccess(result ?? {
      duplicate_emails: 0,
      duplicate_phones: 0,
    });
  } catch (error) {
    console.error("Identifier duplicates check error:", error);
    return apiServerError("Failed to check identifier duplicates");
  }
}
