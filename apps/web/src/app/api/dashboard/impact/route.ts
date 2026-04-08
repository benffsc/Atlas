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
const KITTENS_PREVENTED_PER_ALTERED_CAT = 10;
const SHELTER_COST_PER_KITTEN_USD = 200;

export interface ImpactMethodology {
  cats_altered: {
    value: number;
    formula: string;
    data_source: string;
    record_count: number;
    assumptions: Array<{ label: string; value: string; rationale: string }>;
    sources: Array<{ label: string; url: string }>;
    caveats: string[];
    audit_endpoint: string;
  };
  kittens_prevented: {
    value: number;
    formula: string;
    multiplier: number;
    assumptions: Array<{ label: string; value: string; rationale: string }>;
    sources: Array<{ label: string; url: string }>;
    caveats: string[];
  };
  shelter_cost_avoided: {
    value: number;
    formula: string;
    multiplier: number;
    assumptions: Array<{ label: string; value: string; rationale: string }>;
    sources: Array<{ label: string; url: string }>;
    caveats: string[];
  };
}

export interface ImpactResponse {
  cats_altered: number;
  kittens_prevented: number;
  shelter_cost_avoided: number;
  start_year: number;
  computed_at: string;
  methodology: ImpactMethodology;
}

/**
 * GET /api/dashboard/impact
 *
 * Returns mission-connected impact numbers for the dashboard hero card.
 * Translates operational metrics (cats altered) into outcome metrics
 * (kittens prevented, shelter cost avoided) using conservative multipliers.
 *
 * Also returns full methodology: formulas, assumptions, sources, and caveats
 * for each metric. This lets the UI "show its work" — clicking a stat opens
 * a drawer with the audit trail.
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

    const response: ImpactResponse = {
      cats_altered: catsAltered,
      kittens_prevented: kittensPrevented,
      shelter_cost_avoided: shelterCostAvoided,
      start_year: startYear,
      computed_at: new Date().toISOString(),
      methodology: {
        cats_altered: {
          value: catsAltered,
          formula: "COUNT(DISTINCT cat_id) WHERE is_spay = TRUE OR is_neuter = TRUE",
          data_source: "ops.appointments",
          record_count: catsAltered,
          assumptions: [],
          sources: [
            {
              label: "ClinicHQ appointment records (primary source of truth)",
              url: "#",
            },
          ],
          caveats: [
            "Counts each cat exactly once regardless of how many procedures they received",
            "Excludes cats without a recorded cat_id (rare — pre-system imports may be affected)",
            "Includes only appointments where is_spay or is_neuter is explicitly TRUE",
          ],
          audit_endpoint: "/api/dashboard/impact/audit?metric=cats_altered",
        },
        kittens_prevented: {
          value: kittensPrevented,
          formula: `cats_altered × ${KITTENS_PREVENTED_PER_ALTERED_CAT}`,
          multiplier: KITTENS_PREVENTED_PER_ALTERED_CAT,
          assumptions: [
            {
              label: "Kittens prevented per altered cat",
              value: String(KITTENS_PREVENTED_PER_ALTERED_CAT),
              rationale:
                "Conservative floor. Approximately 50% of altered cats are female. An unaltered female can have 2–3 litters per year of 4–5 kittens, with varying survival rates. Over a reproductive lifespan of 3–5 years for an unaltered community cat, prevented-kitten estimates range widely in the literature (10 to 200+). We use 10 as a deliberately defensible minimum to avoid overclaiming impact.",
            },
          ],
          sources: [
            {
              label: "Alley Cat Allies — Trap-Neuter-Return guidance",
              url: "https://www.alleycat.org/our-work/trap-neuter-return/",
            },
          ],
          caveats: [
            "This is an estimate, not a direct count. Actual prevented kittens cannot be measured.",
            "The multiplier of 10 is intentionally conservative. Many TNR organizations cite 20+ or much higher.",
            "To update the multiplier, change KITTENS_PREVENTED_PER_ALTERED_CAT in apps/web/src/app/api/dashboard/impact/route.ts",
          ],
        },
        shelter_cost_avoided: {
          value: shelterCostAvoided,
          formula: `kittens_prevented × $${SHELTER_COST_PER_KITTEN_USD}`,
          multiplier: SHELTER_COST_PER_KITTEN_USD,
          assumptions: [
            {
              label: "Shelter cost per kitten avoided",
              value: `$${SHELTER_COST_PER_KITTEN_USD}`,
              rationale:
                "Widely cited intake and processing cost at municipal and community shelters. Includes vaccinations, medical care, food, housing, and staff time. Many shelters cite $500 or more per animal; we use $200 as a conservative floor to avoid overclaiming financial impact.",
            },
          ],
          sources: [
            {
              label: "Typical shelter intake cost ranges (industry average)",
              url: "#",
            },
          ],
          caveats: [
            "Actual costs vary significantly by shelter and region",
            "Does not include indirect costs (euthanasia, community complaints, TNR program operations)",
            "Based on kittens_prevented, which is itself a conservative estimate",
            "To update the multiplier, change SHELTER_COST_PER_KITTEN_USD in apps/web/src/app/api/dashboard/impact/route.ts",
          ],
        },
      },
    };

    return apiSuccess(response, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200" },
    });
  } catch (error) {
    console.error("Error fetching dashboard impact:", error);
    return apiServerError("Failed to fetch impact numbers");
  }
}
