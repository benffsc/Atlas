import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

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
      `SELECT * FROM trapper.v_data_quality_summary`
    );

    // Get email duplicates (top 50)
    const emailDuplicates = await queryRows<DuplicateGroup>(
      `SELECT * FROM trapper.v_potential_email_duplicates LIMIT 50`
    );

    // Get garbage names (top 50)
    const garbageNames = await queryRows<GarbageName>(
      `SELECT person_id, display_name, primary_email, pattern_type
       FROM trapper.v_names_with_garbage_patterns
       LIMIT 50`
    );

    return NextResponse.json({
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
    return NextResponse.json(
      { error: "Failed to fetch data quality stats" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, canonical_id, duplicate_id, dry_run } = body;

    // Merge single duplicate
    if (action === "merge_one" && canonical_id && duplicate_id) {
      const result = await queryOne<{ merge_duplicate_person: object }>(
        `SELECT trapper.merge_duplicate_person($1, $2, 'manual_admin_merge') as result`,
        [canonical_id, duplicate_id]
      );

      return NextResponse.json({
        success: true,
        action: "merge_one",
        result: result?.merge_duplicate_person,
      });
    }

    // Batch merge all email duplicates
    if (action === "merge_all_email") {
      const isDryRun = dry_run !== false; // Default to dry run for safety

      const result = await queryOne<{
        emails_found: number;
        people_to_merge: number;
        merges_executed: number;
        errors: number;
        sample_merges: object;
      }>(
        `SELECT * FROM trapper.merge_email_duplicates($1)`,
        [isDryRun]
      );

      return NextResponse.json({
        success: true,
        action: "merge_all_email",
        dry_run: isDryRun,
        ...result,
      });
    }

    // Batch clean garbage names
    if (action === "clean_names") {
      const isDryRun = dry_run !== false; // Default to dry run for safety

      const result = await queryOne<{
        names_found: number;
        names_cleaned: number;
        names_unchanged: number;
        errors: number;
        sample_changes: object;
      }>(
        `SELECT * FROM trapper.clean_garbage_names($1)`,
        [isDryRun]
      );

      return NextResponse.json({
        success: true,
        action: "clean_names",
        dry_run: isDryRun,
        ...result,
      });
    }

    // Batch merge phone duplicates (same name only)
    if (action === "merge_all_phone") {
      const isDryRun = dry_run !== false; // Default to dry run for safety

      const result = await queryOne<{
        phones_found: number;
        people_to_merge: number;
        merges_executed: number;
        errors: number;
        sample_merges: object;
      }>(
        `SELECT * FROM trapper.merge_phone_duplicates($1)`,
        [isDryRun]
      );

      return NextResponse.json({
        success: true,
        action: "merge_all_phone",
        dry_run: isDryRun,
        ...result,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Use: merge_one, merge_all_email, merge_all_phone, clean_names" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error processing duplicate action:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Action failed",
        success: false,
      },
      { status: 500 }
    );
  }
}
