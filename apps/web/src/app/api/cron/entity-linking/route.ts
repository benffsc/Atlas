import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

// Entity Linking Cron Job
//
// Runs periodic entity linking operations:
// 1. Catch-up: Process any unprocessed ClinicHQ staged records
// 2. Entity linking: Link cats/people/places/requests across all sources
//
// The catch-up step ensures that even if the job queue missed records,
// they get processed within 15 minutes (safety net for DQ_CLINIC_001).
//
// Run every 15-30 minutes to ensure new submissions get properly linked.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/entity-linking", "schedule": "every-15-min" }]

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

interface LinkingResult {
  operation: string;
  count: number;
}

// MIG_2432 changed run_all_entity_linking() to return JSONB with validation
interface EntityLinkingJsonResult {
  step1_total_appointments?: number;
  step1_with_inferred_place?: number;
  step1_coverage_pct?: number;
  step2_cats_linked?: number;
  step2_cats_skipped?: number;
  step3_cats_linked?: number;
  total_cats?: number;
  cats_with_place_link?: number;
  cat_coverage_pct?: number;
  duration_ms?: number;
  run_id?: number;
  warnings?: string[];
  status?: string;
}

// Preflight check result type
interface PreflightCheck {
  check_name: string;
  status: "PASS" | "WARN" | "FAIL";
  details: string;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // MIG_2442: PREFLIGHT CHECK - Fail loudly if critical functions are missing
    // This prevents silent data loss from missing V1→V2 function migrations
    let preflightPassed = true;
    let preflightResults: PreflightCheck[] = [];

    try {
      preflightResults = await queryRows<PreflightCheck>(
        "SELECT * FROM ops.preflight_entity_linking()"
      );

      const failures = preflightResults.filter((p) => p.status === "FAIL");
      if (failures.length > 0) {
        preflightPassed = false;
        console.error(
          "Entity linking preflight FAILED:",
          failures.map((f) => f.details).join("; ")
        );
      }
    } catch (preflightError) {
      // If preflight function doesn't exist yet, log warning but continue
      // This allows the cron to work before MIG_2442 is applied
      console.warn(
        "Preflight check skipped (MIG_2442 not applied yet):",
        preflightError instanceof Error ? preflightError.message : "Unknown"
      );
    }

    // FAIL LOUDLY if critical functions are missing
    if (!preflightPassed) {
      return NextResponse.json(
        {
          success: false,
          error: "Preflight check failed - critical functions missing",
          preflight: preflightResults,
          message:
            "CRITICAL: Entity linking aborted. Apply missing migrations (MIG_2441, etc.) to fix.",
          duration_ms: Date.now() - startTime,
        },
        { status: 500 }
      );
    }

    // Step 1: Catch-up processing for any unprocessed ClinicHQ records
    // This is the safety net — ensures data gets processed even if job queue missed it
    const catchup: Record<string, unknown> = {};
    const criticalErrors: string[] = [];

    try {
      const catInfo = await queryOne(
        "SELECT * FROM ops.process_clinichq_cat_info(500)"
      );
      catchup.cat_info = catInfo;
    } catch (e) {
      catchup.cat_info_error = e instanceof Error ? e.message : "Unknown";
    }

    try {
      const ownerInfo = await queryOne(
        "SELECT * FROM ops.process_clinichq_owner_info(500)"
      );
      catchup.owner_info = ownerInfo;
    } catch (e) {
      catchup.owner_info_error = e instanceof Error ? e.message : "Unknown";
    }

    // Step 1b2: Process ALL addresses (MIG_2443)
    // Creates places for addresses even when should_be_person() returns FALSE
    // (orgs, address-as-names, etc.) - fixes gap where TS route created places
    // but SQL processor didn't
    try {
      const addresses = await queryOne(
        "SELECT * FROM ops.process_clinichq_addresses(500)"
      );
      if (addresses && (addresses as { places_created: number }).places_created > 0) {
        catchup.addresses = addresses;
      }
    } catch (e) {
      catchup.addresses_error = e instanceof Error ? e.message : "Unknown";
    }

    // Step 1c: Process unchipped cats (MIG_891)
    // Creates cat records for cats without microchips using clinichq_animal_id
    try {
      const unchippedCats = await queryOne(
        "SELECT * FROM ops.process_clinichq_unchipped_cats(500)"
      );
      catchup.unchipped_cats = unchippedCats;
    } catch (e) {
      catchup.unchipped_cats_error = e instanceof Error ? e.message : "Unknown";
    }

    // Step 1d: Process euthanasia appointments (MIG_892)
    // Marks cats as deceased and creates mortality events
    try {
      const euthanasia = await queryOne(
        "SELECT * FROM ops.process_clinic_euthanasia(500)"
      );
      catchup.euthanasia = euthanasia;
    } catch (e) {
      catchup.euthanasia_error = e instanceof Error ? e.message : "Unknown";
    }

    // Step 1e: Process embedded microchips in Animal Name (MIG_911)
    // Safely extracts chips from "CatName - A439019 - 981020039875779" patterns
    try {
      const embeddedChips = await queryRows<LinkingResult>(
        "SELECT * FROM ops.process_embedded_microchips_in_animal_names()"
      );
      const chipsLinked = embeddedChips.reduce((sum, r) => sum + r.count, 0);
      if (chipsLinked > 0) {
        catchup.embedded_chips = embeddedChips;
      }
    } catch (e) {
      catchup.embedded_chips_error = e instanceof Error ? e.message : "Unknown";
    }

    // Step 1f: Retry unmatched master list entries (MIG_900)
    // Matches shelter/foster entries when ShelterLuv/VolunteerHub data arrives late
    try {
      const retryMatches = await queryRows<{
        clinic_date: string;
        entries_matched: number;
        match_method: string;
      }>("SELECT * FROM ops.retry_unmatched_master_list_entries()");
      if (retryMatches.length > 0) {
        catchup.master_list_retry = retryMatches;
      }
    } catch (e) {
      catchup.master_list_retry_error = e instanceof Error ? e.message : "Unknown";
    }

    // Step 2: Run all entity linking operations
    // MIG_2432: Function now returns JSONB with validation metrics
    const linkingResult = await queryOne<{ run_all_entity_linking: EntityLinkingJsonResult }>(
      "SELECT sot.run_all_entity_linking() as run_all_entity_linking"
    );

    // Build summary from JSONB result
    const summary: Record<string, number | string | string[] | undefined> = {};
    let totalLinked = 0;

    if (linkingResult?.run_all_entity_linking) {
      const r = linkingResult.run_all_entity_linking;

      // Extract counts for summary
      summary.step1_appointments_with_place = r.step1_with_inferred_place;
      summary.step1_coverage_pct = r.step1_coverage_pct;
      summary.step2_cats_via_appointments = r.step2_cats_linked;
      summary.step2_cats_skipped = r.step2_cats_skipped;
      summary.step3_cats_via_person_chain = r.step3_cats_linked;
      summary.cat_coverage_pct = r.cat_coverage_pct;
      summary.run_id = r.run_id;
      summary.status = r.status;

      if (r.warnings && r.warnings.length > 0) {
        summary.warnings = r.warnings;
      }

      // Total linked = cats linked via both methods
      totalLinked = (r.step2_cats_linked || 0) + (r.step3_cats_linked || 0);
    }

    // Step 3: Run disease status computation and sync flags
    // This updates ops.place_disease_status and syncs sot.places.disease_risk
    // MIG_2315: Reconciles disease_risk flags with actual test data
    let diseaseResults: {
      places_processed?: number;
      cats_with_tests?: number;
      disease_statuses_created?: number;
      flags_set_true?: number;
      flags_set_false?: number;
    } = {};

    try {
      const diseaseRow = await queryOne<{
        places_processed: number;
        cats_with_tests: number;
        disease_statuses_created: number;
        flags_set_true: number;
        flags_set_false: number;
      }>("SELECT * FROM ops.run_disease_status_computation()");

      if (diseaseRow) {
        diseaseResults = diseaseRow;
        summary["disease_statuses_computed"] = diseaseRow.disease_statuses_created || 0;
        summary["disease_flags_set_true"] = diseaseRow.flags_set_true || 0;
        summary["disease_flags_set_false"] = diseaseRow.flags_set_false || 0;
      }
    } catch (e) {
      // Function may not exist yet (pre-MIG_2315) - non-fatal
      console.warn("Disease status computation skipped:", e instanceof Error ? e.message : "Unknown");
    }

    return NextResponse.json({
      success: true,
      message: totalLinked > 0
        ? `Linked ${totalLinked} entities`
        : "No new entities to link",
      catchup,
      results: summary,
      disease: diseaseResults,
      total_linked: totalLinked,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Entity linking cron error:", error);
    return NextResponse.json(
      {
        error: "Entity linking failed",
        details: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
