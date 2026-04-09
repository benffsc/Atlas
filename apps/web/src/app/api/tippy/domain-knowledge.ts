/**
 * Tippy Domain Knowledge Module
 *
 * Centralizes all FFSC-specific expertise that makes Tippy an expert agent.
 * This module should be the single source of truth for:
 * - TNR/FFR science and thresholds
 * - Geographic knowledge (Sonoma County regions)
 * - Operational definitions (roles, statuses)
 * - Data source authorities
 *
 * @see /docs/TIPPY_ARCHITECTURE.md for design principles
 */

// =============================================================================
// TNR/FFR SCIENCE
// =============================================================================

export const TNR_SCIENCE = {
  /**
   * Alteration rate thresholds based on scientific research.
   * The 70% threshold is validated for population stabilization.
   */
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

  /**
   * The scientifically validated threshold for population stabilization.
   * Below this, population will likely continue growing.
   */
  stabilization_threshold: 70,

  /**
   * Mass trapping event definition.
   * When 10+ cats are processed in a single day at a location.
   */
  mass_trapping: {
    threshold: 10,
    significance:
      "Shows coordinated TNR effort between trapper, caretaker, and clinic. Can stabilize a colony in one day.",
    ideal_conditions:
      "Good trapper, cooperative cats, established feeding routine, fast clinic turnaround",
  },
} as const;

/**
 * Get the alteration status category for a given rate.
 */
export function getAlterationCategory(rate: number): {
  label: string;
  description: string;
  action: string;
} {
  const thresholds = TNR_SCIENCE.alteration_thresholds;
  if (rate >= thresholds.under_control.min) return thresholds.under_control;
  if (rate >= thresholds.good_progress.min) return thresholds.good_progress;
  if (rate >= thresholds.needs_attention.min) return thresholds.needs_attention;
  return thresholds.early_stages;
}

// =============================================================================
// SONOMA COUNTY GEOGRAPHY
// =============================================================================

export const SONOMA_GEOGRAPHY = {
  /**
   * Regional groupings of cities/areas in Sonoma County.
   * Used to expand regional queries like "west county" into constituent cities.
   */
  regions: {
    "west county": [
      "Sebastopol",
      "Forestville",
      "Graton",
      "Occidental",
      "Bodega",
      "Bodega Bay",
      "Freestone",
    ],
    "russian river": [
      "Guerneville",
      "Monte Rio",
      "Forestville",
      "Rio Nido",
      "Duncans Mills",
      "Jenner",
      "Cazadero",
    ],
    "north county": [
      "Healdsburg",
      "Cloverdale",
      "Geyserville",
      "Windsor",
      "Asti",
    ],
    "south county": ["Petaluma", "Penngrove", "Cotati", "Rohnert Park"],
    "wine country": [
      "Healdsburg",
      "Sonoma",
      "Glen Ellen",
      "Kenwood",
      "Geyserville",
    ],
    "sonoma valley": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs"],
    "the springs": [
      "Boyes Hot Springs",
      "El Verano",
      "Fetters Hot Springs",
      "Agua Caliente",
    ],
    coastal: ["Bodega Bay", "Jenner", "Sea Ranch", "Stewarts Point", "Gualala"],
    roseland: ["Roseland"], // Specific neighborhood in Santa Rosa (95407)
  },

  /**
   * Major cities in Sonoma County by approximate population.
   */
  major_cities: [
    "Santa Rosa",
    "Petaluma",
    "Rohnert Park",
    "Windsor",
    "Healdsburg",
    "Sebastopol",
    "Sonoma",
    "Cloverdale",
    "Cotati",
  ],

  /**
   * Zip codes for specific areas (for detailed queries).
   */
  zip_codes: {
    "95407": "Roseland / Southwest Santa Rosa",
    "95401": "Downtown Santa Rosa",
    "95403": "Northwest Santa Rosa / Fulton",
    "95404": "East Santa Rosa / Bennett Valley",
    "95405": "Southeast Santa Rosa",
    "95409": "Oakmont / Annadel",
    "95472": "Sebastopol",
    "95448": "Healdsburg",
    "95452": "Kenwood",
    "95476": "Sonoma",
  },
} as const;

/**
 * Expand a regional query into constituent cities.
 * Returns the input if it's already a specific city.
 */
export function expandRegion(region: string): string[] {
  const normalized = region.toLowerCase().trim();
  const regionCities =
    SONOMA_GEOGRAPHY.regions[normalized as keyof typeof SONOMA_GEOGRAPHY.regions];
  if (regionCities) return [...regionCities];

  // Check if it's a major city
  const matchedCity = SONOMA_GEOGRAPHY.major_cities.find(
    (city) => city.toLowerCase() === normalized
  );
  if (matchedCity) return [matchedCity];

  // Return as-is (might be a specific address or unknown area)
  return [region];
}

// =============================================================================
// OPERATIONAL DEFINITIONS
// =============================================================================

export const OPERATIONS = {
  /**
   * Role definitions for people in the system.
   */
  roles: {
    caretaker: {
      description: "Feeds colony regularly, knows the cats",
      is_ffsc: false,
      typical_relationship: "Long-term colony management",
    },
    resident: {
      description: "Lives at the address",
      is_ffsc: false,
      typical_relationship: "May or may not be involved in TNR",
    },
    colony_caretaker: {
      description: "Specifically manages a feral cat colony",
      is_ffsc: false,
      typical_relationship: "Active participant in TNR coordination",
    },
    ffsc_trapper: {
      description: "FFSC-trained volunteer trapper (completed orientation)",
      is_ffsc: true,
      typical_relationship: "Represents FFSC in the field",
    },
    community_trapper: {
      description: "Signed contract only, limited scope",
      is_ffsc: false,
      typical_relationship: "Does NOT represent FFSC",
    },
    coordinator: {
      description: "FFSC staff coordinator",
      is_ffsc: true,
      typical_relationship: "Manages trapping operations",
    },
    head_trapper: {
      description: "FFSC head trapper",
      is_ffsc: true,
      typical_relationship: "Lead trapper for region/operation",
    },
  },

  /**
   * Request status definitions.
   */
  request_statuses: {
    new: "Request submitted, awaiting triage",
    triaged: "Assessed, waiting for trapper assignment",
    scheduled: "Trapping scheduled",
    in_progress: "Active trapping underway",
    on_hold: "Temporarily paused (weather, access, etc.)",
    completed: "TNR work finished at this location",
    cancelled: "Request cancelled (resolved, duplicate, etc.)",
  },

  /**
   * Place context types.
   */
  place_contexts: {
    colony_site: "Active feral cat colony location",
    foster_home: "Approved foster parent's residence",
    adopter_residence: "Where adopted cat now lives",
    volunteer_location: "Volunteer's home/base",
    trapper_base: "Trapper's staging area",
    clinic: "Spay/neuter clinic location",
    shelter: "Animal shelter facility",
    partner_org: "Partner organization location",
  },
} as const;

// =============================================================================
// DATA SOURCE AUTHORITIES
// =============================================================================

export const DATA_SOURCES = {
  /**
   * What each data source is authoritative for.
   * Use this to route queries to the correct source.
   */
  authorities: {
    clinichq: {
      authoritative_for: [
        "Clinic appointments",
        "TNR procedures",
        "Medical records",
        "Microchips",
        "Vaccination records",
      ],
      not_authoritative_for: ["Volunteers", "Program outcomes", "Foster placements"],
      ground_truth_for: "All clinic-based medical data",
    },
    shelterluv: {
      authoritative_for: [
        "Foster placements",
        "Adoptions",
        "Intake events",
        "Program animals",
        "Outcome tracking",
      ],
      not_authoritative_for: ["Volunteer management", "Clinic procedures"],
      ground_truth_for: "Cat outcomes and placements",
    },
    volunteerhub: {
      authoritative_for: [
        "Volunteer records",
        "Trapper certifications",
        "Training status",
        "Group memberships",
      ],
      not_authoritative_for: ["Animals", "Clinic data"],
      ground_truth_for: "Who is a certified trapper/volunteer",
    },
    airtable: {
      authoritative_for: ["Legacy requests", "Historical data", "Public intake"],
      not_authoritative_for: ["Current volunteer status", "Clinic data"],
      note: "Being phased out in favor of Beacon",
    },
    petlink: {
      authoritative_for: ["Microchip registry lookups"],
      not_authoritative_for: ["Everything else"],
      caveat:
        "Some emails are fabricated by staff for registration. Filter confidence >= 0.5",
    },
  },

  /**
   * Semantic query routing.
   * When user asks about X, query Y source.
   */
  query_routing: {
    fosters: {
      people: "VolunteerHub group 'Approved Foster Parent'",
      cats: "ShelterLuv Outcome.Foster events",
    },
    trappers: {
      people: "VolunteerHub group 'Approved Trappers'",
    },
    adopters: {
      people: "ShelterLuv Outcome.Adoption events",
    },
    volunteers: {
      people: "VolunteerHub 'Approved Volunteer' parent group",
    },
    clinic_clients: {
      people: "ClinicHQ owner records",
    },
  },
} as const;

// =============================================================================
// INTERPRETATION HELPERS
// =============================================================================

/**
 * Interpret a place's situation for staff communication.
 */
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
  const rate =
    data.total_cats > 0
      ? Math.round((data.altered_cats / data.total_cats) * 100)
      : 0;
  const category = getAlterationCategory(rate);

  const caveats: string[] = [];

  // Check for NULL status issues
  if (
    data.null_status_count &&
    data.null_status_count > data.total_cats * 0.5
  ) {
    caveats.push(
      `${data.null_status_count} of ${data.total_cats} cats have unknown status - the ${rate}% rate may not reflect reality`
    );
  }

  // Check for suspicious low rates
  if (rate < 20 && data.total_cats > 50 && !data.null_status_count) {
    caveats.push(
      "This rate seems very low for a colony this size - may be a data gap"
    );
  }

  // Note disease issues
  if (data.disease_positives && data.disease_positives > 0) {
    caveats.push(
      `${data.disease_positives} disease-positive cats require special handling`
    );
  }

  const headline =
    data.total_cats === 0
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

/**
 * Format a number for human-readable output.
 */
export function formatCount(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
  }
  return n.toLocaleString();
}

// =============================================================================
// EXPORT ALL
// =============================================================================

export const DOMAIN_KNOWLEDGE = {
  TNR_SCIENCE,
  SONOMA_GEOGRAPHY,
  OPERATIONS,
  DATA_SOURCES,
  helpers: {
    getAlterationCategory,
    expandRegion,
    interpretPlaceSituation,
    formatCount,
  },
} as const;

export default DOMAIN_KNOWLEDGE;
