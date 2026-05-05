import { useMemo } from "react";
import type { AtlasPin } from "@/components/map";

// ── TNR Population Model Constants ──

/** Average litters per intact female per year */
const LITTERS_PER_YEAR = 2;
/** Average kittens per litter */
const KITTENS_PER_LITTER = 5;
/** Feral kitten survival rate to adulthood */
const KITTEN_SURVIVAL = 0.25;
/** Surviving adults per intact female per year */
const ADULTS_PER_INTACT_FEMALE = LITTERS_PER_YEAR * KITTENS_PER_LITTER * KITTEN_SURVIVAL; // 2.5
/** Annual adult attrition rate (matches ops.app_config) */
const ANNUAL_ATTRITION = 0.13;
/** Monthly attrition factor */
const MONTHLY_ATTRITION = 1 - Math.pow(1 - ANNUAL_ATTRITION, 1 / 12);
/** TNR stabilization threshold */
const STABILIZATION_RATE = 0.75;
/** Default cost per TNR procedure (USD) */
export const DEFAULT_COST_PER_CAT = 65;

/**
 * Seasonal breeding multiplier by month (0-11).
 * Peak Feb-Oct, low Nov-Jan. Normalized so annual sum = 12.
 */
const SEASONAL_WEIGHTS = [
  0.3,  // Jan
  0.8,  // Feb
  1.2,  // Mar
  1.5,  // Apr
  1.6,  // May
  1.5,  // Jun
  1.4,  // Jul
  1.3,  // Aug
  1.1,  // Sep
  0.8,  // Oct
  0.3,  // Nov
  0.2,  // Dec
];

// ── Types ──

export interface ForecastSnapshot {
  month: number;
  population: number;
  altered: number;
  intact: number;
  alterationRate: number;
}

export interface ForecastScenario {
  label: string;
  snapshots: ForecastSnapshot[];
  /** Population at end of projection */
  endPopulation: number;
  /** Change from current */
  changePercent: number;
}

export type ConfidenceLevel = "low" | "medium" | "high";

export interface HexForecast {
  // ── Current state ──
  totalCats: number;
  totalAltered: number;
  intactEstimate: number;
  currentAlterationRate: number;

  // ── TNR velocity ──
  /** Cats altered per month (observed) */
  tnrVelocity: number;
  /** Confidence in velocity estimate */
  confidence: ConfidenceLevel;
  /** Number of activity data points used */
  activityDataPoints: number;
  /** Months of activity data span */
  activitySpanMonths: number;

  // ── Breakeven ──
  /** Minimum cats/month to offset breeding */
  breakevenRate: number;

  // ── Target ──
  /** Cats needed to reach 75% alteration */
  catsToTarget: number;
  /** Months to reach 75% at current pace (Infinity if never) */
  monthsToTarget: number;

  // ── Risk score ──
  /** 1-10 composite risk score */
  riskScore: number;
  riskLabel: string;

  // ── Cost ──
  /** Cost to reach 75% at given cost per cat */
  costToTarget: number;
  /** Monthly cost at current pace */
  monthlyCost: number;

  // ── Scenarios ──
  noAction: ForecastScenario;
  currentPace: ForecastScenario;
  whatIf: ForecastScenario;
}

// ── Helpers ──

function calcTnrVelocity(pins: AtlasPin[]): { velocity: number; confidence: ConfidenceLevel; dataPoints: number; spanMonths: number } {
  const dates: number[] = [];
  for (const pin of pins) {
    if (pin.last_alteration_at) {
      dates.push(new Date(pin.last_alteration_at).getTime());
    }
  }

  if (dates.length < 2) {
    // Not enough data — estimate from total altered over assumed timespan
    const totalAltered = pins.reduce((s, p) => s + (p.total_altered || 0), 0);
    return {
      velocity: totalAltered > 0 ? totalAltered / 24 : 0, // assume 2 years
      confidence: "low",
      dataPoints: dates.length,
      spanMonths: 0,
    };
  }

  dates.sort((a, b) => a - b);
  const earliest = dates[0];
  const latest = dates[dates.length - 1];
  const spanMs = latest - earliest;
  const spanMonths = Math.max(1, spanMs / (30.44 * 86400000));

  // Total altered cats across all pins
  const totalAltered = pins.reduce((s, p) => s + (p.total_altered || 0), 0);
  const velocity = totalAltered / spanMonths;

  let confidence: ConfidenceLevel = "low";
  if (dates.length >= 5 && spanMonths >= 6) confidence = "high";
  else if (dates.length >= 3 && spanMonths >= 3) confidence = "medium";

  return { velocity, confidence, dataPoints: dates.length, spanMonths };
}

function calcRiskScore(pins: AtlasPin[], alterationRate: number, velocity: number, breakevenRate: number): { score: number; label: string } {
  let score = 0;

  // Low alteration rate (0-3 points)
  if (alterationRate < 0.3) score += 3;
  else if (alterationRate < 0.5) score += 2;
  else if (alterationRate < 0.75) score += 1;

  // High intact count (0-2 points)
  const intact = pins.reduce((s, p) => s + Math.max(p.cat_count - (p.total_altered || 0), 0), 0);
  if (intact > 20) score += 2;
  else if (intact > 10) score += 1;

  // Disease presence (0-2 points)
  const diseaseCount = pins.filter(p => p.disease_risk).length;
  if (diseaseCount >= 3) score += 2;
  else if (diseaseCount >= 1) score += 1;

  // Stale data (0-1 point)
  const now = Date.now();
  const staleCount = pins.filter(p => {
    if (!p.last_alteration_at) return true;
    return (now - new Date(p.last_alteration_at).getTime()) > 730 * 86400000; // 2 years
  }).length;
  if (staleCount > pins.length * 0.5) score += 1;

  // Below breakeven velocity (0-2 points)
  if (velocity < breakevenRate * 0.5) score += 2;
  else if (velocity < breakevenRate) score += 1;

  score = Math.min(10, Math.max(1, score));

  let label: string;
  if (score <= 3) label = "Low";
  else if (score <= 6) label = "Moderate";
  else if (score <= 8) label = "High";
  else label = "Critical";

  return { score, label };
}

/**
 * Run a month-by-month population simulation.
 * @param months — number of months to project
 * @param startPop — starting total population
 * @param startAltered — starting altered count
 * @param tnrPerMonth — cats altered per month in this scenario
 * @param startMonth — calendar month (0-11) to start seasonal weighting
 */
function simulate(
  months: number,
  startPop: number,
  startAltered: number,
  tnrPerMonth: number,
  startMonth: number,
): ForecastSnapshot[] {
  const snapshots: ForecastSnapshot[] = [];
  let pop = startPop;
  let altered = startAltered;

  for (let m = 1; m <= months; m++) {
    const calMonth = (startMonth + m) % 12;
    const intact = Math.max(pop - altered, 0);
    const intactFemales = intact / 2;

    // Seasonal breeding
    const seasonalFactor = SEASONAL_WEIGHTS[calMonth];
    const monthlyBirths = (intactFemales * ADULTS_PER_INTACT_FEMALE / 12) * seasonalFactor * KITTEN_SURVIVAL;
    // Note: ADULTS_PER_INTACT_FEMALE already includes KITTEN_SURVIVAL, so don't double-apply.
    // Correcting: monthly births from intact females
    const monthlyNewAdults = (intactFemales * LITTERS_PER_YEAR * KITTENS_PER_LITTER * KITTEN_SURVIVAL / 12) * seasonalFactor;

    // Attrition
    const deaths = pop * MONTHLY_ATTRITION;

    // TNR (can't alter more than remaining intact)
    const tnrThisMonth = Math.min(tnrPerMonth, Math.max(pop - altered, 0));

    pop = Math.max(1, pop + monthlyNewAdults - deaths);
    altered = Math.min(pop, altered + tnrThisMonth);

    // Record snapshots at key intervals
    if (m === 12 || m === 60 || m === 120 || m === months) {
      snapshots.push({
        month: m,
        population: Math.round(pop),
        altered: Math.round(altered),
        intact: Math.round(Math.max(pop - altered, 0)),
        alterationRate: pop > 0 ? Math.round((altered / pop) * 100) : 0,
      });
    }
  }

  return snapshots;
}

// ── Hook ──

export function useHexForecast(
  pins: AtlasPin[],
  /** User-adjustable "what if" TNR rate (cats/month) */
  whatIfRate: number,
  /** Cost per TNR procedure */
  costPerCat: number = DEFAULT_COST_PER_CAT,
): HexForecast {
  return useMemo(() => {
    const totalCats = pins.reduce((s, p) => s + p.cat_count, 0);
    const totalAltered = pins.reduce((s, p) => s + (p.total_altered || 0), 0);
    const intactEstimate = Math.max(totalCats - totalAltered, 0);
    const currentAlterationRate = totalCats > 0 ? totalAltered / totalCats : 0;

    // TNR velocity
    const vel = calcTnrVelocity(pins);

    // Breakeven: monthly births from intact females must equal monthly TNR
    // At breakeven, new adults/month = tnr/month
    // new adults/month = (intact/2) * ADULTS_PER_INTACT_FEMALE / 12 * avg_seasonal
    // avg_seasonal ≈ 1 (weights sum to ~12)
    const intactFemales = intactEstimate / 2;
    const monthlyGrowth = (intactFemales * ADULTS_PER_INTACT_FEMALE) / 12;
    const breakevenRate = Math.max(0, monthlyGrowth - totalCats * MONTHLY_ATTRITION);

    // Target: cats to reach 75%
    const catsToTarget = Math.max(0, Math.ceil(totalCats * STABILIZATION_RATE - totalAltered));
    const monthsToTarget = vel.velocity > 0 ? Math.ceil(catsToTarget / vel.velocity) : Infinity;

    // Risk
    const risk = calcRiskScore(pins, currentAlterationRate, vel.velocity, breakevenRate);

    // Cost
    const costToTarget = catsToTarget * costPerCat;
    const monthlyCost = vel.velocity * costPerCat;

    // Scenarios — simulate 120 months (10 years)
    const startMonth = new Date().getMonth();
    const projectionMonths = 120;

    const noActionSnaps = simulate(projectionMonths, totalCats, totalAltered, 0, startMonth);
    const currentPaceSnaps = simulate(projectionMonths, totalCats, totalAltered, vel.velocity, startMonth);
    const whatIfSnaps = simulate(projectionMonths, totalCats, totalAltered, whatIfRate, startMonth);

    function toScenario(label: string, snaps: ForecastSnapshot[]): ForecastScenario {
      const last = snaps[snaps.length - 1];
      return {
        label,
        snapshots: snaps,
        endPopulation: last?.population ?? totalCats,
        changePercent: totalCats > 0 ? Math.round(((last?.population ?? totalCats) - totalCats) / totalCats * 100) : 0,
      };
    }

    return {
      totalCats,
      totalAltered,
      intactEstimate,
      currentAlterationRate,
      tnrVelocity: Math.round(vel.velocity * 10) / 10,
      confidence: vel.confidence,
      activityDataPoints: vel.dataPoints,
      activitySpanMonths: Math.round(vel.spanMonths),
      breakevenRate: Math.round(breakevenRate * 10) / 10,
      catsToTarget,
      monthsToTarget,
      riskScore: risk.score,
      riskLabel: risk.label,
      costToTarget,
      monthlyCost: Math.round(monthlyCost),
      noAction: toScenario("No Intervention", noActionSnaps),
      currentPace: toScenario("Current Pace", currentPaceSnaps),
      whatIf: toScenario("Custom Rate", whatIfSnaps),
    };
  }, [pins, whatIfRate, costPerCat]);
}
