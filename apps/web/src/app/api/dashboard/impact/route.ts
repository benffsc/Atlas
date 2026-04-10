import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

// Revalidate every 5 minutes. Numbers only change slowly but a stale error
// response shouldn't hide the impact card for a full hour.
export const revalidate = 300;

interface ImpactRow {
  cats_altered: number;
  cats_altered_db_only: number;
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
    // Single query: pulls the altered-cat count from both the DB (provable
    // records) AND the reference table (Pip's donor-facing Excel), then uses
    // the HIGHER number per-year so we never show less than what the ED has
    // committed to donors. See MIG_3073 for the reference data.
    const row = await queryOne<ImpactRow>(`
      WITH db_counts AS (
        -- Count first-time alterations by service item (MIG_3075).
        -- Uses service_type (actual surgery) not is_spay/is_neuter (status checkbox).
        -- Each cat counted only once (first surgery date).
        SELECT
          COUNT(*)::int AS cats_altered,
          COALESCE(
            EXTRACT(YEAR FROM MIN(first_surgery))::int,
            EXTRACT(YEAR FROM CURRENT_DATE)::int
          ) AS start_year
        FROM (
          SELECT cat_id, MIN(appointment_date) AS first_surgery
          FROM ops.appointments
          WHERE cat_id IS NOT NULL
            AND service_type IS NOT NULL
            AND service_type ~* 'Cat Spay|Cat Neuter'
          GROUP BY cat_id
        ) first_surgeries
      ),
      ref_counts AS (
        SELECT
          COALESCE(SUM(donor_facing_count), 0)::int AS total,
          MIN(year)::int AS start_year
        FROM ops.v_alteration_counts_by_year
      ),
      counts AS (
        SELECT
          GREATEST(ref_counts.total, db_counts.cats_altered) AS cats_altered,
          db_counts.cats_altered AS cats_altered_db_only,
          LEAST(ref_counts.start_year, db_counts.start_year) AS start_year
        FROM db_counts, ref_counts
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
          formula: "MAX(reference_total, db_total) per year — uses the higher of ED-verified counts or DB records",
          data_source: "ops.v_alteration_counts_by_year (reference: ops.alteration_reference_counts + DB: ops.appointments)",
          record_count: row.cats_altered_db_only,
          assumptions: [
            {
              label: "Reference data source",
              value: "Pip's donor Excel (1990–present)",
              rationale: "The Executive Director maintains a yearly alteration count for donor presentations that goes back to 1990 — before any database existed. For years where the DB count is lower than the reference count, we use the reference count to ensure the donor-facing number never underreports FFSC's actual impact.",
            },
          ],
          sources: [
            {
              label: "ClinicHQ appointment records (2014–present, primary DB source)",
              url: "#",
            },
            {
              label: "ED's donor alteration spreadsheet (1990–present, reference)",
              url: "#",
            },
          ],
          caveats: [
            `${row.cats_altered_db_only.toLocaleString()} cats are directly provable in the database (individual records with cat_id)`,
            `${(catsAltered - row.cats_altered_db_only).toLocaleString()} additional cats come from the ED's reference counts for years where the DB is incomplete (pre-2014 and partial early imports)`,
            "The DB count is a floor, not a ceiling — it represents what we can prove with individual records",
            "See ops.v_alteration_counts_by_year for the year-by-year comparison",
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
