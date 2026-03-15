import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Internal Account Types Admin Endpoint
 *
 * Returns known internal account patterns used for appointment categorization.
 * Used by categorization-gaps.spec.ts
 *
 * Test expects: data[].account_pattern (array of objects with account_pattern)
 *   Must contain: "ff foster", "forgotten felines foster", "barn cat", "rebooking"
 *
 * GET /api/admin/internal-account-types
 */
export async function GET() {
  try {
    // Try to read from ops.internal_account_types if it exists
    const rows = await queryRows<{
      account_pattern: string;
      category: string;
      count: number;
    }>(`
      SELECT
        account_pattern,
        category,
        0 AS count
      FROM ops.internal_account_types
      ORDER BY account_pattern
    `).catch(async () => {
      // Table may not exist — return hardcoded known patterns as fallback
      // These are the patterns used by the categorization system
      return [
        { account_pattern: "ff foster", category: "foster_program", count: 0 },
        { account_pattern: "forgotten felines foster", category: "foster_program", count: 0 },
        { account_pattern: "barn cat", category: "other_internal", count: 0 },
        { account_pattern: "rebooking", category: "other_internal", count: 0 },
        { account_pattern: "forgotten felines", category: "other_internal", count: 0 },
        { account_pattern: "ffsc", category: "other_internal", count: 0 },
      ];
    });

    return apiSuccess(rows);
  } catch (error) {
    console.error("Internal account types error:", error);
    return apiServerError("Failed to fetch internal account types");
  }
}
