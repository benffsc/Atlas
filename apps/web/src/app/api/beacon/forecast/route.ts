import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { isValidUUID } from "@/lib/api-validation";

/**
 * GET /api/beacon/forecast?place_id=UUID
 *
 * Returns a 10-year (120 month) population projection for a given place.
 * Uses current population estimate + monthly alteration rate to project forward.
 *
 * Model parameters:
 *   - Current population (from Chapman estimate or cat count)
 *   - Monthly alteration rate (derived from last 12 months of data)
 *   - Monthly intake rate (new unaltered cats arriving per month)
 *   - Natural attrition rate (~15%/year = ~1.35%/month)
 *   - Reproduction rate for unaltered cats (~0.5 litters/year, ~4 kittens/litter surviving)
 *
 * Returns baseline projection + "if alteration rate reaches 75%" scenario.
 *
 * Scientific basis:
 *   - Levy et al. (2014): 70-75% sterilization for population stabilization
 *   - McCarthy et al. (2013): Population dynamics of free-roaming cats
 */

interface PlaceStats {
  cat_count: number;
  altered_count: number;
  total_appointments_12m: number;
  alterations_12m: number;
  new_cats_12m: number;
  estimated_population: number | null;
}

interface ForecastPoint {
  month: number;
  date: string;
  population: number;
  altered: number;
  unaltered: number;
  alteration_rate: number;
  cumulative_procedures: number;
}

function generateForecast(
  initialPop: number,
  initialAltered: number,
  monthlyAlterationRate: number,
  monthlyIntakeRate: number,
  months: number,
  targetAlterationRate?: number,
): ForecastPoint[] {
  const points: ForecastPoint[] = [];
  let population = initialPop;
  let altered = initialAltered;
  let cumulativeProcedures = 0;

  // Monthly rates
  const monthlyAttrition = 0.0135; // ~15%/year natural attrition
  const monthlyReproductionPerUnaltered = 0.083; // ~1 kitten surviving/unaltered cat/year = ~0.083/month

  // Use target rate to compute monthly procedures if provided
  const effectiveMonthlyAltRate = targetAlterationRate !== undefined
    ? targetAlterationRate
    : monthlyAlterationRate;

  const now = new Date();

  for (let m = 0; m <= months; m++) {
    const date = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const unaltered = Math.max(population - altered, 0);
    const altRate = population > 0 ? (altered / population) * 100 : 0;

    points.push({
      month: m,
      date: date.toISOString().slice(0, 7),
      population: Math.round(population),
      altered: Math.round(altered),
      unaltered: Math.round(unaltered),
      alteration_rate: Math.round(altRate * 10) / 10,
      cumulative_procedures: Math.round(cumulativeProcedures),
    });

    if (m === months) break;

    // Monthly dynamics
    // 1. New arrivals (unaltered cats)
    population += monthlyIntakeRate;

    // 2. Reproduction from unaltered cats
    const newKittens = unaltered * monthlyReproductionPerUnaltered;
    population += newKittens;

    // 3. Attrition (affects both altered and unaltered proportionally)
    const attritionLoss = population * monthlyAttrition;
    const alteredRatio = population > 0 ? altered / population : 0;
    altered -= attritionLoss * alteredRatio;
    population -= attritionLoss;

    // 4. Alteration procedures this month
    const unalteredNow = Math.max(population - altered, 0);
    const proceduresThisMonth = Math.min(unalteredNow * effectiveMonthlyAltRate, unalteredNow);
    altered += proceduresThisMonth;
    cumulativeProcedures += proceduresThisMonth;

    // Floor at 0
    population = Math.max(population, 0);
    altered = Math.max(Math.min(altered, population), 0);
  }

  return points;
}

export async function GET(request: NextRequest) {
  try {
    const placeId = request.nextUrl.searchParams.get("place_id");
    if (!placeId) {
      return apiBadRequest("Missing required parameter: place_id");
    }
    if (!isValidUUID(placeId)) {
      return apiBadRequest("Invalid place_id UUID format");
    }

    const months = Math.min(
      Math.max(parseInt(request.nextUrl.searchParams.get("months") || "120", 10) || 120, 12),
      240
    );

    // Get current place stats
    const stats = await queryOne<PlaceStats>(`
      WITH place_cats AS (
        SELECT
          COUNT(DISTINCT cp.cat_id) AS cat_count,
          COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.is_altered = TRUE) AS altered_count
        FROM sot.cat_place cp
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        WHERE cp.place_id = $1
          AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
      ),
      recent_activity AS (
        SELECT
          COUNT(DISTINCT a.appointment_id) AS total_appointments_12m,
          COUNT(DISTINCT a.appointment_id) FILTER (
            WHERE a.procedure_type IN ('spay', 'neuter', 'snr', 'tnr')
              OR a.procedure_description ILIKE '%spay%'
              OR a.procedure_description ILIKE '%neuter%'
          ) AS alterations_12m,
          COUNT(DISTINCT a.cat_id) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM ops.appointments a2
              WHERE a2.cat_id = a.cat_id
                AND a2.appointment_date < a.appointment_date
            )
          ) AS new_cats_12m
        FROM ops.appointments a
        JOIN sot.cat_place cp ON cp.cat_id = a.cat_id
        WHERE cp.place_id = $1
          AND a.appointment_date >= CURRENT_DATE - INTERVAL '12 months'
      ),
      pop_est AS (
        SELECT estimated_population
        FROM beacon.estimate_colony_population($1, 365)
        WHERE place_id IS NOT NULL
        LIMIT 1
      )
      SELECT
        COALESCE(pc.cat_count, 0)::int AS cat_count,
        COALESCE(pc.altered_count, 0)::int AS altered_count,
        COALESCE(ra.total_appointments_12m, 0)::int AS total_appointments_12m,
        COALESCE(ra.alterations_12m, 0)::int AS alterations_12m,
        COALESCE(ra.new_cats_12m, 0)::int AS new_cats_12m,
        pe.estimated_population::int
      FROM place_cats pc
      CROSS JOIN recent_activity ra
      LEFT JOIN pop_est pe ON TRUE
    `, [placeId]);

    if (!stats || stats.cat_count === 0) {
      return apiBadRequest("No cat data found for this place");
    }

    const initialPop = stats.estimated_population || stats.cat_count;
    const initialAltered = stats.altered_count;

    // Derive monthly rates from 12-month history
    const monthlyAlterationRate = stats.cat_count > 0
      ? (stats.alterations_12m / 12) / Math.max(stats.cat_count - stats.altered_count, 1)
      : 0;
    const monthlyIntakeRate = stats.new_cats_12m / 12;

    // Baseline: continue at current rate
    const baseline = generateForecast(
      initialPop, initialAltered, monthlyAlterationRate, monthlyIntakeRate, months
    );

    // Optimistic: what if we reach 75% alteration rate within 2 years
    const optimisticRate = Math.max(monthlyAlterationRate * 2, 0.05);
    const optimistic = generateForecast(
      initialPop, initialAltered, optimisticRate, monthlyIntakeRate, months
    );

    // Aggressive: maximal effort — 75% target monthly throughput
    const aggressiveRate = Math.max(monthlyAlterationRate * 4, 0.10);
    const aggressive = generateForecast(
      initialPop, initialAltered, aggressiveRate, monthlyIntakeRate, months
    );

    // Find months to 75% threshold for each scenario
    const findThresholdMonth = (points: ForecastPoint[], threshold: number) => {
      const point = points.find(p => p.alteration_rate >= threshold);
      return point ? point.month : null;
    };

    return apiSuccess({
      place_id: placeId,
      current: {
        population: initialPop,
        altered: initialAltered,
        alteration_rate: initialPop > 0 ? Math.round((initialAltered / initialPop) * 1000) / 10 : 0,
        monthly_alteration_rate: Math.round(monthlyAlterationRate * 1000) / 10,
        monthly_intake_rate: Math.round(monthlyIntakeRate * 10) / 10,
      },
      scenarios: {
        baseline: {
          label: "Current Rate",
          description: "Continue at current TNR pace",
          points: baseline,
          months_to_75: findThresholdMonth(baseline, 75),
          final_population: baseline[baseline.length - 1].population,
          final_alteration_rate: baseline[baseline.length - 1].alteration_rate,
          total_procedures: baseline[baseline.length - 1].cumulative_procedures,
        },
        optimistic: {
          label: "Double Effort",
          description: "Double current monthly alteration rate",
          points: optimistic,
          months_to_75: findThresholdMonth(optimistic, 75),
          final_population: optimistic[optimistic.length - 1].population,
          final_alteration_rate: optimistic[optimistic.length - 1].alteration_rate,
          total_procedures: optimistic[optimistic.length - 1].cumulative_procedures,
        },
        aggressive: {
          label: "Maximum Effort",
          description: "Quadruple current monthly alteration rate",
          points: aggressive,
          months_to_75: findThresholdMonth(aggressive, 75),
          final_population: aggressive[aggressive.length - 1].population,
          final_alteration_rate: aggressive[aggressive.length - 1].alteration_rate,
          total_procedures: aggressive[aggressive.length - 1].cumulative_procedures,
        },
      },
      meta: {
        projection_months: months,
        model: "discrete_monthly_dynamics",
        assumptions: {
          annual_attrition_rate: "15%",
          reproduction_rate: "~1 surviving kitten per unaltered cat per year",
          scientific_references: [
            "Levy JK et al. (2014) - 70-75% sterilization threshold for population stabilization",
            "McCarthy RJ et al. (2013) - Population dynamics of free-roaming cats",
          ],
        },
      },
    });
  } catch (error) {
    console.error("Error generating forecast:", error);
    return apiServerError("Failed to generate population forecast");
  }
}
