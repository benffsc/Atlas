import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

// Entity Linking Cron Job
//
// Runs periodic entity linking operations using a 2-phase orchestrator:
//   Phase 1: Catch-up processing + steps 1-3 (appointment→place, cat→place)
//   Phase 2: Steps 4-6 (attribution, owner linking, request linking) + disease
//
// Each invocation picks up where the previous left off via ops.entity_linking_cycles.
// This keeps each run well under 60s even at 2x+ current data volume.
//
// Run every 15 minutes to ensure new submissions get properly linked.
//
// Phase 1D of long-term data strategy (FFS-900).
//
// Vercel Cron: "*/15 * * * *"

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
  // Step 3c: Adopter person_places from ShelterLuv (FFS-978/MIG_3008)
  step3c_adopters_checked?: number;
  step3c_person_places_created?: number;
  step3c_adopters_skipped?: number;
  step3c_cats_linked_from_new_places?: number;
  // Step 3d: ShelterLuv person_places (MIG_3013)
  step3d_people_checked?: number;
  step3d_person_places_created?: number;
  step3d_people_skipped?: number;
  step3d_cats_linked_from_new_places?: number;
  // Step 3e: Foster roles from person_cat evidence (MIG_3014/FFS-324)
  step3e_foster_roles_created?: number;
  // Step 4: Cat-Request Attribution (MIG_2825)
  step4_cats_linked_to_requests?: number;
  step4_stale_links_removed?: number;
  step4_before_request?: number;
  step4_during_request?: number;
  step4_grace_period?: number;
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

// Cycle tracking (MIG_3000)
interface CycleInfo {
  cycle_id: number;
  next_phase: number;
  is_new: boolean;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const startTime = Date.now();

  // Allow forcing legacy mode (all steps in one call) via query param
  const forceLegacy = request.nextUrl.searchParams.get("legacy") === "true";

  try {
    // MIG_2442: PREFLIGHT CHECK - Fail loudly if critical functions are missing
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
      console.warn(
        "Preflight check skipped (MIG_2442 not applied yet):",
        preflightError instanceof Error ? preflightError.message : "Unknown"
      );
    }

    if (!preflightPassed) {
      return apiServerError("Preflight check failed - critical functions missing. Apply missing migrations (MIG_2441, etc.) to fix.");
    }

    // Try phase-based orchestration (MIG_3000)
    let cycleInfo: CycleInfo | null = null;
    if (!forceLegacy) {
      try {
        cycleInfo = await queryOne<CycleInfo>(
          "SELECT * FROM ops.get_current_linking_cycle()"
        );
      } catch {
        // MIG_3000 not applied yet — fall back to legacy mode
        console.warn("Phase orchestrator not available, using legacy mode");
      }
    }

    // ========================================================================
    // PHASE-BASED MODE (MIG_3000)
    // ========================================================================
    if (cycleInfo) {
      const { cycle_id, next_phase } = cycleInfo;

      if (next_phase === 1) {
        // Phase 1: Catch-up + Steps 1-3
        const result = await runPhase1(startTime);
        await queryOne(
          "SELECT ops.complete_linking_phase($1, $2, $3, $4)",
          [cycle_id, 1, JSON.stringify(result.phaseResult), result.durationMs]
        );

        return apiSuccess({
          message: `Phase 1 complete (cycle ${cycle_id}). Phase 2 next invocation.`,
          mode: "phased",
          cycle_id,
          phase: 1,
          ...result.response,
          duration_ms: Date.now() - startTime,
        });
      } else if (next_phase === 2) {
        // Phase 2: Steps 4-6 + Disease
        const result = await runPhase2(startTime);
        await queryOne(
          "SELECT ops.complete_linking_phase($1, $2, $3, $4)",
          [cycle_id, 2, JSON.stringify(result.phaseResult), result.durationMs]
        );

        return apiSuccess({
          message: `Phase 2 complete (cycle ${cycle_id}). Full cycle done.`,
          mode: "phased",
          cycle_id,
          phase: 2,
          ...result.response,
          duration_ms: Date.now() - startTime,
        });
      } else {
        // Phase > 2 means cycle is already complete — shouldn't happen but handle gracefully
        return apiSuccess({
          message: `Cycle ${cycle_id} already complete, will start new cycle next run.`,
          mode: "phased",
          cycle_id,
          duration_ms: Date.now() - startTime,
        });
      }
    }

    // ========================================================================
    // LEGACY MODE (pre-MIG_3000 or forced)
    // ========================================================================
    return await runLegacyMode(request, startTime);
  } catch (error) {
    console.error("Entity linking cron error:", error);
    return apiServerError(error instanceof Error ? error.message : "Entity linking failed");
  }
}

// Phase 1: Catch-up + Steps 1-3 (appointment→place, cat→place linking)
async function runPhase1(startTime: number) {
  const catchup = await runCatchupProcessing();

  // Run steps 1-3 via the orchestrator SQL
  // We call individual linking functions directly instead of run_all_entity_linking()
  const phaseResult: Record<string, unknown> = { catchup };
  const warnings: string[] = [];

  // Step 1: Link appointments to places (CRITICAL)
  try {
    const step1Rows = await queryRows<{
      source: string;
      appointments_linked: number;
      appointments_unmatched: number;
    }>("SELECT * FROM sot.link_appointments_to_places()");

    for (const row of step1Rows) {
      phaseResult[`step1_${row.source}_linked`] = row.appointments_linked;
      phaseResult[`step1_${row.source}_unmatched`] = row.appointments_unmatched;
    }

    const coverageRow = await queryOne<{ total: number; with_place: number; pct: number }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL)::int AS with_place,
        ROUND(100.0 * COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct
      FROM ops.appointments
    `);

    if (coverageRow) {
      phaseResult.step1_total_appointments = coverageRow.total;
      phaseResult.step1_with_inferred_place = coverageRow.with_place;
      phaseResult.step1_coverage_pct = coverageRow.pct;
    }
  } catch (e) {
    // Step 1 failure is critical — abort phase
    phaseResult.step1_error = e instanceof Error ? e.message : "Unknown";
    warnings.push("CRITICAL: step1 failed");
    phaseResult.warnings = warnings;
    phaseResult.status = "failed";
    return {
      phaseResult,
      durationMs: Date.now() - startTime,
      response: { catchup, results: phaseResult },
    };
  }

  // Step 2: Link cats to places via appointments (PRIMARY)
  try {
    const step2 = await queryOne<{ cats_linked: number; cats_skipped: number }>(
      "SELECT * FROM sot.link_cats_to_appointment_places()"
    );
    phaseResult.step2_cats_linked = step2?.cats_linked || 0;
    phaseResult.step2_cats_skipped = step2?.cats_skipped || 0;
  } catch (e) {
    phaseResult.step2_error = e instanceof Error ? e.message : "Unknown";
    phaseResult.step2_cats_linked = 0;
    warnings.push("step2 failed");
  }

  // Step 3: Link cats to places via person chain (SECONDARY)
  try {
    const step3 = await queryOne<{ total_edges: number }>(
      "SELECT * FROM sot.link_cats_to_places()"
    );
    phaseResult.step3_cats_linked = step3?.total_edges || 0;
  } catch (e) {
    phaseResult.step3_error = e instanceof Error ? e.message : "Unknown";
    phaseResult.step3_cats_linked = 0;
    warnings.push("step3 failed");
  }

  // Step 3b: Ensure adopter person_places from ShelterLuv (FFS-978/MIG_3008)
  try {
    const step3b = await queryOne<{
      adopters_checked: number;
      person_places_created: number;
      adopters_skipped: number;
    }>("SELECT * FROM sot.ensure_adopter_person_places()");
    phaseResult.step3b_person_places_created = step3b?.person_places_created || 0;
    phaseResult.step3b_adopters_skipped = step3b?.adopters_skipped || 0;

    // Re-run Step 3 if new person_places were created
    if ((step3b?.person_places_created || 0) > 0) {
      const rerun = await queryOne<{ total_edges: number }>(
        "SELECT * FROM sot.link_cats_to_places()"
      );
      phaseResult.step3b_cats_linked_from_new_places = rerun?.total_edges || 0;
    }
  } catch (e) {
    phaseResult.step3b_error = e instanceof Error ? e.message : "Unknown";
    warnings.push("step3b failed");
  }

  // Step 3c: Ensure ShelterLuv person_places (MIG_3013)
  try {
    const step3c = await queryOne<{
      people_checked: number;
      person_places_created: number;
      people_skipped: number;
    }>("SELECT * FROM sot.ensure_shelterluv_person_places()");
    phaseResult.step3c_people_checked = step3c?.people_checked || 0;
    phaseResult.step3c_person_places_created = step3c?.person_places_created || 0;
    phaseResult.step3c_people_skipped = step3c?.people_skipped || 0;

    // Re-run Step 3 if new person_places were created
    if ((step3c?.person_places_created || 0) > 0) {
      const rerun = await queryOne<{ total_edges: number }>(
        "SELECT * FROM sot.link_cats_to_places()"
      );
      phaseResult.step3c_cats_linked_from_new_places = rerun?.total_edges || 0;
    }
  } catch (e) {
    phaseResult.step3c_error = e instanceof Error ? e.message : "Unknown";
    warnings.push("step3c_shelterluv_places failed");
  }

  // Step 3d: Ensure foster roles from person_cat evidence (MIG_3014/FFS-324)
  try {
    const step3d = await queryOne<{ roles_created: number }>(
      "SELECT * FROM sot.ensure_foster_roles_from_person_cat()"
    );
    phaseResult.step3d_foster_roles_created = step3d?.roles_created || 0;
  } catch (e) {
    phaseResult.step3d_error = e instanceof Error ? e.message : "Unknown";
    warnings.push("step3d_foster_roles failed");
  }

  if (warnings.length > 0) phaseResult.warnings = warnings;
  phaseResult.status = warnings.some((w) => w.startsWith("CRITICAL"))
    ? "failed"
    : warnings.length > 0
      ? "partial_failure"
      : "completed";

  const totalLinked =
    ((phaseResult.step2_cats_linked as number) || 0) +
    ((phaseResult.step3_cats_linked as number) || 0) +
    ((phaseResult.step3b_cats_linked_from_new_places as number) || 0) +
    ((phaseResult.step3c_cats_linked_from_new_places as number) || 0);

  return {
    phaseResult,
    durationMs: Date.now() - startTime,
    response: {
      catchup,
      results: phaseResult,
      total_linked: totalLinked,
    },
  };
}

// Phase 2: Steps 4-6 (attribution, owner linking, request linking) + disease
async function runPhase2(startTime: number) {
  const phaseResult: Record<string, unknown> = {};
  const warnings: string[] = [];

  // Step 4: Cat-Request Attribution
  try {
    const staleRemoved = await queryOne<{ cleanup_stale_request_cat_links: number }>(
      "SELECT sot.cleanup_stale_request_cat_links()"
    );
    const step4 = await queryOne<{
      linked: number;
      before_request: number;
      during_request: number;
      grace_period: number;
    }>("SELECT * FROM sot.link_cats_to_requests_attribution()");

    phaseResult.step4_cats_linked_to_requests = step4?.linked || 0;
    phaseResult.step4_stale_links_removed = staleRemoved?.cleanup_stale_request_cat_links || 0;
    phaseResult.step4_before_request = step4?.before_request || 0;
    phaseResult.step4_during_request = step4?.during_request || 0;
    phaseResult.step4_grace_period = step4?.grace_period || 0;
  } catch (e) {
    phaseResult.step4_error = e instanceof Error ? e.message : "Unknown";
    warnings.push("step4 failed");
  }

  // Step 5: Link appointments to owners via email
  try {
    const step5 = await queryOne<{
      appointments_updated: number;
      persons_linked: number;
    }>("SELECT * FROM sot.link_appointments_to_owners()");

    phaseResult.step5_appointments_linked_to_owners = step5?.appointments_updated || 0;
    phaseResult.step5_persons_linked = step5?.persons_linked || 0;
  } catch (e) {
    phaseResult.step5_error = e instanceof Error ? e.message : "Unknown";
    warnings.push("step5 failed");
  }

  // Step 6: Link appointments to requests
  try {
    const step6 = await queryOne<{
      tier1_linked: number;
      tier2_queued: number;
      tier3_queued: number;
    }>("SELECT * FROM ops.link_appointments_to_requests()");

    phaseResult.step6_appointments_linked_to_requests_tier1 = step6?.tier1_linked || 0;
    phaseResult.step6_appointments_queued_tier2 = step6?.tier2_queued || 0;
    phaseResult.step6_appointments_queued_tier3 = step6?.tier3_queued || 0;
  } catch (e) {
    phaseResult.step6_error = e instanceof Error ? e.message : "Unknown";
    warnings.push("step6 failed");
  }

  // Final validation: coverage metrics
  try {
    const coverage = await queryOne<{
      total_cats: number;
      cats_with_place: number;
      pct: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL)::int AS total_cats,
        (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place)::int AS cats_with_place,
        ROUND(100.0 *
          (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place) /
          NULLIF((SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 0), 1
        ) AS pct
    `);

    if (coverage) {
      phaseResult.total_cats = coverage.total_cats;
      phaseResult.cats_with_place_link = coverage.cats_with_place;
      phaseResult.cat_coverage_pct = coverage.pct;
    }
  } catch {
    // Non-fatal
  }

  // Disease computation
  let diseaseResults: Record<string, unknown> = {};
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
    }
  } catch (e) {
    console.warn("Disease status computation skipped:", e instanceof Error ? e.message : "Unknown");
  }

  if (warnings.length > 0) phaseResult.warnings = warnings;
  phaseResult.status = warnings.length > 0 ? "partial_failure" : "completed";

  return {
    phaseResult,
    durationMs: Date.now() - startTime,
    response: {
      results: phaseResult,
      disease: diseaseResults,
    },
  };
}

// Catch-up processing (shared between legacy and phased modes)
async function runCatchupProcessing(): Promise<Record<string, unknown>> {
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

  try {
    const unchippedCats = await queryOne(
      "SELECT * FROM ops.process_clinichq_unchipped_cats(500)"
    );
    catchup.unchipped_cats = unchippedCats;
  } catch (e) {
    catchup.unchipped_cats_error = e instanceof Error ? e.message : "Unknown";
  }

  try {
    const euthanasia = await queryOne(
      "SELECT * FROM ops.process_clinic_euthanasia(500)"
    );
    catchup.euthanasia = euthanasia;
  } catch (e) {
    catchup.euthanasia_error = e instanceof Error ? e.message : "Unknown";
  }

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

  return catchup;
}

// Legacy mode: all steps in one call (pre-MIG_3000 behavior)
async function runLegacyMode(request: NextRequest, startTime: number) {
  // Step 1: Catch-up processing
  const catchup = await runCatchupProcessing();

  // Step 2: Run all entity linking operations
  const linkingResult = await queryOne<{ run_all_entity_linking: EntityLinkingJsonResult }>(
    "SELECT sot.run_all_entity_linking() as run_all_entity_linking"
  );

  const summary: Record<string, number | string | string[] | undefined> = {};
  let totalLinked = 0;

  if (linkingResult?.run_all_entity_linking) {
    const r = linkingResult.run_all_entity_linking;

    summary.step1_appointments_with_place = r.step1_with_inferred_place;
    summary.step1_coverage_pct = r.step1_coverage_pct;
    summary.step2_cats_via_appointments = r.step2_cats_linked;
    summary.step2_cats_skipped = r.step2_cats_skipped;
    summary.step3_cats_via_person_chain = r.step3_cats_linked;
    summary.step3b_adopter_places_created = r.step3c_person_places_created;
    summary.step3c_shelterluv_places_created = r.step3d_person_places_created;
    summary.step3d_foster_roles_created = r.step3e_foster_roles_created;
    summary.step4_cats_linked_to_requests = r.step4_cats_linked_to_requests;
    summary.step4_stale_links_removed = r.step4_stale_links_removed;
    summary.cat_coverage_pct = r.cat_coverage_pct;
    summary.run_id = r.run_id;
    summary.status = r.status;

    if (r.warnings && r.warnings.length > 0) {
      summary.warnings = r.warnings;
    }

    totalLinked = (r.step2_cats_linked || 0) + (r.step3_cats_linked || 0);
  }

  // Step 3: Disease computation
  let diseaseResults: Record<string, unknown> = {};
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
    console.warn("Disease status computation skipped:", e instanceof Error ? e.message : "Unknown");
  }

  return apiSuccess({
    message: totalLinked > 0
      ? `Linked ${totalLinked} entities`
      : "No new entities to link",
    mode: "legacy",
    catchup,
    results: summary,
    disease: diseaseResults,
    total_linked: totalLinked,
    duration_ms: Date.now() - startTime,
  });
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
