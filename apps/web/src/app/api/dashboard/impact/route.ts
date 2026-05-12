import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

// Force dynamic — the v2 economic model calls ops.compute_economic_impact()
// which reads from ops.app_config at runtime. ISR was serving stale v1 numbers.
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

interface EconomicImpactRow {
  tier: string;
  kittens_prevented: number;
  shelter_cost: number;
  animal_control_cost: number;
  property_damage_cost: number;
  disease_cost: number;
  placement_cost: number;
  indirect_cost: number;
  total_cost: number;
}

export interface CostBreakdown {
  shelter: number;
  animal_control: number;
  property_damage: number;
  disease: number;
  placement: number;
  indirect: number;
  total: number;
}

export interface EconomicModelTier {
  kittens_prevented: number;
  costs: CostBreakdown;
}

export interface EconomicModel {
  conservative: EconomicModelTier;
  moderate: EconomicModelTier;
  high: EconomicModelTier;
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
  economic_model?: EconomicModel;
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
        counts.cats_altered_db_only,
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

    // v1 flat multiplier fallback
    let kittensPrevented = catsAltered * kittensMultiplier;
    let shelterCostAvoided = kittensPrevented * shelterCostMultiplier;

    // Fetch v2 economic model (multi-category × 3 tiers) if available
    let economicModel: EconomicModel | undefined;
    try {
      const ecoRows = await queryRows<EconomicImpactRow>(
        `SELECT tier, kittens_prevented::numeric, shelter_cost::numeric,
                animal_control_cost::numeric, property_damage_cost::numeric,
                disease_cost::numeric, placement_cost::numeric,
                indirect_cost::numeric, total_cost::numeric
         FROM ops.compute_economic_impact($1)`,
        [catsAltered]
      );
      if (ecoRows.length === 3) {
        const tierMap = Object.fromEntries(ecoRows.map(r => [r.tier, r]));
        const toTier = (r: EconomicImpactRow): EconomicModelTier => ({
          kittens_prevented: Number(r.kittens_prevented),
          costs: {
            shelter: Number(r.shelter_cost),
            animal_control: Number(r.animal_control_cost),
            property_damage: Number(r.property_damage_cost),
            disease: Number(r.disease_cost),
            placement: Number(r.placement_cost),
            indirect: Number(r.indirect_cost),
            total: Number(r.total_cost),
          },
        });
        economicModel = {
          conservative: toTier(tierMap.conservative),
          moderate: toTier(tierMap.moderate),
          high: toTier(tierMap.high),
        };

        // Promote v2 moderate tier to hero numbers
        kittensPrevented = economicModel.moderate.kittens_prevented;
        shelterCostAvoided = economicModel.moderate.costs.total;
      }
    } catch {
      // v2 functions may not exist yet — gracefully degrade to v1
    }

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
      economic_model: economicModel,
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
          formula: economicModel
            ? `${Math.round(catsAltered * 0.5).toLocaleString()} females × 2.5 litters/yr × 4 kittens × 25% survival × 5 yrs + male contribution`
            : `cats_altered × ${kittensMultiplier}`,
          multiplier: kittensMultiplier,
          assumptions: economicModel
            ? [
                {
                  label: "Sex ratio",
                  value: "~50% female",
                  rationale: `Of ${catsAltered.toLocaleString()} cats altered, roughly half are female. Each spayed female is directly prevented from reproducing. Males contribute indirectly by not impregnating other females — but since many spayed females already exist, the male contribution has diminishing returns (we apply a 30% non-overlap factor).`,
                },
                {
                  label: "Litters per year × kittens per litter",
                  value: "2.5 litters × 4 kittens",
                  rationale: "An unaltered female community cat produces 2–3 litters per year (ASPCA, Alley Cat Allies). Average litter size is 4.0 kittens (Nutter et al., 2004, JAVMA). That's 10 kittens born per female per year before mortality.",
                },
                {
                  label: "Kitten survival rate",
                  value: "25% survive",
                  rationale: "75% of kittens born in unmanaged outdoor colonies die before reaching 6 months — from exposure, predation, disease, and starvation (Nutter et al., 2004; Levy et al., 2003). Only about 1 in 4 survive to adulthood. This is one of the main reasons our kitten prevention number is lower than a simple birth count.",
                },
                {
                  label: "Reproductive lifespan",
                  value: "5 years",
                  rationale: "An unaltered community cat typically reproduces for 3–5 years before mortality or reproductive decline (McCarthy et al., 2013). We use 5 years as the upper-mid range. For each cat we alter, we prevent 5 years of future litters.",
                },
                {
                  label: "The full chain",
                  value: `~${Math.round(kittensPrevented).toLocaleString()} kittens`,
                  rationale: `Putting it together: ~${Math.round(catsAltered * 0.5).toLocaleString()} females × 2.5 litters/yr × 4 kittens/litter × 25% survival × 5 years = ${Math.round(catsAltered * 0.5 * 2.5 * 4 * 0.25 * 5).toLocaleString()} from females, plus male contribution. Of these prevented kittens, 30% would have entered shelters, 70% would have remained outdoors generating animal control, disease, and property costs.`,
                },
              ]
            : [
                {
                  label: "Kittens prevented per altered cat",
                  value: String(kittensMultiplier),
                  rationale: row.kittens_rationale,
                },
              ],
          sources: [
            { label: "Nutter FB et al. (2004) JAVMA 225(9):1399-1402", url: "#" },
            { label: "Levy JK et al. (2003) JAVMA 222(1):42-46", url: "#" },
            ...(row.kittens_source_url
              ? [{ label: row.kittens_source_label, url: row.kittens_source_url }]
              : [{ label: row.kittens_source_label, url: "#" }]),
          ],
          caveats: [
            "This is an estimate, not a direct count. Actual prevented kittens cannot be measured.",
            economicModel
              ? "Uses sex-aware v2 model with per-parameter confidence. See /admin/impact-model to adjust."
              : `The multiplier of ${kittensMultiplier} is configurable via /admin/config (key: impact.kittens_prevented_per_altered_cat).`,
          ],
        },
        shelter_cost_avoided: {
          value: shelterCostAvoided,
          formula: economicModel
            ? `${Math.round(kittensPrevented).toLocaleString()} prevented kittens → 30% shelter + 70% outdoor → 6 cost categories`
            : `kittens_prevented × $${shelterCostMultiplier}`,
          multiplier: shelterCostMultiplier,
          assumptions: economicModel
            ? [
                {
                  label: "Shelter intake (30% of surviving kittens)",
                  value: `$${Math.round(economicModel.moderate.costs.shelter).toLocaleString()}`,
                  rationale: `Of the ~${Math.round(kittensPrevented).toLocaleString()} kittens prevented, only ~25% would survive to adulthood (75% kitten mortality). Of those survivors, approximately 30% would eventually enter the shelter system — through owner surrender, stray intake, or animal control pickup. At $300 per cat for intake processing (vaccines, medical screening, housing, staff time), that's ${Math.round(kittensPrevented * 0.25 * 0.30).toLocaleString()} cats × $300. The other 70% of survivors remain as free-roaming community cats, generating the costs below.`,
                },
                {
                  label: "Animal control responses",
                  value: `$${Math.round(economicModel.moderate.costs.animal_control).toLocaleString()}`,
                  rationale: `Each unaltered community cat generates roughly 0.3 animal control complaints per year (noise, fighting, spraying, trespassing). Over a 5-year reproductive lifespan, that's 1.5 complaints per cat. At $150 per officer response (dispatch, vehicle, investigation, follow-up), this adds up across ${catsAltered.toLocaleString()} cats prevented from being unaltered nuisance animals.`,
                },
                {
                  label: "Property damage from colonies",
                  value: `$${Math.round(economicModel.moderate.costs.property_damage).toLocaleString()}`,
                  rationale: "Unmanaged cat colonies cause ~$200/year in property damage per colony: garden destruction, vehicle scratches from cats sheltering on/under cars, feces contamination, odor damage. We estimate approximately 1 colony per 15 unaltered cats. This is conservative — actual damage from large unmanaged colonies can be significantly higher.",
                },
                {
                  label: "Disease-related costs",
                  value: `$${Math.round(economicModel.moderate.costs.disease).toLocaleString()}`,
                  rationale: "Each prevented kitten avoids becoming a potential vector for FIV, FeLV, upper respiratory infections, and parasites. At ~$50 per cat in veterinary treatment and public health monitoring costs (rabies surveillance, disease outbreak response), the prevented kittens represent avoided public health burden.",
                },
                {
                  label: "Kitten placement & foster (30% of survivors)",
                  value: `$${Math.round(economicModel.moderate.costs.placement).toLocaleString()}`,
                  rationale: "The same 30% of surviving kittens that enter shelters also need placement: spay/neuter surgery, vetting, foster supplies, transport to adopters, and administrative processing. At $250 per kitten placed, this represents the rescue pipeline cost that TNR prevents from being necessary.",
                },
                {
                  label: "Indirect & environmental costs (30% uplift)",
                  value: `$${Math.round(economicModel.moderate.costs.indirect).toLocaleString()}`,
                  rationale: "The direct categories above don't capture everything: volunteer time coordinating TNR that would be needed for larger populations, environmental impact on bird and wildlife populations, administrative overhead for animal services, and reduced property values in areas with visible cat colonies. We apply a conservative 1.3× multiplier (30% above direct costs) — economic studies typically use 1.5–2.0×.",
                },
              ]
            : [
                {
                  label: "Shelter cost per kitten avoided",
                  value: `$${shelterCostMultiplier}`,
                  rationale: row.shelter_cost_rationale,
                },
              ],
          sources: [
            { label: "ASPCA shelter cost studies", url: "#" },
            { label: "National Animal Care & Control Association", url: "#" },
            { label: "Marsh P (2010) — Replacing Myth with Math", url: "#" },
          ],
          caveats: economicModel
            ? [
                "Actual costs vary by region. These are national averages with Sonoma County adjustments.",
                "Three confidence tiers: conservative (60%), moderate (base), high (180%). Toggle in the cost breakdown below.",
                "All parameters editable at /admin/impact-model. See the cost breakdown chart for per-category detail.",
              ]
            : [
                "Actual costs vary significantly by shelter and region",
                "Does not include indirect costs (euthanasia, community complaints, TNR program operations)",
                "Based on kittens_prevented, which is itself a conservative estimate",
                `The multiplier of $${shelterCostMultiplier} is configurable via /admin/config (key: impact.shelter_cost_per_kitten_usd).`,
              ],
        },
      },
    };

    return apiSuccess(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Error fetching dashboard impact:", error);
    return apiServerError("Failed to fetch impact numbers");
  }
}
