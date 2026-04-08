import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

// Cache aggressively — "since inception" numbers only change slowly.
export const revalidate = 3600; // 1 hour

interface ImpactRow {
  cats_altered: number;
  start_year: number;
  kittens_multiplier: number;
  shelter_cost_multiplier: number;
  enabled: boolean;
  card_title: string;
  card_subtitle: string;
  label_cats_altered: string;
  label_kittens_prevented: string;
  label_shelter_cost_avoided: string;
  kittens_rationale: string;
  shelter_cost_rationale: string;
  kittens_source_label: string;
  kittens_source_url: string;
}

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

export interface ImpactLabels {
  card_title: string;
  card_subtitle: string;
  cats_altered: string;
  kittens_prevented: string;
  shelter_cost_avoided: string;
}

export interface ImpactResponse {
  enabled: boolean;
  cats_altered: number;
  kittens_prevented: number;
  shelter_cost_avoided: number;
  start_year: number;
  computed_at: string;
  labels: ImpactLabels;
  methodology: ImpactMethodology;
}

/**
 * GET /api/dashboard/impact
 *
 * Returns mission-connected impact numbers for the dashboard hero card.
 * Translates operational metrics (cats altered) into outcome metrics
 * (kittens prevented, shelter cost avoided) using admin-configurable
 * multipliers from ops.app_config (category = 'impact').
 *
 * White-label ready: every number, label, rationale, and source comes from
 * ops.app_config and can be edited via /admin/config without a code change.
 * See MIG_3070__seed_impact_config.sql for the full list of keys.
 *
 * Also returns full methodology: formulas, assumptions, sources, and caveats
 * for each metric. This lets the UI "show its work" — clicking a stat opens
 * a drawer with the audit trail.
 *
 * Used by: components/dashboard/ImpactSummary.tsx
 * Epic: FFS-1194 (Tier 1 Beacon Polish), white-label: FFS-1193
 */
export async function GET() {
  try {
    // Single query: pulls the altered-cat count from ops.appointments AND
    // all impact.* config values in one round-trip. This is more efficient
    // than querying each config key separately.
    const row = await queryOne<ImpactRow>(`
      WITH counts AS (
        SELECT
          COUNT(DISTINCT a.cat_id)::int AS cats_altered,
          COALESCE(
            EXTRACT(YEAR FROM MIN(a.appointment_date))::int,
            EXTRACT(YEAR FROM CURRENT_DATE)::int
          ) AS start_year
        FROM ops.appointments a
        WHERE a.cat_id IS NOT NULL
          AND (a.is_spay = TRUE OR a.is_neuter = TRUE)
      )
      SELECT
        counts.cats_altered,
        counts.start_year,
        ops.get_config_numeric('impact.kittens_prevented_per_altered_cat', 10)::int AS kittens_multiplier,
        ops.get_config_numeric('impact.shelter_cost_per_kitten_usd', 200)::int AS shelter_cost_multiplier,
        (ops.get_config_value('impact.enabled', 'true') = 'true') AS enabled,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.card_title'), 'Our impact') AS card_title,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.card_subtitle'), 'Click any number to see the math') AS card_subtitle,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.label_cats_altered'), 'cats altered') AS label_cats_altered,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.label_kittens_prevented'), 'kittens prevented') AS label_kittens_prevented,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.label_shelter_cost_avoided'), 'shelter costs avoided') AS label_shelter_cost_avoided,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.kittens_rationale'), '') AS kittens_rationale,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.shelter_cost_rationale'), '') AS shelter_cost_rationale,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.kittens_source_label'), 'TNR industry guidance') AS kittens_source_label,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'impact.kittens_source_url'), '') AS kittens_source_url
      FROM counts
    `);

    if (!row) {
      return apiServerError("Impact query returned no row");
    }

    const catsAltered = row.cats_altered ?? 0;
    const startYear = row.start_year ?? new Date().getFullYear();
    const kittensMultiplier = row.kittens_multiplier;
    const shelterCostMultiplier = row.shelter_cost_multiplier;
    const kittensPrevented = catsAltered * kittensMultiplier;
    const shelterCostAvoided = kittensPrevented * shelterCostMultiplier;

    const response: ImpactResponse = {
      enabled: row.enabled,
      cats_altered: catsAltered,
      kittens_prevented: kittensPrevented,
      shelter_cost_avoided: shelterCostAvoided,
      start_year: startYear,
      computed_at: new Date().toISOString(),
      labels: {
        card_title: row.card_title,
        card_subtitle: row.card_subtitle,
        cats_altered: row.label_cats_altered,
        kittens_prevented: row.label_kittens_prevented,
        shelter_cost_avoided: row.label_shelter_cost_avoided,
      },
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
          formula: `cats_altered × ${kittensMultiplier}`,
          multiplier: kittensMultiplier,
          assumptions: [
            {
              label: "Kittens prevented per altered cat",
              value: String(kittensMultiplier),
              rationale: row.kittens_rationale,
            },
          ],
          sources: row.kittens_source_url
            ? [
                {
                  label: row.kittens_source_label,
                  url: row.kittens_source_url,
                },
              ]
            : [{ label: row.kittens_source_label, url: "#" }],
          caveats: [
            "This is an estimate, not a direct count. Actual prevented kittens cannot be measured.",
            `The multiplier of ${kittensMultiplier} is configurable via /admin/config (key: impact.kittens_prevented_per_altered_cat).`,
          ],
        },
        shelter_cost_avoided: {
          value: shelterCostAvoided,
          formula: `kittens_prevented × $${shelterCostMultiplier}`,
          multiplier: shelterCostMultiplier,
          assumptions: [
            {
              label: "Shelter cost per kitten avoided",
              value: `$${shelterCostMultiplier}`,
              rationale: row.shelter_cost_rationale,
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
            `The multiplier of $${shelterCostMultiplier} is configurable via /admin/config (key: impact.shelter_cost_per_kitten_usd).`,
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
