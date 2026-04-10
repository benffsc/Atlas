import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export const revalidate = 3600; // 1 hour

interface StoryRow {
  enabled: boolean;
  slide1_title: string;
  slide1_body: string;
  slide2_title: string;
  slide2_body: string;
  slide3_title: string;
  slide3_body: string;
  cta_label: string;
  cta_href: string;
  // From impact summary
  cats_altered: number;
  kittens_prevented: number;
  shelter_cost_avoided: number;
  start_year: number;
}

/**
 * GET /api/story-config
 *
 * Returns admin-configurable content for the scrollytelling intro at /story.
 * Pulls from ops.app_config (story.*) for text and from live data for
 * impact numbers. The {year} token in slide3_title is replaced with the
 * start_year from the impact data.
 *
 * White-label: every text field comes from config. Orgs can fully customize
 * the story via /admin/config → 'story' category.
 *
 * Epic: FFS-1196 (Tier 3: Gala Mode)
 */
export async function GET() {
  try {
    const row = await queryOne<StoryRow>(`
      WITH impact AS (
        -- Count first-time alterations by service item (MIG_3075).
        -- Uses service_type (actual surgery) not is_spay/is_neuter (status checkbox).
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
      kittens_mult AS (
        SELECT ops.get_config_numeric('impact.kittens_prevented_per_altered_cat', 10)::int AS m
      ),
      cost_mult AS (
        SELECT ops.get_config_numeric('impact.shelter_cost_per_kitten_usd', 200)::int AS m
      )
      SELECT
        (ops.get_config_value('story.enabled', 'true') = 'true') AS enabled,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'story.slide1_title'), 'Sonoma County has thousands of community cats') AS slide1_title,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'story.slide1_body'), '') AS slide1_body,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'story.slide2_title'), 'Beacon illuminates where help is needed most') AS slide2_title,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'story.slide2_body'), '') AS slide2_body,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'story.slide3_title'), 'Since {year}: a quiet, measurable revolution') AS slide3_title,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'story.slide3_body'), '') AS slide3_body,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'story.cta_label'), 'Explore the map') AS cta_label,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'story.cta_href'), '/map') AS cta_href,
        impact.cats_altered,
        impact.cats_altered * kittens_mult.m AS kittens_prevented,
        impact.cats_altered * kittens_mult.m * cost_mult.m AS shelter_cost_avoided,
        impact.start_year
      FROM impact, kittens_mult, cost_mult
    `);

    if (!row) {
      return apiServerError("Story config query returned no row");
    }

    // Replace {year} tokens in titles/bodies
    const replaceTokens = (text: string) => text.replace(/\{year\}/g, String(row.start_year));

    return apiSuccess(
      {
        enabled: row.enabled,
        slides: [
          { title: replaceTokens(row.slide1_title), body: replaceTokens(row.slide1_body) },
          { title: replaceTokens(row.slide2_title), body: replaceTokens(row.slide2_body) },
          { title: replaceTokens(row.slide3_title), body: replaceTokens(row.slide3_body) },
        ],
        cta: {
          label: row.cta_label,
          href: row.cta_href,
        },
        impact: {
          cats_altered: row.cats_altered,
          kittens_prevented: row.kittens_prevented,
          shelter_cost_avoided: row.shelter_cost_avoided,
          start_year: row.start_year,
        },
      },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200" } }
    );
  } catch (error) {
    console.error("Error fetching story config:", error);
    return apiServerError("Failed to fetch story config");
  }
}
