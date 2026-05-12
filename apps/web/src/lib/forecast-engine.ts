/**
 * Shared population forecast engine.
 *
 * Extracted from /api/beacon/forecast to be reused by:
 *   - /api/beacon/forecast (place-level projection)
 *   - /api/beacon/impact/projection (org-level alteration rate projection)
 *
 * Scientific basis:
 *   - Levy et al. (2014): 70-75% sterilization for population stabilization
 *   - McCarthy et al. (2013): Population dynamics of free-roaming cats
 */

export interface ForecastPoint {
  month: number;
  date: string;
  population: number;
  altered: number;
  unaltered: number;
  alteration_rate: number;
  cumulative_procedures: number;
}

export interface ForecastParams {
  initialPop: number;
  initialAltered: number;
  monthlyAlterationRate: number;
  monthlyIntakeRate: number;
  months: number;
  /** Annual attrition rate (default 0.15 = 15%) */
  annualAttritionRate?: number;
  /** Annual kittens surviving per unaltered cat (default 1.0) */
  annualReproductionPerUnaltered?: number;
}

export function generateForecast(params: ForecastParams): ForecastPoint[] {
  const {
    initialPop,
    initialAltered,
    monthlyAlterationRate,
    monthlyIntakeRate,
    months,
    annualAttritionRate = 0.15,
    annualReproductionPerUnaltered = 1.0,
  } = params;

  const points: ForecastPoint[] = [];
  let population = initialPop;
  let altered = initialAltered;
  let cumulativeProcedures = 0;

  const monthlyAttrition = 1 - Math.pow(1 - annualAttritionRate, 1 / 12);
  const monthlyReproduction = annualReproductionPerUnaltered / 12;

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

    // 1. New arrivals (unaltered cats)
    population += monthlyIntakeRate;

    // 2. Reproduction from unaltered cats
    const newKittens = unaltered * monthlyReproduction;
    population += newKittens;

    // 3. Attrition (affects both altered and unaltered proportionally)
    const attritionLoss = population * monthlyAttrition;
    const alteredRatio = population > 0 ? altered / population : 0;
    altered -= attritionLoss * alteredRatio;
    population -= attritionLoss;

    // 4. Alteration procedures this month
    const unalteredNow = Math.max(population - altered, 0);
    const proceduresThisMonth = Math.min(
      unalteredNow * monthlyAlterationRate,
      unalteredNow
    );
    altered += proceduresThisMonth;
    cumulativeProcedures += proceduresThisMonth;

    // Floor at 0
    population = Math.max(population, 0);
    altered = Math.max(Math.min(altered, population), 0);
  }

  return points;
}

/** Find the first month where alteration rate reaches threshold */
export function findThresholdMonth(
  points: ForecastPoint[],
  threshold: number
): number | null {
  const point = points.find((p) => p.alteration_rate >= threshold);
  return point ? point.month : null;
}
