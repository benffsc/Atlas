import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { generateForecast, findThresholdMonth, type ForecastPoint } from "@/lib/forecast-engine";

export const revalidate = 3600;

interface OrgStats {
  total_altered: number;
  total_population_estimate: number;
  monthly_alteration_rate_12m: number;
  monthly_intake_rate_12m: number;
}

/**
 * GET /api/beacon/impact/projection?alteration_rate=75&years=10&city=Petaluma
 *
 * Returns year-by-year population + economic impact projection vs baseline.
 * Supports org-wide or city-filtered projections.
 */
export async function GET(request: NextRequest) {
  try {
    const targetRate = Math.min(
      Math.max(parseInt(request.nextUrl.searchParams.get("alteration_rate") || "75", 10) || 75, 10),
      100
    );
    const years = Math.min(
      Math.max(parseInt(request.nextUrl.searchParams.get("years") || "10", 10) || 10, 1),
      30
    );
    const city = request.nextUrl.searchParams.get("city");
    const months = years * 12;

    // Get current org-wide (or city-filtered) stats
    const cityFilter = city
      ? `AND EXISTS (
          SELECT 1 FROM sot.cat_place cp2
          JOIN sot.places p2 ON p2.place_id = cp2.place_id AND p2.merged_into_place_id IS NULL
          JOIN sot.addresses addr2 ON addr2.address_id = p2.sot_address_id
          JOIN sot.city_boundaries cb2 ON ST_Contains(cb2.geom, ST_SetSRID(ST_Point(addr2.longitude, addr2.latitude), 4326))
          WHERE cp2.cat_id = c.cat_id AND cb2.city_name ILIKE $1
        )`
      : "";

    const stats = await queryOne<OrgStats>(`
      WITH cats AS (
        SELECT
          COUNT(*) FILTER (WHERE c.altered_status IN ('spayed','neutered','altered','Yes')) AS total_altered,
          COUNT(*) AS total_cats
        FROM sot.cats c
        WHERE c.merged_into_cat_id IS NULL
          ${cityFilter}
      ),
      recent AS (
        SELECT
          COUNT(DISTINCT a.cat_id) FILTER (
            WHERE a.service_type ~* 'Cat Spay|Cat Neuter'
          ) AS alterations_12m,
          COUNT(DISTINCT a.cat_id) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM ops.appointments a2
              WHERE a2.cat_id = a.cat_id AND a2.appointment_date < a.appointment_date
            )
          ) AS new_cats_12m
        FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
        WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '12 months'
          ${cityFilter}
      )
      SELECT
        COALESCE(cats.total_altered, 0)::int AS total_altered,
        GREATEST(COALESCE(cats.total_cats, 0), 1)::int AS total_population_estimate,
        COALESCE(recent.alterations_12m, 0)::numeric / 12.0 AS monthly_alteration_rate_12m,
        COALESCE(recent.new_cats_12m, 0)::numeric / 12.0 AS monthly_intake_rate_12m
      FROM cats, recent
    `, city ? [city] : []);

    if (!stats) {
      return apiBadRequest("No data available for projection");
    }

    const initialPop = stats.total_population_estimate;
    const initialAltered = stats.total_altered;
    const unaltered = Math.max(initialPop - initialAltered, 1);
    const currentMonthlyRate = Number(stats.monthly_alteration_rate_12m) / Math.max(unaltered, 1);
    const monthlyIntake = Number(stats.monthly_intake_rate_12m);

    // Baseline: continue at current pace
    const baseline = generateForecast({
      initialPop, initialAltered,
      monthlyAlterationRate: currentMonthlyRate,
      monthlyIntakeRate: monthlyIntake,
      months,
    });

    // Target scenario: what if we alter at a rate to reach target% within the projection
    const targetMonthlyRate = Math.max(currentMonthlyRate * (targetRate / Math.max(baseline[0].alteration_rate, 1)), currentMonthlyRate * 1.5);
    const target = generateForecast({
      initialPop, initialAltered,
      monthlyAlterationRate: targetMonthlyRate,
      monthlyIntakeRate: monthlyIntake,
      months,
    });

    // Compute economic impact per year using the delta
    const yearlyProjection: Array<{
      year: number;
      baseline_unaltered: number;
      target_unaltered: number;
      additional_alterations: number;
      kittens_prevented_delta: number;
      economic_impact_delta: number;
    }> = [];

    for (let y = 1; y <= years; y++) {
      const monthIdx = Math.min(y * 12, months);
      const bPt = baseline[monthIdx];
      const tPt = target[monthIdx];
      const additionalAlterations = Math.max(tPt.cumulative_procedures - bPt.cumulative_procedures, 0);

      // Rough economic impact per additional alteration (from v2 model moderate tier)
      // Each additional altered cat prevents ~6.25 surviving kittens (moderate, from model)
      const kittensPerAlteration = 6.25; // conservative: female_ratio × litters × kittens × survival × years
      const costPerKitten = 200; // moderate cost estimate per prevented kitten
      const kpDelta = Math.round(additionalAlterations * kittensPerAlteration);
      const eiDelta = Math.round(kpDelta * costPerKitten);

      yearlyProjection.push({
        year: new Date().getFullYear() + y,
        baseline_unaltered: bPt.unaltered,
        target_unaltered: tPt.unaltered,
        additional_alterations: Math.round(additionalAlterations),
        kittens_prevented_delta: kpDelta,
        economic_impact_delta: eiDelta,
      });
    }

    return apiSuccess({
      city: city || "all",
      target_alteration_rate: targetRate,
      projection_years: years,
      current: {
        population: initialPop,
        altered: initialAltered,
        alteration_rate: initialPop > 0 ? Math.round((initialAltered / initialPop) * 1000) / 10 : 0,
        monthly_alteration_rate: Math.round(currentMonthlyRate * 10000) / 100,
        monthly_intake_rate: Math.round(monthlyIntake * 10) / 10,
      },
      scenarios: {
        baseline: {
          label: "Current Rate",
          points: samplePoints(baseline, years),
          months_to_target: findThresholdMonth(baseline, targetRate),
          final_alteration_rate: baseline[baseline.length - 1].alteration_rate,
        },
        target: {
          label: `${targetRate}% Target`,
          points: samplePoints(target, years),
          months_to_target: findThresholdMonth(target, targetRate),
          final_alteration_rate: target[target.length - 1].alteration_rate,
        },
      },
      yearly_projection: yearlyProjection,
      totals: {
        additional_alterations: yearlyProjection.reduce((s, y) => s + y.additional_alterations, 0),
        kittens_prevented_delta: yearlyProjection.reduce((s, y) => s + y.kittens_prevented_delta, 0),
        economic_impact_delta: yearlyProjection.reduce((s, y) => s + y.economic_impact_delta, 0),
      },
      computed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error generating projection:", error);
    return apiServerError("Failed to generate projection");
  }
}

/** Sample forecast points to yearly for lighter payloads */
function samplePoints(points: ForecastPoint[], years: number): ForecastPoint[] {
  const sampled: ForecastPoint[] = [points[0]];
  for (let y = 1; y <= years; y++) {
    const idx = Math.min(y * 12, points.length - 1);
    sampled.push(points[idx]);
  }
  return sampled;
}
