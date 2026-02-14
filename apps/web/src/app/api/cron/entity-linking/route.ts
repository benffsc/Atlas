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

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // Step 1: Catch-up processing for any unprocessed ClinicHQ records
    // This is the safety net — ensures data gets processed even if job queue missed it
    const catchup: Record<string, unknown> = {};

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
    const results = await queryRows<LinkingResult>(
      "SELECT * FROM sot.run_all_entity_linking()"
    );

    // Build summary
    const summary: Record<string, number> = {};
    let totalLinked = 0;

    for (const row of results) {
      summary[row.operation] = row.count;
      totalLinked += row.count;
    }

    return NextResponse.json({
      success: true,
      message: totalLinked > 0
        ? `Linked ${totalLinked} entities`
        : "No new entities to link",
      catchup,
      results: summary,
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
