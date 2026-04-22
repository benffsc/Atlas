/**
 * Tippy V2 Knowledge Module
 *
 * Centralizes TNR science, Sonoma County geography, data quality awareness,
 * and place status assessment. Single source of truth for domain knowledge
 * that Tippy tools and the system prompt reference.
 *
 * Merges data-quality.ts + domain-knowledge.ts, removes dead code.
 *
 * @see /docs/TIPPY_ARCHITECTURE.md
 * @see FFS-1328
 */

// =============================================================================
// TNR / FFR SCIENCE
// =============================================================================

export const TNR_SCIENCE = {
  alteration_thresholds: {
    under_control: {
      min: 90,
      label: "Under Control",
      description: "Population is stable, breeding effectively stopped",
      action: "Maintain monitoring, address any new arrivals promptly",
    },
    good_progress: {
      min: 70,
      max: 89,
      label: "Good Progress",
      description: "Significant impact but not yet stable",
      action: "Continue TNR efforts, focus on remaining unaltered cats",
    },
    needs_attention: {
      min: 50,
      max: 69,
      label: "Needs Attention",
      description: "Active breeding likely continuing",
      action: "Prioritize this location for trapping resources",
    },
    early_stages: {
      min: 0,
      max: 49,
      label: "Early Stages",
      description: "Substantial work still needed",
      action: "Consider mass trapping event if possible",
    },
  },

  stabilization_threshold: 70,

  mass_trapping: {
    threshold: 10,
    significance:
      "Shows coordinated TNR effort between trapper, caretaker, and clinic. Can stabilize a colony in one day.",
    ideal_conditions:
      "Good trapper, cooperative cats, established feeding routine, fast clinic turnaround",
  },
} as const;

export function getAlterationCategory(rate: number): {
  label: string;
  description: string;
  action: string;
} {
  const t = TNR_SCIENCE.alteration_thresholds;
  if (rate >= t.under_control.min) return t.under_control;
  if (rate >= t.good_progress.min) return t.good_progress;
  if (rate >= t.needs_attention.min) return t.needs_attention;
  return t.early_stages;
}

// =============================================================================
// SONOMA COUNTY GEOGRAPHY
// =============================================================================

/**
 * Comprehensive regional mappings for Sonoma County and surrounding areas.
 * Used by expandRegion() and getAreaSearchPatterns() to expand regional
 * queries into constituent cities.
 *
 * Merged from V1 tools.ts REGIONAL_MAPPINGS + domain-knowledge.ts
 * SONOMA_GEOGRAPHY.regions. The tools.ts version is authoritative
 * (more comprehensive, battle-tested).
 */
export const REGIONAL_MAPPINGS: Record<string, string[]> = {
  // West County / Russian River
  "west county": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Occidental", "Graton", "Sebastopol", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande", "Freestone", "Twin Hills"],
  "west sonoma": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Occidental", "Graton", "Sebastopol", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande", "Freestone"],
  "russian river": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande"],
  "river": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero"],
  "river towns": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Duncans Mills"],
  "lower river": ["Guerneville", "Monte Rio", "Jenner", "Duncans Mills"],

  // Sonoma Valley
  "sonoma valley": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "El Verano", "Eldridge", "Vineburg", "Agua Caliente", "Fetters Hot Springs", "Schellville"],
  "the valley": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "El Verano", "Eldridge", "Vineburg", "Agua Caliente", "Fetters Hot Springs"],
  "valley of the moon": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs"],
  "the springs": ["Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs", "El Verano"],
  "springs": ["Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs", "El Verano"],
  "boyes": ["Boyes Hot Springs"],
  "fetters": ["Fetters Hot Springs"],
  "agua caliente": ["Agua Caliente"],

  // North County
  "north county": ["Cloverdale", "Geyserville", "Healdsburg", "Windsor", "Asti"],
  "northern sonoma": ["Cloverdale", "Geyserville", "Healdsburg", "Windsor", "Asti", "Lytton"],
  "upper county": ["Cloverdale", "Geyserville", "Healdsburg"],
  "alexander valley": ["Geyserville", "Cloverdale", "Asti", "Jimtown", "Lytton"],
  "dry creek": ["Healdsburg", "Geyserville"],
  "dry creek valley": ["Healdsburg", "Geyserville"],

  // South County
  "south county": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove", "Two Rock", "Lakeville", "Bloomfield"],
  "southern sonoma": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove", "Two Rock", "Lakeville"],
  "south sonoma": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove"],
  "east petaluma": ["Petaluma"],
  "west petaluma": ["Petaluma"],
  "penngrove": ["Penngrove"],
  "two rock": ["Two Rock"],

  // Coastal
  "coast": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Annapolis", "Valley Ford", "Freestone", "Salmon Creek"],
  "coastal": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Annapolis", "Valley Ford"],
  "sonoma coast": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Valley Ford", "Salmon Creek"],
  "bodega": ["Bodega Bay", "Bodega"],

  // Santa Rosa neighborhoods
  "santa rosa": ["Santa Rosa", "Fountaingrove", "Coffey Park", "Bennett Valley", "Rincon Valley", "Roseland", "Montgomery Village", "Railroad Square", "Oakmont", "Skyhawk", "Spring Lake", "Junior College", "Northwest Santa Rosa", "South Park", "Downtown Santa Rosa"],
  "fountaingrove": ["Fountaingrove", "Santa Rosa"],
  "coffey park": ["Coffey Park", "Santa Rosa"],
  "bennett valley": ["Bennett Valley", "Santa Rosa"],
  "rincon valley": ["Rincon Valley", "Santa Rosa"],
  "rincon": ["Rincon Valley", "Santa Rosa"],
  "roseland": ["Roseland", "Santa Rosa"],
  "montgomery village": ["Montgomery Village", "Santa Rosa"],
  "railroad square": ["Railroad Square", "Santa Rosa"],
  "oakmont": ["Oakmont", "Santa Rosa"],
  "skyhawk": ["Skyhawk", "Santa Rosa"],
  "junior college": ["Junior College", "Santa Rosa"],
  "jc area": ["Junior College", "Santa Rosa"],
  "south park": ["South Park", "Santa Rosa"],
  "downtown santa rosa": ["Downtown Santa Rosa", "Santa Rosa"],

  // Mark West / Larkfield
  "mark west": ["Larkfield", "Wikiup", "Mark West", "Fulton"],
  "larkfield": ["Larkfield", "Wikiup", "Mark West"],
  "wikiup": ["Larkfield", "Wikiup"],
  "larkfield-wikiup": ["Larkfield", "Wikiup", "Mark West"],
  "fulton": ["Fulton"],

  // Individual cities
  "rohnert park": ["Rohnert Park"],
  "cotati": ["Cotati"],
  "rp": ["Rohnert Park"],
  "healdsburg": ["Healdsburg"],
  "windsor": ["Windsor"],

  // Broad groupings
  "wine country": ["Santa Rosa", "Healdsburg", "Sonoma", "Glen Ellen", "Kenwood", "Sebastopol", "Windsor", "Geyserville"],
  "central county": ["Santa Rosa", "Rohnert Park", "Cotati", "Windsor"],
  "101 corridor": ["Santa Rosa", "Rohnert Park", "Cotati", "Petaluma", "Windsor", "Healdsburg", "Cloverdale"],

  // Surrounding counties
  "marin": ["Novato", "San Rafael", "Petaluma", "Mill Valley", "Sausalito", "Corte Madera", "Larkspur", "San Anselmo", "Fairfax", "Ross", "Tiburon", "Belvedere", "Kentfield", "Greenbrae", "Terra Linda", "Lucas Valley", "Marinwood", "Ignacio", "Hamilton", "Strawberry", "Tamalpais Valley", "Marin City", "Stinson Beach", "Bolinas", "Point Reyes", "Inverness", "Olema", "Tomales"],
  "marin county": ["Novato", "San Rafael", "Mill Valley", "Sausalito", "Corte Madera", "Larkspur", "San Anselmo", "Fairfax", "Tiburon", "Kentfield", "Terra Linda", "Marinwood", "Ignacio"],
  "novato": ["Novato"],
  "san rafael": ["San Rafael", "Terra Linda", "Lucas Valley"],
  "napa": ["Napa", "American Canyon", "Calistoga", "St. Helena", "Yountville", "Angwin", "Deer Park", "Rutherford", "Oakville", "Pope Valley", "Lake Berryessa"],
  "napa county": ["Napa", "American Canyon", "Calistoga", "St. Helena", "Yountville", "Angwin"],
  "napa valley": ["Napa", "Yountville", "St. Helena", "Calistoga", "Rutherford", "Oakville"],
  "calistoga": ["Calistoga"],
  "st helena": ["St. Helena"],
  "american canyon": ["American Canyon"],
  "lake": ["Clearlake", "Lakeport", "Kelseyville", "Lower Lake", "Middletown", "Cobb", "Hidden Valley Lake", "Clearlake Oaks", "Nice", "Lucerne", "Upper Lake"],
  "lake county": ["Clearlake", "Lakeport", "Kelseyville", "Lower Lake", "Middletown", "Cobb", "Hidden Valley Lake"],
  "clearlake": ["Clearlake", "Clearlake Oaks"],
  "lakeport": ["Lakeport"],
  "middletown": ["Middletown", "Hidden Valley Lake"],
  "mendocino": ["Ukiah", "Fort Bragg", "Willits", "Mendocino", "Point Arena", "Hopland", "Boonville", "Philo", "Navarro", "Albion", "Elk", "Gualala", "Laytonville", "Covelo", "Redwood Valley", "Talmage"],
  "mendocino county": ["Ukiah", "Fort Bragg", "Willits", "Mendocino", "Point Arena", "Hopland", "Boonville"],
  "ukiah": ["Ukiah", "Redwood Valley", "Talmage"],
  "fort bragg": ["Fort Bragg"],
  "willits": ["Willits"],
  "anderson valley": ["Boonville", "Philo", "Navarro"],
  "solano": ["Vallejo", "Fairfield", "Vacaville", "Benicia", "Suisun City", "Dixon", "Rio Vista", "Green Valley"],
  "solano county": ["Vallejo", "Fairfield", "Vacaville", "Benicia", "Suisun City"],
  "vallejo": ["Vallejo"],
  "fairfield": ["Fairfield"],
  "benicia": ["Benicia"],
  "east bay": ["Oakland", "Berkeley", "Richmond", "Concord", "Walnut Creek", "Fremont", "Hayward", "San Leandro", "Alameda", "El Cerrito", "Albany", "Emeryville", "Piedmont", "Orinda", "Lafayette", "Moraga", "Pleasant Hill", "Martinez", "Antioch", "Pittsburg", "Brentwood"],
  "contra costa": ["Richmond", "Concord", "Walnut Creek", "Martinez", "Antioch", "Pittsburg", "Brentwood", "Pleasant Hill", "Lafayette", "Orinda", "Moraga", "El Cerrito", "San Pablo", "Pinole", "Hercules"],
  "alameda county": ["Oakland", "Berkeley", "Fremont", "Hayward", "San Leandro", "Alameda", "Albany", "Emeryville", "Piedmont", "Newark", "Union City", "Castro Valley", "Livermore", "Pleasanton", "Dublin"],
  "oakland": ["Oakland"],
  "berkeley": ["Berkeley"],
  "richmond": ["Richmond", "El Cerrito", "San Pablo"],
  "san francisco": ["San Francisco"],
  "sf": ["San Francisco"],
  "the city": ["San Francisco"],
  "peninsula": ["San Mateo", "Daly City", "South San Francisco", "Redwood City", "Palo Alto", "Mountain View", "San Bruno", "Burlingame", "San Carlos", "Belmont", "Foster City", "Millbrae", "Pacifica", "Half Moon Bay"],
  "san mateo": ["San Mateo", "Daly City", "South San Francisco", "Redwood City", "San Bruno", "Burlingame"],
  "north bay": ["Santa Rosa", "Petaluma", "Novato", "San Rafael", "Napa", "Vallejo", "Fairfield", "Sonoma", "Healdsburg"],
  "bay area": ["San Francisco", "Oakland", "San Jose", "Berkeley", "Fremont", "Santa Rosa", "Hayward", "Sunnyvale", "Concord", "Vallejo"],
  "greater sonoma": ["Santa Rosa", "Petaluma", "Sonoma", "Healdsburg", "Sebastopol", "Rohnert Park", "Windsor", "Cloverdale", "Novato", "Napa"],
  "out of county": ["Novato", "San Rafael", "Napa", "Vallejo", "Ukiah", "Clearlake", "Oakland", "San Francisco"],
  "out of area": ["Novato", "San Rafael", "Napa", "Vallejo", "Ukiah", "Clearlake", "Oakland", "San Francisco", "Sacramento", "Stockton"],
};

export const MAJOR_CITIES = [
  "Santa Rosa", "Petaluma", "Rohnert Park", "Windsor",
  "Healdsburg", "Sebastopol", "Sonoma", "Cloverdale", "Cotati",
];

/**
 * Expand a regional query into constituent cities.
 * Uses REGIONAL_MAPPINGS first, falls back to major city match,
 * then returns input as-is.
 */
export function expandRegion(region: string): string[] {
  const normalized = region.toLowerCase().trim();

  // Check regional mappings (comprehensive)
  for (const [key, cities] of Object.entries(REGIONAL_MAPPINGS)) {
    if (normalized === key || normalized.includes(key) || key.includes(normalized)) {
      return [...cities];
    }
  }

  // Check major cities
  const matchedCity = MAJOR_CITIES.find(
    (city) => city.toLowerCase() === normalized
  );
  if (matchedCity) return [matchedCity];

  return [region];
}

/**
 * Get search patterns for an area. Thin wrapper over expandRegion
 * that always returns city names suitable for SQL WHERE clauses.
 */
export function getAreaSearchPatterns(area: string): string[] {
  return expandRegion(area);
}

// =============================================================================
// KNOWN DATA GAPS
// =============================================================================

export interface DataGap {
  id: string;
  name: string;
  status: "open" | "fixed" | "wont_fix" | "monitoring";
  impact: string;
  caveat: string;
  workaround?: string;
}

export const KNOWN_GAPS: Record<string, DataGap> = {
  DATA_GAP_056: {
    id: "DATA_GAP_056",
    name: "Shared Phone Cross-Linking",
    status: "monitoring",
    impact: "Some older records may have wrong person-place links due to shared phone numbers in households",
    caveat: "If data seems inconsistent (person linked to wrong address), acknowledge possible data quality issues from historical imports",
    workaround: "Check person's relationship types and dates to verify",
  },
  DATA_GAP_057: {
    id: "DATA_GAP_057",
    name: "ShelterLuv Sync Stale",
    status: "open",
    impact: "Foster/adoption outcomes may be incomplete - sync has been stale",
    caveat: "ShelterLuv foster data isn't fully synced yet, so I can't show foster placements from this location",
    workaround: "Acknowledge the limitation and explain it will populate when sync runs",
  },
  DATA_GAP_058: {
    id: "DATA_GAP_058",
    name: "Places Without Address Links",
    status: "open",
    impact: "32% of places (3,497) have no linked sot_address_id despite having formatted_address",
    caveat: "City totals may undercount due to missing address links",
  },
  DATA_GAP_059: {
    id: "DATA_GAP_059",
    name: "NULL Altered Status",
    status: "open",
    impact: "Many legacy cats have NULL altered_status (unknown), creating misleading low alteration rates",
    caveat: "Most of these cats have unknown status from legacy imports, not confirmed unaltered",
    workaround: "Distinguish between NULL (unknown) and 'intact' (confirmed unaltered) in responses",
  },
};

// =============================================================================
// SUSPICIOUS PATTERNS
// =============================================================================

export interface SuspiciousPattern {
  pattern: string;
  detection: (data: Record<string, unknown>) => boolean;
  likely_cause: string;
  recommendation: string;
  severity: "info" | "warning" | "critical";
}

export const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  {
    pattern: "Very low alteration rate with many cats",
    detection: (data) => {
      const rate = data.alteration_rate as number;
      const total = data.total_cats as number;
      return rate < 20 && total > 50;
    },
    likely_cause: "NULL altered_status from legacy ClinicHQ data imports",
    recommendation: "Check NULL count before treating as priority. May be data gap, not real rate.",
    severity: "warning",
  },
  {
    pattern: "Person linked to 50+ places",
    detection: (data) => (data.place_count as number) > 50,
    likely_cause: "Organization, FFSC staff member, or active trapper - not resident",
    recommendation: "Filter by relationship type to find residential connections",
    severity: "info",
  },
  {
    pattern: "Cat at 10+ places",
    detection: (data) => (data.cat_place_count as number) > 10,
    likely_cause: "Cat_place_relationship pollution from entity linking bugs (pre-MIG_889)",
    recommendation: "Use most recent relationship only, or appointment-based place",
    severity: "warning",
  },
  {
    pattern: "Zero cats at place with active request",
    detection: (data) => (data.cat_count as number) === 0 && (data.has_active_request as boolean),
    likely_cause: "Request submitted but cats not yet processed through clinic",
    recommendation: "Check request's estimated_cat_count for expected population",
    severity: "info",
  },
  {
    pattern: "Large gap between reported and verified cats",
    detection: (data) => {
      const reported = data.reported_cats as number;
      const verified = data.verified_cats as number;
      return reported > 0 && verified < reported * 0.5;
    },
    likely_cause: "Untrapped potential - cats seen by caretaker but not yet processed",
    recommendation: "This is a clear priority for trapping resources",
    severity: "info",
  },
];

export function checkSuspiciousPatterns(
  data: Record<string, unknown>
): SuspiciousPattern[] {
  return SUSPICIOUS_PATTERNS.filter((p) => {
    try { return p.detection(data); } catch { return false; }
  });
}

// =============================================================================
// CAVEATS & EXPLANATION TEMPLATES
// =============================================================================

export const CAVEATS = {
  null_vs_intact: `A cat with NULL altered_status means "unknown" - we haven't recorded the status. This is different from "intact" (confirmed unaltered). Legacy ClinicHQ imports often have NULL status.`,

  null_status_rate: (nullCount: number, total: number, rate: number) =>
    `This place shows a ${rate}% alteration rate, but ${nullCount} of ${total} cats have unknown status - the actual rate could be different.`,

  reported_vs_verified: `Caretakers count cats at the food bowl; we count verified clinic visits. The gap tells us how much work remains. Both are valid - they're just measuring different things.`,

  reported_gap: (reported: number, verified: number) =>
    `The caretaker reported ${reported} cats but we've only verified ${verified} through the clinic. That's ${reported - verified} cats potentially still unfixed.`,

  legacy_data: `Data entered before 2024 was with less rigorous practices. Some historical links may be inaccurate. We use more recent data with higher confidence.`,

  shelterluv_sync: `ShelterLuv foster/adoption data isn't fully synced yet. The infrastructure is ready - once the sync runs, this will populate automatically.`,

  minimum_bounds: `Our numbers are "minimum bounds" - the actual population is likely higher. We only know about cats that came through our clinic or were reported to us.`,

  geographic_gaps: `Low data in an area doesn't mean low cats - it might mean low outreach. Rural areas, wealthier neighborhoods, and agricultural properties often have unreported populations.`,
} as const;

// =============================================================================
// DATA QUALITY CHECKS
// =============================================================================

export function getPlaceDataCaveats(data: {
  total_cats: number;
  altered_cats: number;
  null_status_count?: number;
  reported_cats?: number;
  has_active_request?: boolean;
  source_systems?: string[];
}): string[] {
  const caveats: string[] = [];
  const rate = data.total_cats > 0
    ? Math.round((data.altered_cats / data.total_cats) * 100)
    : 0;

  if (data.null_status_count !== undefined) {
    const nullPercent = data.total_cats > 0
      ? Math.round((data.null_status_count / data.total_cats) * 100)
      : 0;
    if (nullPercent > 50) {
      caveats.push(
        CAVEATS.null_status_rate(data.null_status_count, data.total_cats, rate)
      );
    }
  } else if (rate < 20 && data.total_cats > 50) {
    caveats.push(
      `This ${rate}% rate seems low for a colony of ${data.total_cats} cats - this may be a data gap from legacy imports.`
    );
  }

  if (data.reported_cats && data.reported_cats > data.total_cats) {
    caveats.push(
      CAVEATS.reported_gap(data.reported_cats, data.total_cats)
    );
  }

  if (
    data.source_systems &&
    data.source_systems.length === 1 &&
    data.source_systems[0] === "airtable"
  ) {
    caveats.push(
      "This data is from legacy Airtable records - may not reflect current state."
    );
  }

  return caveats;
}

export interface GapMatch {
  id: string;
  name: string;
  caveat: string;
  status: DataGap["status"];
}

export function matchesGapTrigger(data: {
  total_cats: number;
  altered_cats: number;
  null_status_count?: number;
  intact_confirmed?: number;
  rate_overall?: number;
}): GapMatch[] {
  const matches: GapMatch[] = [];

  const gap059 = KNOWN_GAPS.DATA_GAP_059;
  if (data.null_status_count !== undefined && data.total_cats > 0) {
    const nullPct = (data.null_status_count / data.total_cats) * 100;
    if (nullPct > 50 || (data.null_status_count > 10 && (data.rate_overall ?? 0) < 50)) {
      matches.push({ id: gap059.id, name: gap059.name, caveat: gap059.caveat, status: gap059.status });
    }
  } else if (data.total_cats > 50 && data.rate_overall !== undefined && data.rate_overall < 20) {
    matches.push({ id: gap059.id, name: gap059.name, caveat: gap059.caveat, status: gap059.status });
  }

  return matches;
}

// =============================================================================
// PLACE SITUATION INTERPRETATION
// =============================================================================

export function interpretPlaceSituation(data: {
  total_cats: number;
  altered_cats: number;
  null_status_count?: number;
  has_active_request?: boolean;
  recent_mass_trapping?: boolean;
  disease_positives?: number;
}): {
  headline: string;
  status: string;
  caveats: string[];
  next_steps: string;
} {
  const rate = data.total_cats > 0
    ? Math.round((data.altered_cats / data.total_cats) * 100)
    : 0;
  const category = getAlterationCategory(rate);
  const caveats: string[] = [];

  if (data.null_status_count && data.null_status_count > data.total_cats * 0.5) {
    caveats.push(
      `${data.null_status_count} of ${data.total_cats} cats have unknown status - the ${rate}% rate may not reflect reality`
    );
  }
  if (rate < 20 && data.total_cats > 50 && !data.null_status_count) {
    caveats.push("This rate seems very low for a colony this size - may be a data gap");
  }
  if (data.disease_positives && data.disease_positives > 0) {
    caveats.push(`${data.disease_positives} disease-positive cats require special handling`);
  }

  const headline = data.total_cats === 0
    ? "No cats recorded at this location"
    : `${data.total_cats} cats, ${rate}% altered`;

  return {
    headline,
    status: category.label,
    caveats,
    next_steps: data.has_active_request
      ? "Active request in progress"
      : category.action,
  };
}

// =============================================================================
// PLACE STATUS ASSESSMENT (FFS-1311)
// =============================================================================

export type PlaceStatusLevel =
  | "stabilized"
  | "recently_managed"
  | "under_control"
  | "active_work"
  | "good_progress"
  | "needs_attention";

/**
 * Multi-dimensional place status assessment.
 *
 * Goes beyond raw alteration rate to consider:
 * - Request lifecycle (is there active work?)
 * - Recency (when was the last appointment?)
 * - Reported-vs-verified gap (how much is left?)
 * - Data quality (is the rate trustworthy?)
 */
export function assessPlaceStatus(data: {
  alteration_rate: number;
  total_cats: number;
  null_status_count?: number;
  has_active_request?: boolean;
  last_appointment_days_ago?: number;
  reported_cats?: number;
  verified_cats?: number;
}): {
  level: PlaceStatusLevel;
  label: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
} {
  const rate = data.alteration_rate;
  const nullPct = data.null_status_count && data.total_cats > 0
    ? (data.null_status_count / data.total_cats) * 100
    : 0;

  // Low confidence if most cats have unknown status
  if (nullPct > 60) {
    return {
      level: "needs_attention",
      label: "Unknown — Mostly Legacy Data",
      confidence: "low",
      reasoning: `${Math.round(nullPct)}% of cats have unknown status from legacy imports. Can't assess reliably.`,
    };
  }

  // Active work trumps rate
  if (data.has_active_request) {
    return {
      level: "active_work",
      label: "Active Work",
      confidence: "high",
      reasoning: "Active request in progress — TNR work is ongoing at this location.",
    };
  }

  // Stabilized: high rate + recent activity + low gap
  if (rate >= 90 && data.last_appointment_days_ago !== undefined && data.last_appointment_days_ago < 365) {
    return {
      level: "stabilized",
      label: "Stabilized",
      confidence: nullPct > 30 ? "medium" : "high",
      reasoning: `${rate}% altered with clinic activity within the last year. Colony appears stable.`,
    };
  }

  // Recently managed: high rate but stale
  if (rate >= 90) {
    return {
      level: "recently_managed",
      label: "Previously Managed",
      confidence: "medium",
      reasoning: `${rate}% altered but no recent clinic activity. May need a check-in.`,
    };
  }

  if (rate >= 70) {
    return {
      level: "good_progress",
      label: "Good Progress",
      confidence: nullPct > 30 ? "medium" : "high",
      reasoning: `${rate}% altered — above the 70% stabilization threshold but not yet fully controlled.`,
    };
  }

  return {
    level: "needs_attention",
    label: "Needs Attention",
    confidence: nullPct > 30 ? "low" : "medium",
    reasoning: `${rate}% altered — below the 70% threshold. ${
      data.reported_cats && data.verified_cats
        ? `Caretaker reports ${data.reported_cats} cats, we've verified ${data.verified_cats}.`
        : "Active breeding likely."
    }`,
  };
}
