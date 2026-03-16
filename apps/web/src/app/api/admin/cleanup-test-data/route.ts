import { query } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";

/**
 * Admin endpoint to clean up E2E test data.
 * Only available in development/test environments.
 *
 * POST /api/admin/cleanup-test-data
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return apiError("Not available in production", 403);
  }

  const results: Record<string, number> = {};

  // Delete in dependency order: relationships first, then entities
  const cleanupSteps = [
    { label: "cat_place", sql: "DELETE FROM sot.cat_place WHERE evidence_type = 'e2e_test'" },
    { label: "person_cat", sql: "DELETE FROM sot.person_cat WHERE evidence_type = 'e2e_test'" },
    { label: "person_place", sql: "DELETE FROM sot.person_place WHERE evidence_type = 'e2e_test'" },
    { label: "journal_entries", sql: "DELETE FROM ops.journal_entries WHERE created_by = 'e2e_test' OR body LIKE 'e2e-test-%'" },
    { label: "map_annotations", sql: "DELETE FROM ops.map_annotations WHERE created_by = 'e2e_test' OR label LIKE 'e2e-test-%'" },
    { label: "intake_submissions", sql: "DELETE FROM ops.intake_submissions WHERE submission_id::text LIKE 'e2e-test-%' OR email LIKE 'e2e-%@test.example.com'" },
    { label: "requests", sql: "DELETE FROM ops.requests WHERE source_system = 'e2e_test' OR request_id::text LIKE 'e2e-test-%' OR summary LIKE 'E2E Test -%' OR notes LIKE '%E2E_TEST_MARKER%' OR internal_notes LIKE '%E2E_TEST_MARKER%'" },
    { label: "places", sql: "DELETE FROM sot.places WHERE source_system = 'e2e_test'" },
    { label: "people", sql: "DELETE FROM sot.people WHERE source_system = 'e2e_test'" },
    { label: "cats", sql: "DELETE FROM sot.cats WHERE source_system = 'e2e_test'" },
  ];

  for (const step of cleanupSteps) {
    const res = await query(step.sql);
    results[step.label] = res.rowCount ?? 0;
  }

  return apiSuccess({ deleted: results });
}
