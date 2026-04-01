import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Data Quality Health Check (FFS-294, DATA_GAP_027)
 *
 * Lightweight aggregate endpoint for automated monitoring.
 * Returns key data quality signals with status thresholds.
 *
 * For detailed metrics, use /api/admin/data-quality instead.
 *
 * GET /api/health/data-quality
 */
export async function GET() {
  const startTime = Date.now();

  try {
    const metrics = await queryOne<{
      total_cats: number;
      cats_with_place: number;
      cat_place_coverage_pct: number;
      orphan_cats: number;
      total_people: number;
      people_with_identifier: number;
      identity_coverage_pct: number;
      clinic_leakage: number;
      deep_merge_chains: number;
      pending_dedup_candidates: number;
      stale_linking_hours: number | null;
    }>(`
      SELECT
        -- Cat-place coverage
        (SELECT COUNT(*)::int FROM sot.cats WHERE merged_into_cat_id IS NULL) AS total_cats,
        (SELECT COUNT(DISTINCT cat_id)::int FROM sot.cat_place) AS cats_with_place,
        CASE
          WHEN (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) = 0 THEN 0
          ELSE ROUND(100.0 * (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place)
            / (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 1)
        END AS cat_place_coverage_pct,

        -- Orphan cats (no place, no person)
        (SELECT COUNT(*)::int FROM sot.cats c
         WHERE c.merged_into_cat_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM sot.cat_place WHERE cat_id = c.cat_id)
           AND NOT EXISTS (SELECT 1 FROM sot.person_cat WHERE cat_id = c.cat_id)
        ) AS orphan_cats,

        -- Identity coverage
        (SELECT COUNT(*)::int FROM sot.people WHERE merged_into_person_id IS NULL) AS total_people,
        (SELECT COUNT(DISTINCT person_id)::int FROM sot.person_identifiers WHERE confidence >= 0.5) AS people_with_identifier,
        CASE
          WHEN (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL) = 0 THEN 0
          ELSE ROUND(100.0 * (SELECT COUNT(DISTINCT person_id) FROM sot.person_identifiers WHERE confidence >= 0.5)
            / (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL), 1)
        END AS identity_coverage_pct,

        -- Clinic leakage (should be 0)
        (SELECT COUNT(*)::int FROM sot.cat_place cp
         JOIN sot.places p ON p.place_id = cp.place_id
         WHERE ops.is_clinic_address(p.formatted_address)
           AND p.merged_into_place_id IS NULL
        ) AS clinic_leakage,

        -- Deep merge chains (depth > 1, indicates chain not resolved)
        (SELECT COUNT(*)::int FROM (
           SELECT 1 FROM sot.cats c1 JOIN sot.cats c2 ON c1.merged_into_cat_id = c2.cat_id WHERE c2.merged_into_cat_id IS NOT NULL
           UNION ALL
           SELECT 1 FROM sot.places p1 JOIN sot.places p2 ON p1.merged_into_place_id = p2.place_id WHERE p2.merged_into_place_id IS NOT NULL
           UNION ALL
           SELECT 1 FROM sot.people p1 JOIN sot.people p2 ON p1.merged_into_person_id = p2.person_id WHERE p2.merged_into_person_id IS NOT NULL
        ) chains) AS deep_merge_chains,

        -- Pending dedup candidates
        (SELECT COUNT(*)::int FROM sot.place_dedup_candidates WHERE status = 'pending') AS pending_dedup_candidates,

        -- Hours since last entity linking run
        (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(completed_at)))::int / 3600
         FROM ops.entity_linking_runs
         WHERE status IN ('completed', 'completed_with_warnings')
        ) AS stale_linking_hours
    `);

    const m = metrics!;
    const issues: string[] = [];

    if (m.clinic_leakage > 0) issues.push(`clinic_leakage: ${m.clinic_leakage} cats linked to clinic addresses`);
    if (m.deep_merge_chains > 0) issues.push(`deep_merge_chains: ${m.deep_merge_chains} entities with chain depth > 1`);
    if (m.cat_place_coverage_pct < 50) issues.push(`cat_place_coverage: ${m.cat_place_coverage_pct}% (target >50%)`);
    if (m.stale_linking_hours !== null && m.stale_linking_hours > 48) issues.push(`entity_linking_stale: ${m.stale_linking_hours}h since last run`);

    const status =
      m.clinic_leakage > 0 || m.deep_merge_chains > 0
        ? "critical"
        : issues.length > 0
          ? "warning"
          : "healthy";

    // Entity quality scores (MIG_3033) — gold/silver/bronze tiers
    let entityQuality: Array<{
      entity_type: string;
      total: number;
      gold: number;
      silver: number;
      bronze: number;
      gold_pct: number;
    }> = [];
    try {
      entityQuality = await queryRows<{
        entity_type: string;
        total: number;
        gold: number;
        silver: number;
        bronze: number;
        gold_pct: number;
      }>("SELECT entity_type, total::int, gold::int, silver::int, bronze::int, gold_pct::numeric FROM ops.v_entity_quality_summary");
    } catch {
      // MIG_3033 may not be applied yet
    }

    return apiSuccess({
      status,
      metrics: {
        cat_place_coverage_pct: m.cat_place_coverage_pct,
        orphan_cats: m.orphan_cats,
        identity_coverage_pct: m.identity_coverage_pct,
        clinic_leakage: m.clinic_leakage,
        deep_merge_chains: m.deep_merge_chains,
        pending_dedup_candidates: m.pending_dedup_candidates,
        entity_linking_stale_hours: m.stale_linking_hours,
      },
      counts: {
        total_cats: m.total_cats,
        cats_with_place: m.cats_with_place,
        total_people: m.total_people,
        people_with_identifier: m.people_with_identifier,
      },
      entity_quality: entityQuality,
      issues,
      response_time_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Data quality health check error:", error);
    return apiServerError("Failed to check data quality health");
  }
}
