/**
 * Tippy Data Quality Module
 *
 * Centralizes knowledge of data gaps, quality issues, and caveats.
 * Tippy should reference this module to:
 * - Acknowledge known limitations honestly
 * - Flag suspicious patterns
 * - Explain why data might differ between systems
 *
 * @see /docs/DATA_GAPS.md for full documentation
 * @see /docs/TIPPY_ARCHITECTURE.md for design principles
 */

// =============================================================================
// KNOWN DATA GAPS
// =============================================================================

export interface DataGap {
  id: string;
  name: string;
  status: "open" | "fixed" | "wont_fix" | "monitoring";
  impact: string;
  caveat: string;
  check?: string;
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
    check: "SELECT * FROM ops.v_shelterluv_sync_status",
    workaround: "Acknowledge the limitation and explain it will populate when sync runs",
  },

  DATA_GAP_058: {
    id: "DATA_GAP_058",
    name: "Places Without Address Links",
    status: "open",
    impact: "32% of places (3,497) have no linked sot_address_id despite having formatted_address",
    caveat: "City totals may undercount due to missing address links",
    workaround: "MIG_2530 extracts city directly from display_name for analysis",
  },

  DATA_GAP_059: {
    id: "DATA_GAP_059",
    name: "NULL Altered Status",
    status: "open",
    impact: "Many legacy cats have NULL altered_status (unknown), creating misleading low alteration rates",
    caveat: "Most of these cats have unknown status from legacy imports, not confirmed unaltered",
    check: "When alteration_rate < 50% and total_cats > 50, count NULL status cats",
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
    detection: (data) => {
      const placeCount = data.place_count as number;
      return placeCount > 50;
    },
    likely_cause: "Organization, FFSC staff member, or active trapper - not resident",
    recommendation: "Filter by relationship type to find residential connections",
    severity: "info",
  },
  {
    pattern: "Cat at 10+ places",
    detection: (data) => {
      const placeCount = data.cat_place_count as number;
      return placeCount > 10;
    },
    likely_cause: "Cat_place_relationship pollution from entity linking bugs (pre-MIG_889)",
    recommendation: "Use most recent relationship only, or appointment-based place",
    severity: "warning",
  },
  {
    pattern: "Zero cats at place with active request",
    detection: (data) => {
      const catCount = data.cat_count as number;
      const hasRequest = data.has_active_request as boolean;
      return catCount === 0 && hasRequest;
    },
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

/**
 * Check data for suspicious patterns and return any matches.
 */
export function checkSuspiciousPatterns(
  data: Record<string, unknown>
): SuspiciousPattern[] {
  return SUSPICIOUS_PATTERNS.filter((pattern) => {
    try {
      return pattern.detection(data);
    } catch {
      return false;
    }
  });
}

// =============================================================================
// EXPLANATION TEMPLATES
// =============================================================================

export const CAVEATS = {
  // NULL vs Actual Values
  null_vs_intact: `A cat with NULL altered_status means "unknown" - we haven't recorded the status. This is different from "intact" (confirmed unaltered). Legacy ClinicHQ imports often have NULL status.`,

  null_status_rate: (nullCount: number, total: number, rate: number) =>
    `This place shows a ${rate}% alteration rate, but ${nullCount} of ${total} cats have unknown status - the actual rate could be different.`,

  // Reported vs Verified
  reported_vs_verified: `Caretakers count cats at the food bowl; we count verified clinic visits. The gap tells us how much work remains. Both are valid - they're just measuring different things.`,

  reported_gap: (reported: number, verified: number) =>
    `The caretaker reported ${reported} cats but we've only verified ${verified} through the clinic. That's ${reported - verified} cats potentially still unfixed.`,

  // Legacy Data
  legacy_data: `Data entered before 2024 was with less rigorous practices. Some historical links may be inaccurate. We use more recent data with higher confidence.`,

  // Sync Issues
  shelterluv_sync: `ShelterLuv foster/adoption data isn't fully synced yet. The infrastructure is ready - once the sync runs, this will populate automatically.`,

  // Data Completeness
  minimum_bounds: `Our numbers are "minimum bounds" - the actual population is likely higher. We only know about cats that came through our clinic or were reported to us.`,

  // Geographic Gaps
  geographic_gaps: `Low data in an area doesn't mean low cats - it might mean low outreach. Rural areas, wealthier neighborhoods, and agricultural properties often have unreported populations.`,
} as const;

// =============================================================================
// DATA QUALITY CHECKS
// =============================================================================

/**
 * Pre-response quality check for place data.
 * Returns caveats that should be mentioned in the response.
 */
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

  // Check for NULL status issue
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
    // No NULL count provided but rate is suspiciously low
    caveats.push(
      `This ${rate}% rate seems low for a colony of ${data.total_cats} cats - this may be a data gap from legacy imports.`
    );
  }

  // Check for reported vs verified gap
  if (data.reported_cats && data.reported_cats > data.total_cats) {
    caveats.push(
      CAVEATS.reported_gap(data.reported_cats, data.total_cats)
    );
  }

  // Note if only from legacy sources
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

/**
 * Get the appropriate caveat for a known data gap.
 */
export function getGapCaveat(gapId: string): string | null {
  const gap = KNOWN_GAPS[gapId];
  return gap?.caveat ?? null;
}

/**
 * Check if a response should include data quality warnings.
 */
export function shouldWarnAboutDataQuality(context: {
  involves_legacy_data?: boolean;
  low_alteration_rate?: boolean;
  shelterluv_query?: boolean;
  large_place_count?: boolean;
}): boolean {
  return (
    context.involves_legacy_data ||
    context.low_alteration_rate ||
    context.shelterluv_query ||
    context.large_place_count ||
    false
  );
}

// =============================================================================
// SOURCE SYSTEM RELIABILITY
// =============================================================================

export const SOURCE_RELIABILITY = {
  clinichq: {
    confidence: 0.95,
    description: "Ground truth for clinic visits and procedures",
    caveats: ["Historical owner names may be site names, not people"],
  },
  shelterluv: {
    confidence: 0.9,
    description: "Reliable for program outcomes",
    caveats: ["Sync may be stale - check ops.v_shelterluv_sync_status"],
  },
  volunteerhub: {
    confidence: 0.85,
    description: "Good for volunteer/trapper info",
    caveats: ["Training status may lag actual completion"],
  },
  airtable: {
    confidence: 0.7,
    description: "Legacy data, being phased out",
    caveats: ["Data practices were informal", "Colony sizes may be outdated"],
  },
  petlink: {
    confidence: 0.5,
    description: "Microchip registry - some fabricated emails",
    caveats: ["Filter identifier confidence >= 0.5", "Staff fabricates emails for registration"],
  },
  web_intake: {
    confidence: 0.6,
    description: "Self-reported by requesters",
    caveats: ["Cat counts are estimates", "Address may need verification"],
  },
  atlas_ui: {
    confidence: 0.9,
    description: "Staff-entered via Atlas interface",
    caveats: ["Most reliable recent data"],
  },
} as const;

// =============================================================================
// EXPORT ALL
// =============================================================================

export const DATA_QUALITY = {
  KNOWN_GAPS,
  SUSPICIOUS_PATTERNS,
  CAVEATS,
  SOURCE_RELIABILITY,
  helpers: {
    checkSuspiciousPatterns,
    getPlaceDataCaveats,
    getGapCaveat,
    shouldWarnAboutDataQuality,
  },
} as const;

export default DATA_QUALITY;
