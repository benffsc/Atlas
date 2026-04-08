import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

// Cache aggressively — "since inception" numbers only change slowly.
export const revalidate = 3600; // 1 hour

interface ImpactRow {
  cats_altered: number;
  start_year: number;
}

// Rough multipliers used to translate operational data into mission outcomes.
// These are intentionally conservative communication estimates, not scientific
// projections. They're good enough for a donor-facing "impact since inception"
// card and avoid overclaiming. Source: Alley Cat Allies TNR guidance + common
// shelter intake cost ranges.
//
// Kittens prevented per altered cat: A conservative estimate accounting for
// both sexes (only females produce kittens) and average lifespan. Many sources
// cite much higher numbers (hundreds per female) — we use 10 as a deliberately
// defensible floor.
//
// Shelter cost per kitten avoided: $200 is a widely cited intake/processing
// cost at municipal and community shelters.
const KITTENS_PREVENTED_PER_ALTERED_CAT = 10;
const SHELTER_COST_PER_KITTEN_USD = 200;

/**
 * GET /api/dashboard/impact
 *
 * Returns mission-connected impact numbers for the dashboard hero card.
 * Translates operational metrics (cats altered) into outcome metrics
 * (kittens prevented, shelter cost avoided) using conservative multipliers.
 *
 * Used by: components/dashboard/ImpactSummary.tsx
 * Epic: FFS-1194 (Tier 1 Beacon Polish)
 */
export async function GET() {
  try {
    const row = await queryOne<ImpactRow>(`
      SELECT
        COUNT(DISTINCT a.cat_id)::int AS cats_altered,
        COALESCE(
          EXTRACT(YEAR FROM MIN(a.appointment_date))::int,
          EXTRACT(YEAR FROM CURRENT_DATE)::int
        ) AS start_year
      FROM ops.appointments a
      WHERE a.cat_id IS NOT NULL
        AND (a.is_spay = TRUE OR a.is_neuter = TRUE)
    `);

    const catsAltered = row?.cats_altered ?? 0;
    const startYear = row?.start_year ?? new Date().getFullYear();
    const kittensPrevented = catsAltered * KITTENS_PREVENTED_PER_ALTERED_CAT;
    const shelterCostAvoided = kittensPrevented * SHELTER_COST_PER_KITTEN_USD;

    return apiSuccess(
      {
        cats_altered: catsAltered,
        kittens_prevented: kittensPrevented,
        shelter_cost_avoided: shelterCostAvoided,
        start_year: startYear,
      },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200" } }
    );
  } catch (error) {
    console.error("Error fetching dashboard impact:", error);
    return apiServerError("Failed to fetch impact numbers");
  }
}
