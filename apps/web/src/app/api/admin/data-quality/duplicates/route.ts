import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

/**
 * Data Quality - Duplicate Management API
 *
 * GET: Return current duplicate stats and list of potential duplicates
 * POST: Execute merge operations (single or batch)
 */

interface DuplicateGroup {
  primary_email: string;
  person_count: number;
  person_ids: string[];
  names: string[];
  data_sources: string[];
  earliest_created: string;
  latest_created: string;
}

interface DataQualitySummary {
  email_duplicates: number;
  email_excess_records: number;
  phone_duplicates: number;
  phone_excess_records: number;
  garbage_names: number;
  active_people: number;
  merged_people: number;
  merges_last_7_days: number;
  merges_last_24h: number;
}

interface GarbageName {
  person_id: string;
  display_name: string;
  primary_email: string;
  pattern_type: string;
}

export async function GET() {
  try {
    // Get summary stats
    const summary = await queryOne<DataQualitySummary>(
      `SELECT * FROM ops.v_data_quality_summary`
    );

    // Get email duplicates (top 50)
    const emailDuplicates = await queryRows<DuplicateGroup>(
      `SELECT * FROM ops.v_potential_email_duplicates LIMIT 50`
    );

    // Get garbage names (top 50)
    const garbageNames = await queryRows<GarbageName>(
      `SELECT person_id, display_name, primary_email, pattern_type
       FROM ops.v_names_with_garbage_patterns
       LIMIT 50`
    );

    return apiSuccess({
      summary: summary || {
        email_duplicates: 0,
        email_excess_records: 0,
        phone_duplicates: 0,
        phone_excess_records: 0,
        garbage_names: 0,
        active_people: 0,
        merged_people: 0,
        merges_last_7_days: 0,
        merges_last_24h: 0,
      },
      email_duplicates: emailDuplicates || [],
      garbage_names: garbageNames || [],
    });
  } catch (error) {
    console.error("Error fetching data quality stats:", error);
    return apiServerError("Failed to fetch data quality stats");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, canonical_id, duplicate_id, dry_run } = body;

    // Merge single duplicate — merge_person_into(loser, winner, reason, changed_by)
    if (action === "merge_one" && canonical_id && duplicate_id) {
      await queryOne(
        `SELECT sot.merge_person_into($1, $2, 'manual_admin_merge', NULL)`,
        [duplicate_id, canonical_id]
      );

      return apiSuccess({
        action: "merge_one",
        merged: { loser: duplicate_id, winner: canonical_id },
      });
    }

    // Batch merge all email duplicates
    // NOTE: sot.merge_email_duplicates() does not exist yet. Gracefully error.
    if (action === "merge_all_email") {
      return apiBadRequest("Batch email dedup is not yet implemented. Use merge_one to merge individual duplicates.");
    }

    // Batch clean garbage names
    // NOTE: ops.clean_garbage_names() exists but batch mode needs verification
    if (action === "clean_names") {
      const isDryRun = dry_run !== false;
      try {
        const result = await queryOne<{
          names_found: number;
          names_cleaned: number;
          names_unchanged: number;
          errors: number;
          sample_changes: object;
        }>(
          `SELECT * FROM ops.clean_garbage_names($1)`,
          [isDryRun]
        );
        return apiSuccess({ action: "clean_names", dry_run: isDryRun, ...result });
      } catch {
        return apiBadRequest("Batch name cleanup function is not available. Run manually via SQL.");
      }
    }

    // Batch merge phone duplicates (same name only)
    // NOTE: sot.merge_phone_duplicates() does not exist yet. Gracefully error.
    if (action === "merge_all_phone") {
      return apiBadRequest("Batch phone dedup is not yet implemented. Use merge_one to merge individual duplicates.");
    }

    return apiBadRequest("Invalid action. Use: merge_one, merge_all_email, merge_all_phone, clean_names");
  } catch (error) {
    console.error("Error processing duplicate action:", error);
    return apiServerError(error instanceof Error ? error.message : "Action failed");
  }
}
