import { withTransaction } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { NextResponse } from "next/server";

/**
 * Entity Linking Health Check (FFS-294)
 *
 * Verifies critical entity linking invariants:
 * - Clinic address leakage = 0 (MIG_2430)
 * - Cat-place coverage metrics
 * - Orphan cats (no place AND no person)
 * - Merge chain integrity (circular/deep chains)
 * - Skipped entity reasons
 * - Confidence integrity (MIG_2860)
 *
 * Uses a 10-second statement_timeout to prevent long-running queries
 * from blocking the health check endpoint.
 *
 * GET /api/health/entity-linking
 */
export async function GET() {
  try {
    const data = await withTransaction(async (tx) => {
      // Set 10-second timeout for the entire health check
      await tx.query("SET LOCAL statement_timeout = '10000'");

      // Check clinic leakage via V2 table (sot.cat_place)
      const clinicLeakage = await tx.queryOne<{ count: number }>(`
        SELECT COUNT(*)::int as count
        FROM sot.cat_place cp
        JOIN sot.places p ON p.place_id = cp.place_id
        WHERE ops.is_clinic_address(p.formatted_address)
        AND p.merged_into_place_id IS NULL
      `);

      // Cat-place coverage (V2: sot.cat_place)
      const coverage = await tx.queryOne<{
        total_cats: number;
        cats_with_place: number;
        coverage_pct: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM sot.cats WHERE merged_into_cat_id IS NULL) as total_cats,
          (SELECT COUNT(DISTINCT cat_id)::int FROM sot.cat_place) as cats_with_place,
          CASE
            WHEN (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) = 0 THEN 0
            ELSE ROUND(100.0 * (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place)
              / (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 1)
          END as coverage_pct
      `);

      // Orphan cats: no place AND no person links (FFS-294)
      let orphanCats: { count: number } | null = null;
      try {
        await tx.query("SAVEPOINT sp_orphan");
        orphanCats = await tx.queryOne<{ count: number }>(`
          SELECT COUNT(*)::int as count
          FROM sot.cats c
          WHERE c.merged_into_cat_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM sot.cat_place WHERE cat_id = c.cat_id)
            AND NOT EXISTS (SELECT 1 FROM sot.person_cat WHERE cat_id = c.cat_id)
        `);
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT sp_orphan");
        orphanCats = { count: 0 };
      }

      // Merge chain integrity: detect circular or deep chains (FFS-294)
      let mergeChainIssues: {
        deep_cat_chains: number;
        deep_place_chains: number;
        deep_person_chains: number;
      } | null = null;
      try {
        await tx.query("SAVEPOINT sp_merge");
        mergeChainIssues = await tx.queryOne<{
          deep_cat_chains: number;
          deep_place_chains: number;
          deep_person_chains: number;
        }>(`
          SELECT
            (SELECT COUNT(*)::int FROM sot.cats c1
             JOIN sot.cats c2 ON c1.merged_into_cat_id = c2.cat_id
             WHERE c2.merged_into_cat_id IS NOT NULL) as deep_cat_chains,
            (SELECT COUNT(*)::int FROM sot.places p1
             JOIN sot.places p2 ON p1.merged_into_place_id = p2.place_id
             WHERE p2.merged_into_place_id IS NOT NULL) as deep_place_chains,
            (SELECT COUNT(*)::int FROM sot.people p1
             JOIN sot.people p2 ON p1.merged_into_person_id = p2.person_id
             WHERE p2.merged_into_person_id IS NOT NULL) as deep_person_chains
        `);
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT sp_merge");
        mergeChainIssues = { deep_cat_chains: 0, deep_place_chains: 0, deep_person_chains: 0 };
      }

      // Skipped entity summary
      let skippedSummary: { reason: string; count: number }[] = [];
      try {
        await tx.query("SAVEPOINT sp_skipped");
        skippedSummary = await tx.queryRows<{
          reason: string;
          count: number;
        }>(`
          SELECT reason, COUNT(*)::int as count
          FROM ops.entity_linking_skipped
          GROUP BY reason
          ORDER BY count DESC
          LIMIT 10
        `);
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT sp_skipped");
        skippedSummary = [];
      }

      // Recent linking runs
      let recentRuns: {
        started_at: string;
        duration_ms: number;
        status: string;
        cats_linked: number;
        cats_skipped: number;
      }[] = [];
      try {
        await tx.query("SAVEPOINT sp_runs");
        recentRuns = await tx.queryRows<{
          started_at: string;
          duration_ms: number;
          status: string;
          cats_linked: number;
          cats_skipped: number;
        }>(`
          SELECT
            started_at::text,
            EXTRACT(EPOCH FROM (completed_at - started_at))::int * 1000 as duration_ms,
            status,
            (result->>'cats_linked')::int as cats_linked,
            (result->>'cats_skipped')::int as cats_skipped
          FROM ops.entity_linking_runs
          ORDER BY started_at DESC
          LIMIT 5
        `);
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT sp_runs");
        recentRuns = [];
      }

      // Duplicate places: normalized_address groups with >1 active place (FFS-141)
      const duplicatePlaces = await tx.queryOne<{ count: number }>(`
        SELECT COUNT(*)::int as count
        FROM (
          SELECT normalized_address
          FROM sot.places
          WHERE merged_into_place_id IS NULL
            AND normalized_address IS NOT NULL
          GROUP BY normalized_address
          HAVING COUNT(*) > 1
        ) dupes
      `);

      // Unpropagated matches: clinic_day_entries matched but not linked (FFS-141)
      let unpropagatedMatches: { count: number } | null = null;
      try {
        await tx.query("SAVEPOINT sp_unprop");
        unpropagatedMatches = await tx.queryOne<{ count: number }>(`
          SELECT COUNT(*)::int as count
          FROM ops.clinic_day_entries
          WHERE matched_appointment_id IS NOT NULL
            AND appointment_id IS NULL
        `);
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT sp_unprop");
        unpropagatedMatches = { count: 0 };
      }

      // Mislinked appointments: owner_address != inferred place address (FFS-141)
      let mislinkedAppointments: { count: number } | null = null;
      try {
        await tx.query("SAVEPOINT sp_mislinked");
        mislinkedAppointments = await tx.queryOne<{ count: number }>(`
          SELECT COUNT(*)::int as count
          FROM ops.appointments a
          JOIN sot.places p ON p.place_id = a.inferred_place_id
          WHERE a.inferred_place_id IS NOT NULL
            AND a.owner_address IS NOT NULL
            AND p.normalized_address IS NOT NULL
            AND p.merged_into_place_id IS NULL
            AND sot.normalize_address(a.owner_address) != p.normalized_address
        `);
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT sp_mislinked");
        mislinkedAppointments = { count: 0 };
      }

      const duplicatePlacesCount = duplicatePlaces?.count ?? 0;
      const unpropagatedMatchesCount = unpropagatedMatches?.count ?? 0;
      const mislinkedAppointmentsCount = mislinkedAppointments?.count ?? 0;
      const orphanCount = orphanCats?.count ?? 0;
      const totalDeepChains =
        (mergeChainIssues?.deep_cat_chains ?? 0) +
        (mergeChainIssues?.deep_place_chains ?? 0) +
        (mergeChainIssues?.deep_person_chains ?? 0);

      const isHealthy =
        (clinicLeakage?.count ?? 0) === 0 &&
        (coverage?.coverage_pct ?? 0) > 50 &&
        duplicatePlacesCount === 0 &&
        unpropagatedMatchesCount === 0 &&
        totalDeepChains === 0;

      return {
        status: isHealthy ? "healthy" : "degraded",
        clinic_leakage: clinicLeakage?.count ?? 0,
        cat_place_coverage: {
          total_cats: coverage?.total_cats ?? 0,
          cats_with_place: coverage?.cats_with_place ?? 0,
          coverage_pct: coverage?.coverage_pct ?? 0,
        },
        orphan_cats: orphanCount,
        merge_chain_integrity: {
          deep_cat_chains: mergeChainIssues?.deep_cat_chains ?? 0,
          deep_place_chains: mergeChainIssues?.deep_place_chains ?? 0,
          deep_person_chains: mergeChainIssues?.deep_person_chains ?? 0,
          total_deep_chains: totalDeepChains,
        },
        duplicate_places: duplicatePlacesCount,
        unpropagated_matches: unpropagatedMatchesCount,
        mislinked_appointments: mislinkedAppointmentsCount,
        skipped_reasons: skippedSummary,
        recent_runs: recentRuns,
      };
    });

    return apiSuccess(data);
  } catch (error) {
    // Check for statement_timeout (PostgreSQL error code 57014)
    const pgError = error as { code?: string };
    if (pgError.code === "57014") {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: "Entity linking health check timed out (>10s)",
            code: "QUERY_TIMEOUT",
          },
          status: "timeout",
        },
        { status: 504 }
      );
    }
    return apiServerError(error instanceof Error ? error.message : "Entity linking health check failed");
  }
}
