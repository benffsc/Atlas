/**
 * Tippy V2 Tools — 52 V1 tools consolidated into 15 composites.
 *
 * Architecture:
 *   - Shared entity resolvers (resolvePlace, resolvePerson, resolveCat)
 *   - wrapPlaceResult + buildNarrativeSeed (from V1, unchanged)
 *   - 15 tool schemas in TIPPY_V2_TOOLS
 *   - 15 implementation functions
 *   - TOOL_DISPATCH map + executeToolCallV2 export
 *
 * @see /docs/TIPPY_ARCHITECTURE.md
 * @see FFS-1328
 */

import { queryOne, queryRows, execute } from "@/lib/db";
import { logFieldEdits } from "@/lib/audit";
import { TERMINAL_PAIR_SQL } from "@/lib/request-status";
import {
  interpretPlaceSituation,
  expandRegion,
  getAreaSearchPatterns,
  getPlaceDataCaveats,
  checkSuspiciousPatterns,
  matchesGapTrigger,
  assessPlaceStatus,
  type GapMatch,
} from "./knowledge";

// =============================================================================
// TYPES
// =============================================================================

export interface ToolResultPattern {
  pattern: string;
  likely_cause: string;
  recommendation: string;
  severity: "info" | "warning" | "critical";
}

export interface ToolResultCatMeta {
  total_count?: number;
  altered_count?: number;
  intact_confirmed?: number;
  null_status_count?: number;
  rate_among_known?: number;
  rate_overall?: number;
}

export interface ToolResultNarrativeSeed {
  headline?: string;
  key_people?: string[];
  data_conflicts?: string[];
  recommended_actions?: string[];
  suggested_followups?: string[];
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  caveats?: string[];
  suspicious_patterns?: ToolResultPattern[];
  known_gaps?: GapMatch[];
  meta?: ToolResultCatMeta;
  narrative_seed?: ToolResultNarrativeSeed;
}

export interface ActionCardPayload {
  card_id: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string;
  proposed_changes: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface ToolContext {
  staffId: string;
  staffName: string;
  aiAccessLevel: string;
  conversationId?: string;
  recentToolResults?: ToolResult[];
  emitActionCard?: (card: ActionCardPayload) => void;
}

// =============================================================================
// SHARED ENTITY RESOLVERS
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolvePlace(
  addressOrId: string
): Promise<{ place_id: string; display_name: string | null; formatted_address: string | null } | null> {
  if (UUID_REGEX.test(addressOrId)) {
    return queryOne(
      `SELECT place_id, display_name, formatted_address
       FROM sot.places
       WHERE place_id = $1 AND merged_into_place_id IS NULL`,
      [addressOrId]
    );
  }
  return queryOne(
    `SELECT place_id, display_name, formatted_address
     FROM sot.places
     WHERE (display_name ILIKE $1 OR formatted_address ILIKE $1)
       AND merged_into_place_id IS NULL
     ORDER BY CASE WHEN display_name ILIKE $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [`%${addressOrId}%`]
  );
}

async function resolvePerson(
  identifier: string
): Promise<{ person_id: string; display_name: string | null } | null> {
  const byName = await queryOne<{ person_id: string; display_name: string | null }>(
    `SELECT person_id, display_name
     FROM sot.people
     WHERE display_name ILIKE $1
       AND merged_into_person_id IS NULL
       AND is_canonical = TRUE
     LIMIT 1`,
    [`%${identifier}%`]
  );
  if (byName) return byName;

  return queryOne<{ person_id: string; display_name: string | null }>(
    `SELECT p.person_id, p.display_name
     FROM sot.people p
     JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
     WHERE pi.id_value_norm = LOWER($1)
       AND pi.confidence >= 0.5
       AND p.merged_into_person_id IS NULL
     LIMIT 1`,
    [identifier]
  );
}

async function resolveCat(
  identifier: string
): Promise<{ cat_id: string; display_name: string | null } | null> {
  const byChip = await queryOne<{ cat_id: string; display_name: string | null }>(
    `SELECT c.cat_id, c.display_name
     FROM sot.cats c
     JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
     WHERE ci.id_value = $1 AND c.merged_into_cat_id IS NULL
     LIMIT 1`,
    [identifier.replace(/\s/g, "")]
  );
  if (byChip) return byChip;

  return queryOne<{ cat_id: string; display_name: string | null }>(
    `SELECT cat_id, display_name
     FROM sot.cats
     WHERE display_name ILIKE $1 AND merged_into_cat_id IS NULL
     LIMIT 1`,
    [`%${identifier}%`]
  );
}

function parseSqlResult(result: unknown): unknown {
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }
  return result;
}

// =============================================================================
// wrapPlaceResult — auto-applies data quality signals to place-shaped results
// =============================================================================

function wrapPlaceResult(
  rawData: Record<string, unknown>,
  options: {
    total_cats: number;
    altered_cats: number;
    intact_confirmed?: number;
    null_status_count?: number;
    has_active_request?: boolean;
    reported_cats?: number;
    source_systems?: string[];
  }
): ToolResult {
  const total = options.total_cats || 0;
  const altered = options.altered_cats || 0;
  const intactConfirmed = options.intact_confirmed;
  const nullCount = options.null_status_count;

  const knownDenom =
    intactConfirmed !== undefined ? altered + intactConfirmed : undefined;
  const rateAmongKnown =
    knownDenom !== undefined && knownDenom > 0
      ? Math.round((altered / knownDenom) * 100)
      : undefined;

  const rateOverall = total > 0 ? Math.round((altered / total) * 100) : 0;

  const caveats = getPlaceDataCaveats({
    total_cats: total,
    altered_cats: altered,
    null_status_count: nullCount,
    reported_cats: options.reported_cats,
    has_active_request: options.has_active_request,
    source_systems: options.source_systems,
  });

  const patterns = checkSuspiciousPatterns({
    alteration_rate: rateOverall,
    total_cats: total,
    has_active_request: options.has_active_request ?? false,
  });

  const knownGaps = matchesGapTrigger({
    total_cats: total,
    altered_cats: altered,
    null_status_count: nullCount,
    intact_confirmed: intactConfirmed,
    rate_overall: rateOverall,
  });

  const result: ToolResult = {
    success: true,
    data: rawData,
  };

  if (caveats.length > 0) result.caveats = caveats;
  if (patterns.length > 0) {
    result.suspicious_patterns = patterns.map((p) => ({
      pattern: p.pattern,
      likely_cause: p.likely_cause,
      recommendation: p.recommendation,
      severity: p.severity,
    }));
  }
  if (knownGaps.length > 0) result.known_gaps = knownGaps;

  result.meta = {
    total_count: total,
    altered_count: altered,
    intact_confirmed: intactConfirmed,
    null_status_count: nullCount,
    rate_among_known: rateAmongKnown,
    rate_overall: rateOverall,
  };

  return result;
}

// =============================================================================
// buildNarrativeSeed — pre-processed narrative hints for the model
// =============================================================================

function buildNarrativeSeed(input: {
  place_name?: string | null;
  google_maps_notes?: Array<{
    original_content: string | null;
    ai_summary: string | null;
    ai_meaning: string | null;
  }>;
  clinic_account_notes?: Array<{
    display_name: string | null;
    quick_notes: string | null;
    long_notes: string | null;
  }>;
  recent_requests?: Array<{
    status: string;
    resolution: string | null;
    hold_reason: string | null;
    notes: string | null;
  }>;
  meta?: ToolResultCatMeta;
}): ToolResultNarrativeSeed | undefined {
  const keyPeople = new Set<string>();
  const dataConflicts: string[] = [];
  const recommendedActions: string[] = [];
  const suggestedFollowups: string[] = [];
  let headline: string | undefined;

  const allTextParts: string[] = [];
  for (const n of input.google_maps_notes ?? []) {
    if (n.original_content) allTextParts.push(n.original_content);
    if (n.ai_summary) allTextParts.push(n.ai_summary);
  }
  for (const n of input.clinic_account_notes ?? []) {
    if (n.quick_notes) allTextParts.push(n.quick_notes);
    if (n.long_notes) allTextParts.push(n.long_notes);
    if (n.display_name) allTextParts.push(n.display_name);
  }
  for (const r of input.recent_requests ?? []) {
    if (r.notes) allTextParts.push(r.notes);
    if (r.resolution) allTextParts.push(r.resolution);
    if (r.hold_reason) allTextParts.push(r.hold_reason);
  }
  const haystack = allTextParts.join(" \n ").toLowerCase();

  // Donna Best (FFSC founder) pattern
  if (/\bdonna\b/.test(haystack)) {
    keyPeople.add("Donna Best (FFSC founder) -- referenced in notes");
    suggestedFollowups.push(
      "Want me to surface every place referencing Donna so you can see her legacy network?"
    );
  }

  // Tenant/caretaker named in notes
  const tenantMatch = haystack.match(
    /([a-z][a-z']{2,15})\s+the\s+(?:tenant|feeder|caretaker)/i
  );
  if (tenantMatch) {
    const name =
      tenantMatch[1].charAt(0).toUpperCase() + tenantMatch[1].slice(1);
    keyPeople.add(`${name} (tenant/caretaker, named in notes)`);
  }
  const tenantInline = haystack.match(
    /tenant[^\n]{0,40}?(?:named\s+|is\s+)?([A-Z][a-z]+)/
  );
  if (tenantInline && !tenantMatch) {
    keyPeople.add(`${tenantInline[1]} (tenant, named in notes)`);
  }

  // Paused / on hold
  const pausedRequest = (input.recent_requests ?? []).find(
    (r) =>
      r.status !== "completed" && r.status !== "cancelled" && r.hold_reason
  );
  if (pausedRequest) {
    recommendedActions.push(
      `There's a paused request here. Hold reason: "${pausedRequest.hold_reason}". Surface this before suggesting new TNR work.`
    );
  }

  // Intact-vs-euthanasia conflict
  const intactConfirmed = input.meta?.intact_confirmed ?? 0;
  if (intactConfirmed > 0 && /euthani[sz]/.test(haystack)) {
    dataConflicts.push(
      `Records show ${intactConfirmed} confirmed-intact cat(s), but notes also reference euthanasia. Resolve in prose: which cats are still here vs which were lost.`
    );
  }

  // Managed colony
  if (
    /(managed|stable|under control|donna colony|long.?standing)/.test(haystack)
  ) {
    headline = input.place_name
      ? `${input.place_name} reads as a managed colony with FFSC institutional context, not a fresh intake.`
      : `This place reads as a managed colony with FFSC institutional context, not a fresh intake.`;
  }

  // Data scarcity headline
  if (
    !headline &&
    input.meta?.null_status_count !== undefined &&
    input.meta.total_count !== undefined &&
    input.meta.total_count > 0
  ) {
    const nullPct =
      (input.meta.null_status_count / input.meta.total_count) * 100;
    if (nullPct > 60) {
      headline = `Most cats here have unknown status from legacy imports -- the alteration rate looks low but the truth is "we don't know", not "they're intact".`;
    }
  }

  if (
    !headline &&
    keyPeople.size === 0 &&
    dataConflicts.length === 0 &&
    recommendedActions.length === 0 &&
    suggestedFollowups.length === 0
  ) {
    return undefined;
  }

  return {
    headline,
    key_people: keyPeople.size > 0 ? Array.from(keyPeople) : undefined,
    data_conflicts: dataConflicts.length > 0 ? dataConflicts : undefined,
    recommended_actions:
      recommendedActions.length > 0 ? recommendedActions : undefined,
    suggested_followups:
      suggestedFollowups.length > 0 ? suggestedFollowups : undefined,
  };
}

// =============================================================================
// TOOL SCHEMAS (15 V2 tools)
// =============================================================================

export const TIPPY_V2_TOOLS = [
  // 1. run_sql
  {
    name: "run_sql",
    description: `Execute a read-only SQL query against the Atlas database. Use this to investigate data dynamically.

IMPORTANT: Only SELECT queries are allowed. The query will be rejected if it contains INSERT, UPDATE, DELETE, DROP, etc.

Use this tool to:
- Explore data patterns you're curious about
- Test hypotheses about the data
- Answer questions that don't fit pre-built tools
- Follow up on initial findings with deeper investigation

Example queries:
- "SELECT COUNT(*) FROM sot.cats WHERE altered_status = 'intact'"
- "SELECT city, COUNT(*) FROM sot.addresses GROUP BY city ORDER BY count DESC LIMIT 10"`,
    input_schema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "The SELECT query to execute",
        },
        reasoning: {
          type: "string",
          description:
            "Brief explanation of what you're trying to find out (for audit trail)",
        },
      },
      required: ["sql", "reasoning"],
    },
  },

  // 2. full_place_briefing
  {
    name: "full_place_briefing",
    description: `Get a COMPLETE briefing on a place in ONE call. Combines:
(1) Full colony report with people, cats, requests, appointments, disease testing, mass trapping events, status assessment, interpretation hints.
(2) Institutional knowledge: Google Maps notes (Donna colonies, tenant feeders), journal entries, request notes/hold reasons, ClinicHQ account notes.
(3) Cross-source ShelterLuv outcomes for cats from this place's requests (kittens taken into care, adoptions, transfers).
(4) Request intelligence: extracted key facts (cat counts, cooperation signals, health concerns) from request notes.

This is the PRIMARY tool for "tell me about [place]", "what's going on at [address]?", "situation at [location]". Use it whenever you need comprehensive place data.`,
    input_schema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description:
            "Address or place name. Works with roads too ('Pozzan Road Healdsburg').",
        },
        place_id: {
          type: "string",
          description:
            "UUID of the place. If provided, skips the address lookup.",
        },
      },
      required: [],
    },
  },

  // 3. place_search
  {
    name: "place_search",
    description:
      "Find places by address, street, or name. Returns matching places with cat counts, alteration rates, and request status. Also returns nearby_activity: active requests within 500m, recent appointments at neighboring locations, and trappers assigned to the area. Use for street queries or when you need the neighborhood picture.",
    input_schema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description: "Address or place name to search for",
        },
      },
      required: ["address"],
    },
  },

  // 4. person_lookup
  {
    name: "person_lookup",
    description: `Find a person and ALL their data from all sources. Searches across: Atlas core records (people, cats, requests), ClinicHQ appointments (owner/trapper roles), ShelterLuv (adopter, foster history), VolunteerHub (status, hours, groups), and cat relationships. Use for 'everything about [person]', 'who is [name]?', 'look up [email/phone]'.`,
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Email, phone number, or person name to search",
        },
        identifier_type: {
          type: "string",
          enum: ["email", "phone", "name", "auto"],
          description:
            "Type of identifier. Use 'auto' to detect automatically (default).",
        },
      },
      required: ["identifier"],
    },
  },

  // 5. cat_lookup
  {
    name: "cat_lookup",
    description: `Find a cat by microchip or name with full history. Returns: Atlas core data (status, color, breed), clinic appointments with procedures, ShelterLuv outcomes (foster/adoption), all connected people (owners, trappers, fosters), and places linked. Use for 'look up cat [microchip]', 'find cat named [name]', 'cat journey', 'cat history'.`,
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Microchip number, cat name, or ClinicHQ/ShelterLuv ID",
        },
        identifier_type: {
          type: "string",
          enum: ["microchip", "name", "clinichq_id", "shelterluv_id", "auto"],
          description:
            "Type of identifier. Use 'auto' to detect automatically (default).",
        },
      },
      required: ["identifier"],
    },
  },

  // 6. cat_search
  {
    name: "cat_search",
    description:
      "Search for cats by physical description (color, pattern, breed, sex). Use when someone asks about a specific looking cat at a location, e.g., 'find the orange tabby on Pozzan Road'. Note: only ~4.5% of cats have color data populated.",
    input_schema: {
      type: "object" as const,
      properties: {
        color: {
          type: "string",
          description:
            "Primary color (e.g., 'orange', 'black', 'white', 'gray', 'calico')",
        },
        pattern: {
          type: "string",
          description:
            "Color pattern (e.g., 'tabby', 'tuxedo', 'solid', 'bicolor')",
        },
        breed: {
          type: "string",
          description: "Breed (e.g., 'domestic shorthair', 'siamese')",
        },
        sex: {
          type: "string",
          enum: ["M", "F"],
          description: "Sex of the cat",
        },
        age_group: {
          type: "string",
          enum: ["kitten", "young", "adult", "senior"],
          description: "Approximate age group",
        },
        place_name: {
          type: "string",
          description: "Place name or address to narrow the search",
        },
      },
      required: [],
    },
  },

  // 7. area_stats
  {
    name: "area_stats",
    description: `City/region statistics and strategic analysis. Handles regional names (west county, russian river, wine country, north county, south county, sonoma valley, the springs, etc.) by expanding to constituent cities.

Use for: 'what's happening in west county?', 'cats in Petaluma', 'which city has the worst cat problem?', 'where should we focus resources?', 'FFR impact in Santa Rosa'.

Returns: places tracked, cat counts (altered/intact/unknown), alteration rates (both rate_among_known and rate_overall), request stats, colony estimates, FFR impact data, and strategic interpretation.`,
    input_schema: {
      type: "object" as const,
      properties: {
        area: {
          type: "string",
          description:
            "City or region name (e.g., 'Santa Rosa', 'west county', 'russian river')",
        },
        question: {
          type: "string",
          description:
            "The strategic question being asked (for context in analysis)",
        },
      },
      required: [],
    },
  },

  // 8. spatial_context
  {
    name: "spatial_context",
    description: `Geospatial analysis - USE THIS when asking about an address we may not have data for, or to understand nearby activity. Checks: 1) Exact match at address, 2) Nearby places within 50m/100m/500m/1km, 3) Hot zones (clusters of activity), 4) Nearest known location with distance. Use for 'any cats near [address]?', 'what's happening around [location]?', or when full_place_briefing returns no results.`,
    input_schema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description: "Address to analyze spatially",
        },
        lat: {
          type: "number",
          description: "Optional latitude if known (improves accuracy)",
        },
        lng: {
          type: "number",
          description: "Optional longitude if known (improves accuracy)",
        },
      },
      required: ["address"],
    },
  },

  // 9. compare_places
  {
    name: "compare_places",
    description:
      "Compare two addresses/places across multiple dimensions: cat counts, alteration rates, disease testing, requests, urgency. Use for 'compare X and Y', 'which is worse?', 'should we prioritize X or Y?'. Returns side-by-side comparison with recommendation.",
    input_schema: {
      type: "object" as const,
      properties: {
        address1: {
          type: "string",
          description: "First address to compare",
        },
        address2: {
          type: "string",
          description: "Second address to compare",
        },
      },
      required: ["address1", "address2"],
    },
  },

  // 10. find_priority_sites
  {
    name: "find_priority_sites",
    description: `Find PLACES with CONFIRMED-INTACT cats (not NULL status) that are NOT already being worked on. This is the POSITIVE-SIGNAL strategic tool -- use it when the user asks 'which places need TNR?', 'where should we focus?', 'priority areas for trapping'. Excludes blacklisted places automatically. If it returns zero results, that's a real answer -- say so, don't confabulate a priority list.`,
    input_schema: {
      type: "object" as const,
      properties: {
        area: {
          type: "string",
          description:
            "Optional city or region name (e.g., 'Santa Rosa', 'west county')",
        },
        min_intact: {
          type: "number",
          description:
            "Minimum confirmed-intact cats. Default 3. Raise to filter for larger targets.",
        },
        limit: {
          type: "number",
          description: "Max places to return. Default 15.",
        },
      },
      required: [],
    },
  },

  // 11. trapper_stats
  {
    name: "trapper_stats",
    description: `Trapper and staff queries. Handles trapper counts, lists, individual lookup, performance metrics, and FFSC staff info.

query_type values:
- "count": Total active trappers
- "list": List active trappers with names/types
- "individual": Specific trapper by name (requires name param)
- "summary": Overview stats (active counts, total clinic cats, avg cats/day)
- "by_type": Breakdown by trapper type
- "top_performers": Top trappers ranked by clinic cats
- "staff" / "staff_count" / "staff_list": Query FFSC staff (employees, NOT trappers)

IMPORTANT: Staff are paid FFSC employees. Trappers are volunteers. Use the staff query_types for staff questions.`,
    input_schema: {
      type: "object" as const,
      properties: {
        query_type: {
          type: "string",
          enum: [
            "count",
            "list",
            "individual",
            "summary",
            "by_type",
            "top_performers",
            "staff",
            "staff_count",
            "staff_list",
          ],
          description: "Type of query to run",
        },
        name: {
          type: "string",
          description:
            "For individual/staff lookup -- person name to search",
        },
        trapper_type: {
          type: "string",
          enum: [
            "all",
            "ffsc_trapper",
            "community_trapper",
            "coordinator",
            "head_trapper",
          ],
          description: "Filter by trapper type",
        },
        limit: {
          type: "number",
          description: "Max results for lists (default 10)",
        },
      },
      required: ["query_type"],
    },
  },

  // 12. request_stats
  {
    name: "request_stats",
    description:
      "Request pipeline statistics -- counts by status, recent activity, area breakdown, or pending requests. Use for 'how many open requests?', 'requests in Petaluma', 'request pipeline status'.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter_type: {
          type: "string",
          enum: ["recent", "by_status", "by_area", "pending"],
          description: "Type of statistics to retrieve",
        },
        area: {
          type: "string",
          description: "Optional area/city to filter by",
        },
      },
      required: ["filter_type"],
    },
  },

  // 13. create_reminder
  {
    name: "create_reminder",
    description: `Create a personal reminder for the current staff member. Use when they say 'Remind me to check on X', 'Don't let me forget...', 'I need to follow up on X next week'. Supports relative times like 'tomorrow', 'next week', 'in 3 days'. Can include contact info (name, phone, email, address) and link to entities.`,
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description:
            "Short title for the reminder (e.g., 'Check on Oak St colony')",
        },
        due_time: {
          type: "string",
          description:
            "When to remind -- accepts relative (tomorrow, next week, in 3 days, in 2 hours) or ISO date string",
        },
        notes: { type: "string", description: "Additional details or context" },
        contact_name: {
          type: "string",
          description: "Name of person to contact",
        },
        contact_phone: {
          type: "string",
          description: "Phone number to call/text",
        },
        contact_email: { type: "string", description: "Email address" },
        contact_address: { type: "string", description: "Street address" },
        contact_notes: {
          type: "string",
          description: "Additional context (referral source, translator info)",
        },
      },
      required: ["title", "due_time"],
    },
  },

  // 14. send_message
  {
    name: "send_message",
    description: `Send a message to another staff member. Use when user says 'Tell Ben that...', 'Let Sarah know...', 'Message the coordinator about...'. The message will appear on their /me dashboard. Can optionally link to an entity.`,
    input_schema: {
      type: "object" as const,
      properties: {
        recipient_name: {
          type: "string",
          description: "Name of the staff member to message",
        },
        subject: {
          type: "string",
          description: "Brief subject line (10 words max)",
        },
        content: {
          type: "string",
          description: "The message content -- include all relevant details",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Message priority. Use 'urgent' only for time-sensitive issues.",
        },
        entity_type: {
          type: "string",
          enum: ["place", "cat", "person", "request"],
          description: "Type of entity this message is about (optional)",
        },
        entity_identifier: {
          type: "string",
          description:
            "Address, cat name/microchip, person name/email, or request ID (optional)",
        },
      },
      required: ["recipient_name", "subject", "content"],
    },
  },

  // 15. log_event
  {
    name: "log_event",
    description: `Dispatcher for write operations. Routes by action_type:

- "field_event": Log a field event (trapping, observation, feeding, sighting). Use when staff say 'I caught 2 cats at Oak St'.
- "site_observation": Log a site observation with lower confidence (40%). Creates a pending review item.
- "data_discrepancy": Log a data mismatch between raw and processed records (internal, silent).
- "flag_anomaly": Flag a data quality issue for staff review.
- "data_correction": Propose a data correction (internal, for staff approval).
- "draft_request": Create a draft FFR request from conversation.
- "update_request": Update an existing request with new information.
- "save_lookup": Save current research to staff member's personal lookups.
- "add_note": Add a note to a place, person, cat, or request.`,
    input_schema: {
      type: "object" as const,
      properties: {
        action_type: {
          type: "string",
          enum: [
            "field_event",
            "site_observation",
            "data_discrepancy",
            "flag_anomaly",
            "data_correction",
            "draft_request",
            "update_request",
            "save_lookup",
            "add_note",
          ],
          description: "Type of write operation to perform",
        },
        location: {
          type: "string",
          description: "Address or place name (for field_event, site_observation, draft_request)",
        },
        entity_type: {
          type: "string",
          description: "Type of entity affected",
        },
        entity_id: {
          type: "string",
          description: "UUID of the affected entity",
        },
        notes: {
          type: "string",
          description: "Additional details",
        },
        reasoning: {
          type: "string",
          description: "Why this action is being taken",
        },
        fields: {
          type: "object",
          description: "Fields to update (for update_request)",
        },
        event_type: {
          type: "string",
          enum: ["observation", "trapping", "feeding", "sighting", "other"],
          description: "Type of field event",
        },
        cat_count: {
          type: "number",
          description: "Number of cats involved",
        },
        eartipped_count: {
          type: "number",
          description: "Number of eartipped cats",
        },
        title: {
          type: "string",
          description: "Title (for save_lookup, data_discrepancy, reminder)",
        },
        summary: {
          type: "string",
          description: "Summary (for save_lookup, draft_request)",
        },
        description: {
          type: "string",
          description: "Description (for data_discrepancy, flag_anomaly)",
        },
        anomaly_type: {
          type: "string",
          description: "Category of anomaly (for flag_anomaly)",
        },
        severity: {
          type: "string",
          description: "Severity level (for flag_anomaly)",
        },
        evidence: {
          type: "object",
          description: "Supporting data (for flag_anomaly)",
        },
        request_id: {
          type: "string",
          description: "UUID of request (for update_request)",
        },
        address: {
          type: "string",
          description: "Address (for draft_request, site_observation)",
        },
        requester_name: {
          type: "string",
          description: "Requester name (for draft_request)",
        },
        requester_phone: {
          type: "string",
          description: "Requester phone (for draft_request)",
        },
        requester_email: {
          type: "string",
          description: "Requester email (for draft_request)",
        },
        estimated_cat_count: {
          type: "number",
          description: "Estimated cat count (for draft_request)",
        },
        has_kittens: {
          type: "boolean",
          description: "Whether kittens are present (for draft_request)",
        },
        priority: {
          type: "string",
          description: "Priority level (for draft_request)",
        },
        query_text: {
          type: "string",
          description: "Original query (for save_lookup)",
        },
        field_name: {
          type: "string",
          description: "Field to correct (for data_correction)",
        },
        proposed_value: {
          type: "string",
          description: "Corrected value (for data_correction)",
        },
        current_value: {
          type: "string",
          description: "Current value (for data_correction)",
        },
        discovery_context: {
          type: "string",
          description: "What revealed the discrepancy (for data_correction)",
        },
        evidence_sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: { type: "string" },
              value: { type: "string" },
              confidence: { type: "string" },
            },
          },
          description: "Sources supporting correction (for data_correction)",
        },
        confidence: {
          type: "string",
          description: "Confidence in correction (for data_correction)",
        },
        source_description: {
          type: "string",
          description: "Source of info (for update_request)",
        },
      },
      required: ["action_type"],
    },
  },
];

// =============================================================================
// IMPLEMENTATION: 1. run_sql
// =============================================================================

async function runReadOnlySql(
  sql: string,
  reasoning: string
): Promise<ToolResult> {
  const normalizedSql = sql.trim().toLowerCase();

  const dangerousPatterns = [
    /^(insert|update|delete|drop|alter|create|truncate|grant|revoke)/i,
    /;\s*(insert|update|delete|drop|alter|create|truncate)/i,
    /into\s+.*\s+select/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(normalizedSql)) {
      return {
        success: false,
        error:
          "Only SELECT queries are allowed. This query appears to modify data.",
      };
    }
  }

  if (
    !normalizedSql.startsWith("select") &&
    !normalizedSql.startsWith("with")
  ) {
    return {
      success: false,
      error:
        "Query must start with SELECT or WITH. Only read operations are allowed.",
    };
  }

  try {
    const results = await queryRows(sql, []);
    const limitedResults = Array.isArray(results)
      ? results.slice(0, 100)
      : results;
    const wasLimited = Array.isArray(results) && results.length > 100;

    return {
      success: true,
      data: {
        results: limitedResults,
        row_count: Array.isArray(results) ? results.length : 1,
        limited: wasLimited,
        reasoning,
        note: wasLimited
          ? "Results limited to first 100 rows. Add LIMIT to your query for specific counts."
          : undefined,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `SQL error: ${error instanceof Error ? error.message : "Query failed"}`,
    };
  }
}

// =============================================================================
// IMPLEMENTATION: 2. full_place_briefing (composite)
// =============================================================================

async function fullPlaceBriefing(
  address: string | undefined,
  placeId: string | undefined
): Promise<ToolResult> {
  if (!address && !placeId) {
    return { success: false, error: "Either address or place_id is required" };
  }

  // Step 1: Get the full structured report
  const situationReport = await analyzePlaceSituation(
    address || placeId || ""
  );

  if (!situationReport.success || !situationReport.data) {
    return situationReport;
  }

  const reportData = situationReport.data as Record<string, unknown>;

  // For road_summary mode, extract the primary place_id
  const mode = reportData.mode as string | undefined;
  let effectivePlaceId = placeId;

  if (mode === "road_summary") {
    const primaryPlace = reportData.primary_place as
      | Record<string, unknown>
      | undefined;
    if (primaryPlace) {
      const place = primaryPlace.place as
        | Record<string, unknown>
        | undefined;
      effectivePlaceId = place?.place_id as string | undefined;
    }
  } else {
    const place = reportData.place as Record<string, unknown> | undefined;
    effectivePlaceId = place?.place_id as string | undefined;
  }

  if (!effectivePlaceId) {
    return situationReport;
  }

  // Step 2 + 3: Get context and ShelterLuv data in parallel
  const [contextResult, shelterluvCats, requestNotesExtracted] =
    await Promise.all([
      getPlaceRecentContext(effectivePlaceId, undefined, undefined),

      queryRows<{
        cat_id: string;
        name: string;
        microchip: string | null;
        shelterluv_animal_id: string;
        current_status: string;
        last_event_type: string | null;
        last_event_subtype: string | null;
        last_event_at: string | null;
      }>(
        `
      SELECT DISTINCT c.cat_id::text, COALESCE(c.display_name, c.name) AS name,
        c.microchip, c.shelterluv_animal_id,
        cs.current_status,
        cs.last_event_type, cs.last_event_subtype,
        cs.last_event_at::text
      FROM ops.request_cats rc
      JOIN ops.requests r ON r.request_id = rc.request_id
      JOIN sot.cats c ON c.cat_id = rc.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN sot.v_cat_current_status cs ON cs.cat_id = c.cat_id
      WHERE r.place_id = $1
        AND c.shelterluv_animal_id IS NOT NULL
      ORDER BY cs.last_event_at DESC NULLS LAST
    `,
        [effectivePlaceId]
      ).catch(() => []),

      queryRows<{
        request_id: string;
        status: string;
        estimated_cat_count: number | null;
        notes: string | null;
        trapper_name: string | null;
        requester_name: string | null;
      }>(
        `
      SELECT r.request_id::text, r.status,
        r.estimated_cat_count, r.notes,
        (SELECT p.display_name FROM ops.request_trapper_assignments rta
         JOIN sot.people p ON p.person_id = rta.trapper_person_id
         WHERE rta.request_id = r.request_id AND rta.status = 'active'
         LIMIT 1) AS trapper_name,
        req_per.display_name AS requester_name
      FROM ops.requests r
      LEFT JOIN sot.people req_per ON req_per.person_id = r.requester_person_id
      WHERE r.place_id = $1 AND r.merged_into_request_id IS NULL
      ORDER BY r.created_at DESC
      LIMIT 3
    `,
        [effectivePlaceId]
      ).catch(() => []),
    ]);

  // Build enrichment layer
  const enrichment: Record<string, unknown> = {};

  if (contextResult.success && contextResult.data) {
    enrichment.institutional_context = contextResult.data;
  }

  if (shelterluvCats.length > 0) {
    const adopted = shelterluvCats.filter(
      (c) => c.current_status === "adopted"
    );
    const transferred = shelterluvCats.filter(
      (c) => c.current_status === "transferred"
    );
    const fostered = shelterluvCats.filter(
      (c) => c.current_status === "in_foster"
    );
    const deceased = shelterluvCats.filter(
      (c) => c.current_status === "deceased"
    );

    enrichment.shelterluv_outcomes = {
      total_cats_in_shelterluv: shelterluvCats.length,
      adopted: adopted.length,
      transferred: transferred.length,
      in_foster: fostered.length,
      deceased: deceased.length,
      cats: shelterluvCats.slice(0, 10),
      interpretation:
        shelterluvCats.length > 0
          ? `${shelterluvCats.length} cat(s) from this location's requests went through ShelterLuv: ${adopted.length} adopted, ${transferred.length} transferred, ${fostered.length} in foster, ${deceased.length} deceased.`
          : undefined,
    };
  }

  if (requestNotesExtracted.length > 0) {
    const headlines: string[] = [];
    for (const req of requestNotesExtracted) {
      if (req.notes) {
        const parts: string[] = [];
        const catMatch = req.notes.match(/(\d+)\s+(adult|cat|kitten)/gi);
        if (catMatch) parts.push(`Reported: ${catMatch.join(", ")}`);
        if (/easy|willing|cooperative|helpful/i.test(req.notes))
          parts.push("Client cooperative");
        if (/unresponsive|difficult|no.?answer|hostile/i.test(req.notes))
          parts.push("Client unresponsive");
        if (/mass\s*trapping/i.test(req.notes))
          parts.push("Mass trapping planned");
        if (/healthy|no\s+injur/i.test(req.notes))
          parts.push("Cats healthy");
        if (/injur|sick|pregnant|FeLV|FIV/i.test(req.notes))
          parts.push("Health concerns noted");
        if (parts.length > 0) {
          headlines.push(
            `Request (${req.status}): ${parts.join(". ")}. Trapper: ${req.trapper_name || "unassigned"}.`
          );
        }
      }
    }
    if (headlines.length > 0) {
      enrichment.request_intelligence = {
        headlines,
        raw_notes: requestNotesExtracted.map((r) => ({
          status: r.status,
          notes: r.notes?.slice(0, 500),
          trapper: r.trapper_name,
          requester: r.requester_name,
          estimated_cats: r.estimated_cat_count,
        })),
      };
    }
  }

  return {
    ...situationReport,
    data: {
      ...reportData,
      enrichment,
    },
  };
}

// =============================================================================
// INTERNAL: analyzePlaceSituation (called by fullPlaceBriefing)
// =============================================================================

async function analyzePlaceSituation(address: string): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT ops.tippy_place_full_report($1) as result`,
    [address]
  );

  if (!result) {
    return {
      success: false,
      error: "Analysis failed - could not query database",
    };
  }

  const report = parseSqlResult(result.result) as Record<string, unknown>;

  if (!report || report.found === false) {
    return {
      success: true,
      data: {
        found: false,
        message:
          (report?.message as string) ||
          `No place found matching "${address}"`,
        suggestion:
          "Try a partial address (e.g., '1170 Walker' instead of full address)",
      },
    };
  }

  const catStats = (report.cat_statistics || {}) as Record<string, unknown>;
  const alterationRate = (catStats.alteration_rate as number) || 0;
  const totalCats = (catStats.total_cats as number) || 0;
  const unalteredCats = (catStats.unaltered_cats as number) || 0;
  const timeline = (report.appointment_timeline || []) as Array<
    Record<string, unknown>
  >;
  const massTrappingEvents = timeline.filter(
    (t) => t.is_mass_trapping
  );
  const diseases = (report.disease_testing || []) as Array<
    Record<string, unknown>
  >;
  const people = (report.people || []) as Array<Record<string, unknown>>;
  const requestHistory = (report.request_history || {}) as Record<
    string,
    unknown
  >;
  const shelterLuvOutcomes = (report.shelterluv_outcomes || []) as Array<
    Record<string, unknown>
  >;
  const intakeSubmissions = (report.intake_submissions || []) as Array<
    Record<string, unknown>
  >;
  const requestDetails = (report.request_details || []) as Array<
    Record<string, unknown>
  >;
  const journalEntries = (report.journal_entries || []) as Array<
    Record<string, unknown>
  >;
  const trapperAssignments = (report.trapper_assignments || []) as Array<
    Record<string, unknown>
  >;

  const interpretationHints: string[] = [];

  // Enriched status assessment (considers request lifecycle, data confidence, recency)
  const lastAppointmentDaysAgo = timeline.length > 0
    ? Math.round(
        (Date.now() - new Date(timeline[0].date as string).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : undefined;

  const enrichedStatus = assessPlaceStatus({
    alteration_rate: alterationRate,
    total_cats: totalCats,
    null_status_count: (catStats.null_status_count as number) || 0,
    has_active_request: (requestHistory.active as number) > 0,
    last_appointment_days_ago: lastAppointmentDaysAgo,
  });

  interpretationHints.push(
    `STATUS [${enrichedStatus.confidence} confidence]: ${enrichedStatus.label} — ${enrichedStatus.reasoning}${
      unalteredCats > 0 ? ` (${unalteredCats} unaltered cats remaining)` : ""
    }`
  );

  // Mass trapping
  if (massTrappingEvents.length > 0) {
    const events = massTrappingEvents
      .map(
        (e) =>
          `${e.date} (${e.cats_done} cats)`
      )
      .join(", ");
    interpretationHints.push(
      `MASS TRAPPING: ${massTrappingEvents.length} mass trapping event(s): ${events}. Mass trapping (10+ cats in one day) indicates a coordinated effort.`
    );
  }

  // People
  if (people.length > 0) {
    const roles = people
      .map((p) => `${p.name} (${p.roles})`)
      .join(", ");
    interpretationHints.push(
      `PEOPLE: ${roles}. A "caretaker" feeds the colony regularly. A "resident" lives at the address.`
    );
  }

  // Disease
  if (diseases.length > 0) {
    const hasPositives = diseases.some(
      (d) => (d.positive as number) > 0
    );
    if (hasPositives) {
      interpretationHints.push(
        `DISEASE ALERT: Some cats tested positive. Check the disease_testing array for details.`
      );
    } else {
      interpretationHints.push(
        `DISEASE: All disease tests were negative. This is a healthy colony.`
      );
    }
  }

  // ShelterLuv
  if (shelterLuvOutcomes.length > 0) {
    const fosters = shelterLuvOutcomes.filter(
      (o) => o.outcome_type === "Foster"
    );
    const adoptions = shelterLuvOutcomes.filter(
      (o) => o.outcome_type === "Adoption"
    );
    if (fosters.length > 0)
      interpretationHints.push(
        `FOSTER: ${fosters.length} cat(s) from this location were placed in foster care.`
      );
    if (adoptions.length > 0)
      interpretationHints.push(
        `ADOPTION: ${adoptions.length} cat(s) from this location were adopted.`
      );
  }

  // Requests
  if ((requestHistory.active as number) > 0) {
    interpretationHints.push(
      `ACTIVE REQUEST: There is ${requestHistory.active} active request for this location. Work is ongoing.`
    );
  }
  if ((requestHistory.completed as number) > 0) {
    interpretationHints.push(
      `HISTORY: ${requestHistory.completed} completed request(s) at this location.`
    );
  }

  // Intake submissions
  if (intakeSubmissions.length > 0) {
    const latest = intakeSubmissions[0];
    const situation = latest.situation
      ? ` They reported: "${(latest.situation as string).slice(0, 200)}"`
      : "";
    interpretationHints.push(
      `INTAKE: ${intakeSubmissions.length} intake submission(s). Most recent from ${latest.requester_name || "unknown"} on ${(latest.submitted_at as string)?.slice(0, 10) || "unknown date"}.${situation}${latest.is_emergency ? " FLAGGED AS EMERGENCY." : ""}`
    );
  }

  // Request details
  if (requestDetails.length > 0) {
    for (const req of requestDetails) {
      const details: string[] = [];
      if (req.best_trapping_time)
        details.push(`Best trapping time: ${req.best_trapping_time}`);
      if (req.has_medical_concerns)
        details.push(
          `Medical concerns: ${req.medical_description || "yes"}`
        );
      if (req.has_kittens)
        details.push(
          `Kittens present${req.kitten_count ? ` (${req.kitten_count})` : ""}`
        );
      if (
        req.important_notes &&
        Array.isArray(req.important_notes) &&
        (req.important_notes as string[]).length > 0
      )
        details.push(
          `Notes: ${(req.important_notes as string[]).join("; ")}`
        );
      if (req.internal_notes)
        details.push(
          `Staff notes: ${(req.internal_notes as string).slice(0, 200)}`
        );
      if (req.notes)
        details.push(
          `Request notes: ${(req.notes as string).slice(0, 200)}`
        );
      if (req.trap_savvy) details.push("Cats are trap-savvy");
      if (req.dogs_on_site) details.push("Dogs on site");
      if (details.length > 0) {
        interpretationHints.push(
          `REQUEST DETAILS (${req.status}): ${details.join(". ")}.`
        );
      }
    }
  }

  // Journal entries
  if (journalEntries.length > 0) {
    const recentEntries = journalEntries.slice(0, 3);
    const entryTexts = recentEntries.map(
      (e) =>
        `${(e.created_at as string)?.slice(0, 10) || "?"} (${e.entry_type || "note"}${e.author ? ` by ${e.author}` : ""}): ${((e.content as string) || "").slice(0, 150)}`
    );
    interpretationHints.push(
      `STAFF ACTIVITY: ${journalEntries.length} journal entries. Recent: ${entryTexts.join(" | ")}`
    );
  }

  // Trapper assignments
  if (trapperAssignments.length > 0) {
    const trappers = trapperAssignments
      .map(
        (t) =>
          `${t.trapper_name || "unknown"} (${t.trapper_type || "trapper"}, ${t.status || "assigned"})`
      )
      .join(", ");
    interpretationHints.push(`TRAPPERS ASSIGNED: ${trappers}`);
  }

  // Domain knowledge interpretation
  const domainInterpretation = interpretPlaceSituation({
    total_cats: totalCats,
    altered_cats: (catStats.altered_cats as number) || 0,
    null_status_count: catStats.null_status_count as number | undefined,
    has_active_request: (requestHistory.active as number) > 0,
    recent_mass_trapping: massTrappingEvents.length > 0,
    disease_positives: diseases.filter(
      (d) => (d.positive as number) > 0
    ).length,
  });
  if (domainInterpretation.caveats.length > 0) {
    interpretationHints.push(
      `DATA CAVEATS: ${domainInterpretation.caveats.join("; ")}`
    );
  }

  // Data quality caveats
  const dataCaveats = getPlaceDataCaveats({
    total_cats: totalCats,
    altered_cats: (catStats.altered_cats as number) || 0,
    null_status_count: catStats.null_status_count as number | undefined,
    reported_cats: (report.colony_estimate as Record<string, unknown>)
      ?.total_cats as number | undefined,
    has_active_request: (requestHistory.active as number) > 0,
  });
  dataCaveats.forEach((caveat) => {
    if (!interpretationHints.some((h) => h.includes(caveat.slice(0, 40)))) {
      interpretationHints.push(`DATA QUALITY: ${caveat}`);
    }
  });

  // Chapman estimate and disease summary
  let chapmanEstimate = null;
  let diseaseSummary = null;
  const placeId = (report.place as Record<string, unknown>)?.place_id as
    | string
    | undefined;

  if (placeId) {
    const [chapman, disease] = await Promise.all([
      queryOne<{
        estimated_population: number;
        ci_lower: number;
        ci_upper: number;
        sample_adequate: boolean;
        confidence_level: string;
      }>(
        `SELECT estimated_population, ci_lower, ci_upper, sample_adequate, confidence_level
         FROM beacon.place_chapman_estimates WHERE place_id = $1
         ORDER BY computed_at DESC LIMIT 1`,
        [placeId]
      ).catch(() => null),
      queryRows<{
        disease_type: string;
        positive_count: number;
        tested_count: number;
        positivity_rate: number;
      }>(
        `SELECT disease_type, positive_count, tested_count, positivity_rate
         FROM ops.v_place_disease_summary WHERE place_id = $1`,
        [placeId]
      ).catch(() => []),
    ]);

    if (chapman) {
      chapmanEstimate = {
        estimate: chapman.estimated_population,
        ci: [chapman.ci_lower, chapman.ci_upper],
        adequate: chapman.sample_adequate,
        confidence: chapman.confidence_level,
      };
      interpretationHints.push(
        `POPULATION ESTIMATE (Chapman): ~${chapman.estimated_population} total cats (${chapman.ci_lower}-${chapman.ci_upper} range, ${chapman.confidence_level} confidence).${!chapman.sample_adequate ? " Note: sample size may be insufficient." : ""}`
      );
    }

    if (disease.length > 0) {
      diseaseSummary = disease;
      disease.forEach((d) => {
        if (d.positive_count > 0) {
          const pct = (d.positivity_rate * 100).toFixed(1);
          interpretationHints.push(
            `DISEASE (${d.disease_type}): ${d.positive_count} of ${d.tested_count} tested positive (${pct}%).`
          );
        }
      });
    }

    // Seasonal context
    const seasonal = await queryOne<{
      breeding_phase: string;
      breeding_intensity: number;
    }>(
      `SELECT breeding_phase, breeding_intensity
       FROM ops.v_breeding_season_indicators
       WHERE month_num = EXTRACT(MONTH FROM CURRENT_DATE) LIMIT 1`
    ).catch(() => null);

    if (seasonal) {
      interpretationHints.push(
        `SEASONAL: Currently in ${seasonal.breeding_phase} phase (intensity: ${seasonal.breeding_intensity}/10).${
          seasonal.breeding_intensity >= 7
            ? " High breeding activity -- prioritize trapping."
            : seasonal.breeding_intensity >= 4
              ? " Moderate breeding activity -- good time for targeted TNR."
              : " Low breeding season -- good time for monitoring."
        }`
      );
    }
  }

  return {
    success: true,
    data: {
      found: true,
      mode: report.mode,
      place: report.place,
      primary_place: report.primary_place,
      people: report.people,
      cat_statistics: report.cat_statistics,
      status_assessment: report.status_assessment,
      enriched_status: {
        level: enrichedStatus.level,
        label: enrichedStatus.label,
        confidence: enrichedStatus.confidence,
        reasoning: enrichedStatus.reasoning,
      },
      appointment_timeline: report.appointment_timeline,
      disease_testing: report.disease_testing,
      request_history: report.request_history,
      request_details: report.request_details,
      intake_submissions: report.intake_submissions,
      journal_entries: report.journal_entries,
      trapper_assignments: report.trapper_assignments,
      colony_estimate: report.colony_estimate,
      shelterluv_outcomes: report.shelterluv_outcomes,
      related_places: report.related_places,
      chapman: chapmanEstimate,
      disease_summary: diseaseSummary,
      interpretation_hints: interpretationHints,
      summary: `${(report.place as Record<string, unknown>)?.display_name}: ${totalCats} cats, ${alterationRate}% altered. Status: ${enrichedStatus.label} (${enrichedStatus.confidence} confidence).`,
    },
  };
}

// =============================================================================
// INTERNAL: getPlaceRecentContext (called by fullPlaceBriefing)
// =============================================================================

async function getPlaceRecentContext(
  placeId: string,
  days: number | undefined,
  includeGoogleMapsNotes: boolean | undefined
): Promise<ToolResult> {
  if (!placeId || typeof placeId !== "string") {
    return {
      success: false,
      error:
        "place_id is required (UUID). Call full_place_briefing or place_search first.",
    };
  }

  const lookbackDays = days && days > 0 ? days : 730;
  const wantGoogleMapsNotes = includeGoogleMapsNotes !== false;

  const place = await queryOne<{
    place_id: string;
    display_name: string | null;
    formatted_address: string | null;
  }>(
    `SELECT place_id, display_name, formatted_address
     FROM sot.places
     WHERE place_id = $1 AND merged_into_place_id IS NULL`,
    [placeId]
  );

  if (!place) {
    return {
      success: true,
      data: {
        found: false,
        place_id: placeId,
        message: `No place found with ID ${placeId}. It may have been merged.`,
      },
    };
  }

  // 1. Google Maps notes
  let googleMapsNotes: Array<{
    entry_id: string;
    kml_name: string | null;
    original_content: string | null;
    ai_summary: string | null;
    ai_meaning: string | null;
    parsed_date: string | null;
    link_type: "direct" | "nearby";
    distance_m: number | null;
    source_file: string | null;
  }> = [];

  if (wantGoogleMapsNotes) {
    googleMapsNotes = await queryRows<{
      entry_id: string;
      kml_name: string | null;
      original_content: string | null;
      ai_summary: string | null;
      ai_meaning: string | null;
      parsed_date: string | null;
      link_type: "direct" | "nearby";
      distance_m: number | null;
      source_file: string | null;
    }>(
      `
      SELECT entry_id, kml_name, original_content, ai_summary, ai_meaning,
        parsed_date::TEXT as parsed_date, 'direct'::text as link_type,
        NULL::double precision as distance_m, source_file
      FROM source.google_map_entries
      WHERE linked_place_id = $1

      UNION ALL

      SELECT entry_id, kml_name, original_content, ai_summary, ai_meaning,
        parsed_date::TEXT as parsed_date, 'nearby'::text as link_type,
        nearest_place_distance_m as distance_m, source_file
      FROM source.google_map_entries
      WHERE nearest_place_id = $1
        AND linked_place_id IS NULL
        AND nearest_place_distance_m IS NOT NULL
        AND nearest_place_distance_m < 50

      ORDER BY link_type, parsed_date DESC NULLS LAST
      LIMIT 20
      `,
      [placeId]
    ).catch(() => []);
  }

  // 2. Recent requests
  const recentRequests = await queryRows<{
    request_id: string;
    status: string;
    summary: string | null;
    notes: string | null;
    internal_notes: string | null;
    important_notes: string[] | null;
    hold_reason: string | null;
    resolution: string | null;
    created_at: string;
    resolved_at: string | null;
  }>(
    `
    SELECT request_id, status::text, summary, notes, internal_notes,
      important_notes, hold_reason, resolution,
      created_at::TEXT as created_at, resolved_at::TEXT as resolved_at
    FROM ops.requests
    WHERE place_id = $1
      AND merged_into_request_id IS NULL
      AND COALESCE(source_created_at, created_at) > NOW() - ($2::int * INTERVAL '1 day')
    ORDER BY COALESCE(source_created_at, created_at) DESC
    LIMIT 10
    `,
    [placeId, lookbackDays]
  ).catch(() => []);

  // 3. Clinic account notes
  const clinicAccountNotes = await queryRows<{
    account_id: string;
    display_name: string | null;
    account_type: string;
    quick_notes: string | null;
    long_notes: string | null;
    tags: string | null;
    notes_updated_at: string | null;
    appointment_count: number;
    last_appointment_date: string | null;
  }>(
    `
    SELECT account_id, display_name, account_type, quick_notes, long_notes, tags,
      notes_updated_at::TEXT as notes_updated_at, appointment_count,
      last_appointment_date::TEXT as last_appointment_date
    FROM ops.clinic_accounts
    WHERE resolved_place_id = $1
      AND (quick_notes IS NOT NULL OR long_notes IS NOT NULL
           OR (tags IS NOT NULL AND tags != ''))
    ORDER BY notes_updated_at DESC NULLS LAST, last_appointment_date DESC NULLS LAST
    LIMIT 10
    `,
    [placeId]
  ).catch(() => []);

  // 4. Journal entries
  const journalEntries = await queryRows<{
    entry_id: string;
    entry_kind: string | null;
    body: string | null;
    created_at: string;
    is_pinned: boolean;
  }>(
    `
    SELECT entry_id, entry_kind, COALESCE(body, content) as body,
      created_at::TEXT as created_at, COALESCE(is_pinned, FALSE) as is_pinned
    FROM ops.journal_entries
    WHERE primary_place_id = $1
      AND COALESCE(is_archived, FALSE) = FALSE
      AND created_at > NOW() - ($2::int * INTERVAL '1 day')
    ORDER BY is_pinned DESC, created_at DESC
    LIMIT 15
    `,
    [placeId, lookbackDays]
  ).catch(() => []);

  // 5. LLM-extracted entities from notes
  const extractedEntities = await queryRows<{
    id: string;
    extracted_people: unknown;
    extracted_relationships: unknown;
    extracted_colony_info: unknown;
    extracted_flags: unknown;
    staff_approved: boolean | null;
    extracted_at: string;
  }>(
    `
    SELECT ene.id, ene.extracted_people, ene.extracted_relationships,
      ene.extracted_colony_info, ene.extracted_flags, ene.staff_approved,
      ene.extracted_at::TEXT as extracted_at
    FROM ops.extracted_note_entities ene
    JOIN ops.clinic_accounts ca ON ca.account_id = ene.clinic_account_id
    WHERE ca.resolved_place_id = $1
    ORDER BY ene.extracted_at DESC
    LIMIT 10
    `,
    [placeId]
  ).catch(() => []);

  // 6. Cat status breakdown
  const catBreakdown = await queryOne<{
    total_cats: number;
    altered_cats: number;
    intact_confirmed: number;
    null_status_count: number;
  }>(
    `
    SELECT
      COUNT(*)::INT as total_cats,
      COUNT(*) FILTER (WHERE c.altered_status IN ('spayed','neutered','altered','Yes'))::INT as altered_cats,
      COUNT(*) FILTER (WHERE c.altered_status IN ('intact','No'))::INT as intact_confirmed,
      COUNT(*) FILTER (WHERE c.altered_status IS NULL
        OR c.altered_status NOT IN ('spayed','neutered','altered','Yes','intact','No'))::INT as null_status_count
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = $1
      AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
    `,
    [placeId]
  );

  const hasContext =
    googleMapsNotes.length > 0 ||
    recentRequests.length > 0 ||
    clinicAccountNotes.length > 0 ||
    journalEntries.length > 0 ||
    extractedEntities.length > 0;

  const summaryParts: string[] = [];
  if (googleMapsNotes.length > 0)
    summaryParts.push(`${googleMapsNotes.length} Google Maps note(s)`);
  if (recentRequests.length > 0)
    summaryParts.push(`${recentRequests.length} recent request(s)`);
  if (clinicAccountNotes.length > 0)
    summaryParts.push(
      `${clinicAccountNotes.length} ClinicHQ account note(s)`
    );
  if (journalEntries.length > 0)
    summaryParts.push(
      `${journalEntries.length} journal entr${journalEntries.length === 1 ? "y" : "ies"}`
    );
  if (extractedEntities.length > 0)
    summaryParts.push(
      `${extractedEntities.length} extracted note entity record(s)`
    );

  const wrapped = wrapPlaceResult(
    {
      found: true,
      place: {
        place_id: place.place_id,
        display_name: place.display_name,
        formatted_address: place.formatted_address,
      },
      lookback_days: lookbackDays,
      has_context: hasContext,
      google_maps_notes: googleMapsNotes,
      recent_requests: recentRequests,
      clinic_account_notes: clinicAccountNotes,
      journal_entries: journalEntries,
      extracted_note_entities: extractedEntities,
      summary: hasContext
        ? `Found context for ${place.display_name || place.formatted_address}: ${summaryParts.join(", ")}.`
        : `No notes, requests, journal entries, or Google Maps context on file for ${place.display_name || place.formatted_address} in the last ${lookbackDays} days.`,
    },
    {
      total_cats: catBreakdown?.total_cats ?? 0,
      altered_cats: catBreakdown?.altered_cats ?? 0,
      intact_confirmed: catBreakdown?.intact_confirmed,
      null_status_count: catBreakdown?.null_status_count,
      has_active_request: recentRequests.some(
        (r) => r.status !== "completed" && r.status !== "cancelled"
      ),
    }
  );

  const seed = buildNarrativeSeed({
    place_name: place.display_name || place.formatted_address,
    google_maps_notes: googleMapsNotes,
    clinic_account_notes: clinicAccountNotes,
    recent_requests: recentRequests,
    meta: wrapped.meta,
  });
  if (seed) wrapped.narrative_seed = seed;

  return wrapped;
}

// =============================================================================
// IMPLEMENTATION: 3. place_search
// =============================================================================

async function placeSearch(address: string): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT ops.comprehensive_place_lookup($1) as result`,
    [address]
  );

  if (!result) {
    return { success: false, error: "Lookup failed" };
  }

  const parsed = parseSqlResult(result.result);

  if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) {
    return {
      success: true,
      data: {
        found: false,
        message: `No place found matching "${address}"`,
      },
    };
  }

  const places = Array.isArray(parsed) ? parsed : [parsed];

  // When we find places, also pull nearby activity context:
  // - Active requests within 500m of any result
  // - Recent appointments (last 90 days) at nearby locations
  // - Assigned trappers in the area
  // This gives staff the neighborhood picture, not just literal matches.
  let nearbyActivity: unknown = undefined;
  if (places.length > 0) {
    const firstPlaceId = (places[0] as Record<string, unknown>).place_id as string;
    if (firstPlaceId) {
      try {
        const [nearbyRequests, nearbyAppointments, nearbyTrappers] = await Promise.all([
          // Active requests within 500m of the first result
          queryRows<{
            request_id: string;
            place_address: string;
            status: string;
            estimated_cat_count: number | null;
            trapper_name: string | null;
            distance_m: number;
          }>(`
            SELECT r.request_id::text, COALESCE(rp.formatted_address, r.short_address) AS place_address,
              r.status, r.estimated_cat_count,
              (SELECT p2.display_name FROM ops.request_trapper_assignments rta
               JOIN sot.people p2 ON p2.person_id = rta.trapper_person_id
               WHERE rta.request_id = r.request_id AND rta.status = 'active' LIMIT 1) AS trapper_name,
              ROUND(ST_Distance(rp.location::geography, anchor.location::geography))::int AS distance_m
            FROM ops.requests r
            JOIN sot.places rp ON rp.place_id = r.place_id AND rp.merged_into_place_id IS NULL
            CROSS JOIN sot.places anchor
            WHERE anchor.place_id = $1
              AND r.merged_into_request_id IS NULL
              AND r.status NOT IN ('completed', 'cancelled')
              AND ST_DWithin(rp.location::geography, anchor.location::geography, 500)
            ORDER BY distance_m
            LIMIT 5
          `, [firstPlaceId]).catch(() => []),

          // Recent appointments within 500m (last 90 days)
          queryRows<{
            place_address: string;
            appointment_count: number;
            last_appointment: string;
            cats_seen: number;
            distance_m: number;
          }>(`
            SELECT p2.formatted_address AS place_address,
              COUNT(*)::int AS appointment_count,
              MAX(a.appointment_date)::text AS last_appointment,
              COUNT(DISTINCT a.cat_id)::int AS cats_seen,
              ROUND(ST_Distance(p2.location::geography, anchor.location::geography))::int AS distance_m
            FROM ops.appointments a
            JOIN sot.places p2 ON p2.place_id = a.place_id AND p2.merged_into_place_id IS NULL
            CROSS JOIN sot.places anchor
            WHERE anchor.place_id = $1
              AND a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
              AND ST_DWithin(p2.location::geography, anchor.location::geography, 500)
              AND p2.place_id != $1
            GROUP BY p2.formatted_address, p2.location, anchor.location
            ORDER BY appointment_count DESC
            LIMIT 5
          `, [firstPlaceId]).catch(() => []),

          // Trappers assigned to nearby places
          queryRows<{
            trapper_name: string;
            trapper_type: string | null;
            service_address: string;
          }>(`
            SELECT DISTINCT p.display_name AS trapper_name, tp.trapper_type,
              sp.formatted_address AS service_address
            FROM sot.trapper_service_places tsp
            JOIN sot.trapper_profiles tp ON tp.person_id = tsp.person_id
            JOIN sot.people p ON p.person_id = tsp.person_id AND p.merged_into_person_id IS NULL
            JOIN sot.places sp ON sp.place_id = tsp.place_id AND sp.merged_into_place_id IS NULL
            CROSS JOIN sot.places anchor
            WHERE anchor.place_id = $1
              AND ST_DWithin(sp.location::geography, anchor.location::geography, 500)
            LIMIT 5
          `, [firstPlaceId]).catch(() => []),
        ]);

        if (nearbyRequests.length > 0 || nearbyAppointments.length > 0 || nearbyTrappers.length > 0) {
          nearbyActivity = {
            search_radius_m: 500,
            active_requests_nearby: nearbyRequests.length > 0 ? nearbyRequests : undefined,
            recent_appointments_nearby: nearbyAppointments.length > 0 ? nearbyAppointments : undefined,
            trappers_in_area: nearbyTrappers.length > 0 ? nearbyTrappers : undefined,
            note: "Nearby activity within 500m of first result. Cats roam between locations — this context helps assess whether a street is being worked.",
          };
        }
      } catch {
        // Non-blocking — nearby activity is enrichment
      }
    }
  }

  return {
    success: true,
    data: {
      found: true,
      places,
      count: places.length,
      summary: `Found ${places.length} place(s) matching "${address}"`,
      nearby_activity: nearbyActivity,
    },
  };
}

// =============================================================================
// IMPLEMENTATION: 4. person_lookup (composite)
// =============================================================================

async function personLookup(
  identifier: string,
  _identifierType?: string
): Promise<ToolResult> {
  const [personResult, catRelationships, vhData] = await Promise.all([
    queryOne<{ result: unknown }>(
      `SELECT ops.comprehensive_person_lookup($1) as result`,
      [identifier]
    ),
    queryRows(
      `SELECT pc.cat_id, c.display_name as cat_name, pc.relationship_type,
        ci.id_value as microchip
      FROM sot.person_cat pc
      JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
      WHERE pc.person_id = (
        SELECT person_id FROM sot.people
        WHERE display_name ILIKE $1 AND merged_into_person_id IS NULL
        LIMIT 1
      )
      LIMIT 20`,
      [`%${identifier}%`]
    ).catch(() => []),
    queryRows(
      `SELECT vh.group_name, vh.email, vh.status, vh.hours_logged
       FROM source.volunteerhub_members vh
       WHERE vh.email ILIKE $1 OR vh.display_name ILIKE $1
       LIMIT 5`,
      [`%${identifier}%`]
    ).catch(() => []),
  ]);

  if (!personResult) {
    return { success: false, error: "Lookup failed" };
  }

  const parsed = parseSqlResult(personResult.result);

  if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) {
    return {
      success: true,
      data: {
        found: false,
        message: `No person found matching "${identifier}"`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      people: Array.isArray(parsed) ? parsed : [parsed],
      count: Array.isArray(parsed) ? parsed.length : 1,
      cat_relationships: catRelationships.length > 0 ? catRelationships : undefined,
      volunteerhub_data: vhData.length > 0 ? vhData : undefined,
      summary: Array.isArray(parsed)
        ? `Found ${parsed.length} person(s) matching "${identifier}"`
        : undefined,
    },
  };
}

// =============================================================================
// IMPLEMENTATION: 5. cat_lookup (composite)
// =============================================================================

async function catLookup(
  identifier: string,
  _identifierType?: string
): Promise<ToolResult> {
  const [catResult, appointmentCrossCheck] = await Promise.all([
    queryOne<{ result: unknown }>(
      `SELECT ops.comprehensive_cat_lookup($1::TEXT) as result`,
      [identifier]
    ),
    queryRows(
      `SELECT a.appointment_date::text, a.service_type, a.is_spay, a.is_neuter,
        p.formatted_address as place_address, a.vet_name
      FROM ops.appointments a
      LEFT JOIN sot.places p ON a.place_id = p.place_id
      WHERE a.cat_id = (
        SELECT c.cat_id FROM sot.cats c
        LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
        WHERE (ci.id_value = $1 OR c.display_name ILIKE $2)
          AND c.merged_into_cat_id IS NULL
        LIMIT 1
      )
      ORDER BY a.appointment_date DESC
      LIMIT 10`,
      [identifier.replace(/\s/g, ""), `%${identifier}%`]
    ).catch(() => []),
  ]);

  if (!catResult) {
    return { success: false, error: "Lookup failed" };
  }

  const parsed = parseSqlResult(catResult.result);

  if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) {
    return {
      success: true,
      data: {
        found: false,
        message: `No cat found matching "${identifier}"`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      cats: Array.isArray(parsed) ? parsed : [parsed],
      count: Array.isArray(parsed) ? parsed.length : 1,
      appointment_history:
        appointmentCrossCheck.length > 0 ? appointmentCrossCheck : undefined,
      summary: Array.isArray(parsed)
        ? `Found ${parsed.length} cat(s) matching "${identifier}"`
        : undefined,
    },
  };
}

// =============================================================================
// IMPLEMENTATION: 6. cat_search
// =============================================================================

async function catSearch(
  color?: string,
  pattern?: string,
  breed?: string,
  sex?: string,
  ageGroup?: string,
  placeName?: string
): Promise<ToolResult> {
  const conditions: string[] = ["c.merged_into_cat_id IS NULL"];
  const params: string[] = [];
  let paramIdx = 1;

  if (color) {
    conditions.push(
      `(c.primary_color ILIKE $${paramIdx} OR c.secondary_color ILIKE $${paramIdx} OR c.color ILIKE $${paramIdx} OR c.description ILIKE $${paramIdx})`
    );
    params.push(`%${color}%`);
    paramIdx++;
  }

  if (pattern) {
    conditions.push(
      `(c.color_pattern ILIKE $${paramIdx} OR c.color ILIKE $${paramIdx} OR c.description ILIKE $${paramIdx})`
    );
    params.push(`%${pattern}%`);
    paramIdx++;
  }

  if (breed) {
    conditions.push(`c.breed ILIKE $${paramIdx}`);
    params.push(`%${breed}%`);
    paramIdx++;
  }

  if (sex) {
    conditions.push(`c.sex = $${paramIdx}`);
    params.push(sex);
    paramIdx++;
  }

  if (ageGroup) {
    conditions.push(`c.age_group = $${paramIdx}`);
    params.push(ageGroup);
    paramIdx++;
  }

  if (placeName) {
    conditions.push(`p.formatted_address ILIKE $${paramIdx}`);
    params.push(`%${placeName}%`);
    paramIdx++;
  }

  if (params.length === 0) {
    return {
      success: false,
      error:
        "At least one search criterion is required (color, pattern, breed, sex, age_group, or place_name)",
    };
  }

  const sql = `
    SELECT DISTINCT ON (c.cat_id)
      c.cat_id, c.display_name as name,
      c.primary_color, c.secondary_color, c.color, c.color_pattern,
      c.sex, c.breed, c.age_group, c.altered_status,
      ci.id_value as microchip,
      p.display_name as place_name, p.formatted_address,
      a.appointment_date as last_appointment
    FROM sot.cats c
    LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    LEFT JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
    LEFT JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
    LEFT JOIN ops.appointments a ON a.cat_id = c.cat_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY c.cat_id, a.appointment_date DESC NULLS LAST
    LIMIT 20
  `;

  const rows = await queryRows(sql, params);

  if (!rows || rows.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        count: 0,
        message: `No cats found matching the description.${placeName ? " Try searching without the location filter." : ""}`,
        note: "Only ~4.5% of cats have color data populated. Try run_sql with broader ILIKE searches if this returns no results.",
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      count: rows.length,
      cats: rows,
      note:
        rows.length === 20
          ? "Showing first 20 matches. Add more filters to narrow results."
          : `Found ${rows.length} matching cat(s).`,
      data_caveat:
        "Color data is only populated for ~4.5% of cats.",
    },
  };
}

// =============================================================================
// IMPLEMENTATION: 7. area_stats (composite)
// =============================================================================

async function areaStats(
  area?: string,
  question?: string
): Promise<ToolResult> {
  // Strategic analysis
  const strategicResult = await queryOne<{ result: unknown }>(
    `SELECT ops.tippy_strategic_analysis($1) as result`,
    [question || area || "overview"]
  );

  const strategicData = strategicResult
    ? (parseSqlResult(strategicResult.result) as Record<string, unknown>)
    : null;

  // City-level stats from matview
  let cityStats: Array<Record<string, unknown>> = [];
  let regionSummary: Record<string, unknown> | null = null;

  if (area) {
    const searchPatterns = getAreaSearchPatterns(area);
    const cityPlaceholders = searchPatterns
      .map((_, i) => `$${i + 1}`)
      .join(", ");

    regionSummary = await queryOne(
      `
      SELECT
        COALESCE(SUM(total_places), 0)::INT as total_places,
        COALESCE(SUM(total_cats), 0)::INT as total_cats,
        COALESCE(SUM(altered_cats), 0)::INT as cats_altered,
        COALESCE(SUM(intact_cats), 0)::INT as cats_intact_confirmed,
        COALESCE(SUM(unknown_status_cats), 0)::INT as cats_null_status,
        COALESCE(SUM(total_requests), 0)::INT as total_requests,
        COALESCE(SUM(completed_requests), 0)::INT as completed_requests,
        COALESCE(SUM(active_requests), 0)::INT as active_requests
      FROM ops.mv_city_stats
      WHERE city = ANY(ARRAY[${cityPlaceholders}])
      `,
      searchPatterns
    );

    cityStats = await queryRows(
      `SELECT city, total_places, total_cats, altered_cats, intact_cats, unknown_status_cats,
        total_requests, completed_requests, active_requests
       FROM ops.mv_city_stats
       WHERE city = ANY(ARRAY[${cityPlaceholders}])
       ORDER BY total_cats DESC`,
      searchPatterns
    );

    // FFR impact data
    const ffrImpact = await queryOne(
      `SELECT
        COALESCE(SUM(unique_cats_seen), 0)::INT as total_cats_helped,
        COALESCE(SUM(cats_altered), 0)::INT as cats_fixed,
        COALESCE(SUM(places_served), 0)::INT as places_served,
        COALESCE(SUM(total_appointments), 0)::INT as total_appointments
       FROM ops.mv_ffr_impact_summary
       WHERE city = ANY(ARRAY[${cityPlaceholders}])`,
      searchPatterns
    );

    if (ffrImpact) {
      (regionSummary as Record<string, unknown>).ffr_impact = ffrImpact;
    }
  }

  // Build interpretations
  const interpretations: string[] = [];

  if (strategicData?.worst_affected) {
    const worst = strategicData.worst_affected as Record<string, unknown>;
    interpretations.push(
      `${worst.city} has the highest known unaltered cat count (${worst.unaltered_cats}), but cities with zero data may actually be worse.`
    );
  }

  if (
    strategicData?.needs_immediate_attention &&
    Array.isArray(strategicData.needs_immediate_attention) &&
    strategicData.needs_immediate_attention.length > 0
  ) {
    const hotSpots = (
      strategicData.needs_immediate_attention as Array<
        Record<string, unknown>
      >
    ).slice(0, 3);
    const hotSpotNames = hotSpots
      .map((h) => h.city)
      .join(", ");
    interpretations.push(
      `Cities needing immediate attention (alteration rate <70%): ${hotSpotNames}.`
    );
  }

  // Suspicious pattern check
  if (strategicData?.worst_affected) {
    const worst = strategicData.worst_affected as Record<string, unknown>;
    const patterns = checkSuspiciousPatterns({
      alteration_rate: (worst.alteration_rate as number) ?? 0,
      total_cats: (worst.total_cats as number) ?? 0,
    });
    patterns.forEach((p) => {
      interpretations.push(`WARNING: ${p.pattern}: ${p.recommendation}`);
    });
  }

  // Rate calculations for region
  let rateAmongKnown: number | undefined;
  let rateOverall: number | undefined;
  if (regionSummary) {
    const rs = regionSummary as Record<string, unknown>;
    const altered = (rs.cats_altered as number) || 0;
    const intact = (rs.cats_intact_confirmed as number) || 0;
    const total = (rs.total_cats as number) || 0;
    const known = altered + intact;
    rateAmongKnown = known > 0 ? Math.round((altered / known) * 100) : 0;
    rateOverall = total > 0 ? Math.round((altered / total) * 100) : 0;
  }

  return {
    success: true,
    data: {
      area: area || "all",
      region_summary: regionSummary
        ? {
            ...regionSummary,
            rate_among_known_pct: rateAmongKnown,
            rate_overall_pct: rateOverall,
          }
        : undefined,
      city_breakdown: cityStats.length > 0 ? cityStats : undefined,
      strategic_analysis: strategicData,
      actionable_insights: interpretations,
      searched_cities: area ? getAreaSearchPatterns(area) : undefined,
      summary: area
        ? `Analysis for ${area}: ${(regionSummary as Record<string, unknown>)?.total_cats || 0} cats tracked, ${(regionSummary as Record<string, unknown>)?.cats_altered || 0} altered.`
        : `Strategic overview across ${(strategicData?.city_rankings as unknown[])?.length || 0} cities.`,
    },
  };
}

// =============================================================================
// IMPLEMENTATION: 8. spatial_context
// =============================================================================

async function spatialContext(
  address: string,
  lat?: number,
  lng?: number
): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT ops.tippy_spatial_analysis($1, $2, $3) as result`,
    [address, lat || null, lng || null]
  );

  if (!result) {
    return { success: false, error: "Spatial analysis failed" };
  }

  const analysis = parseSqlResult(result.result) as Record<string, unknown>;
  const interpretations: string[] = (
    (analysis.interpretation_hints as string[]) || []
  ).slice();

  if (analysis.search_type === "exact_match") {
    const nearby = analysis.nearby_activity as Record<string, unknown> | undefined;
    if (nearby?.interpretation === "hot_zone") {
      interpretations.push(
        `This address is in a HOT ZONE - there are ${nearby.count} other locations with cats within 500m.`
      );
    } else if (nearby && (nearby.count as number) > 0) {
      interpretations.push(
        `There are ${nearby.count} other location(s) with cats nearby.`
      );
    }
  } else if (analysis.search_type === "spatial_search") {
    const summary = (analysis.summary || {}) as Record<string, unknown>;
    if (summary.zone_assessment === "hot_zone") {
      interpretations.unshift(
        `No data at this exact address, BUT this is a HOT ZONE with ${summary.places_within_500m} locations and ${summary.total_cats_nearby} cats within 500m.`
      );
    } else if (summary.zone_assessment === "active_area") {
      interpretations.unshift(
        `No data at this exact address, but there are ${summary.places_within_500m} nearby location(s) within 500m.`
      );
    } else if (analysis.nearest_known_location) {
      const nearest = analysis.nearest_known_location as Record<
        string,
        unknown
      >;
      interpretations.unshift(
        `No data at this address. Nearest known location is ${nearest.display_name} (${nearest.distance_description}) with ${nearest.cat_count} cats.`
      );
    }
  }

  // Region expansion context
  const regionExpansion = expandRegion(address);
  if (regionExpansion.length > 1) {
    interpretations.push(
      `REGION: "${address}" expands to ${regionExpansion.length} cities: ${regionExpansion.join(", ")}.`
    );
  }

  return {
    success: true,
    data: {
      ...analysis,
      interpretation_hints: interpretations,
    },
  };
}

// =============================================================================
// IMPLEMENTATION: 9. compare_places
// =============================================================================

async function comparePlaces(
  address1: string,
  address2: string
): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT ops.tippy_compare_places($1, $2) as result`,
    [address1, address2]
  );

  if (!result) {
    return { success: false, error: "Comparison failed" };
  }

  const comparison = parseSqlResult(result.result) as Record<string, unknown>;
  const place1 = (comparison.place1 || {}) as Record<string, unknown>;
  const place2 = (comparison.place2 || {}) as Record<string, unknown>;

  const narratives: string[] = [];

  if (place1.found === "false" || place1.found === false)
    narratives.push(`Could not find "${address1}" in our records.`);
  if (place2.found === "false" || place2.found === false)
    narratives.push(`Could not find "${address2}" in our records.`);

  const cats1 = parseInt(place1.total_cats as string) || 0;
  const cats2 = parseInt(place2.total_cats as string) || 0;
  if (cats1 > 0 || cats2 > 0) {
    if (cats1 > cats2)
      narratives.push(
        `${place1.address || address1} has more cats (${cats1} vs ${cats2}).`
      );
    else if (cats2 > cats1)
      narratives.push(
        `${place2.address || address2} has more cats (${cats2} vs ${cats1}).`
      );
    else narratives.push(`Both locations have ${cats1} cats.`);
  }

  const rate1 = parseFloat(place1.alteration_rate as string) || 0;
  const rate2 = parseFloat(place2.alteration_rate as string) || 0;
  if (rate1 > 0 || rate2 > 0) {
    if (rate1 < 70 && rate2 >= 70)
      narratives.push(
        `${place1.address || address1} needs more work (${rate1}% vs ${rate2}%).`
      );
    else if (rate2 < 70 && rate1 >= 70)
      narratives.push(
        `${place2.address || address2} needs more work (${rate2}% vs ${rate1}%).`
      );
    else if (rate1 < 70 && rate2 < 70)
      narratives.push(
        `Both locations need attention - rates are ${rate1}% and ${rate2}%.`
      );
    else
      narratives.push(
        `Both locations are well-managed (${rate1}% and ${rate2}%).`
      );
  }

  const unaltered1 =
    parseInt(place1.total_cats as string) -
      parseInt(place1.altered_cats as string) || 0;
  const unaltered2 =
    parseInt(place2.total_cats as string) -
      parseInt(place2.altered_cats as string) || 0;
  if (unaltered1 > 5 || unaltered2 > 5) {
    const moreUrgent =
      unaltered1 > unaltered2
        ? `${place1.address || address1} (${unaltered1} unaltered)`
        : `${place2.address || address2} (${unaltered2} unaltered)`;
    narratives.push(`For immediate impact, prioritize ${moreUrgent}.`);
  }

  return {
    success: true,
    data: {
      ...comparison,
      narrative_comparison: narratives,
      bottom_line:
        (comparison.recommendation as string) ||
        "Both locations appear similar in terms of TNR needs.",
    },
  };
}

// =============================================================================
// IMPLEMENTATION: 10. find_priority_sites
// =============================================================================

async function findPrioritySites(
  area?: string,
  minIntact?: number,
  limit?: number
): Promise<ToolResult> {
  const minIntactN = minIntact && minIntact > 0 ? minIntact : 3;
  const limitN = limit && limit > 0 && limit < 100 ? limit : 15;

  const cityPatterns = area ? getAreaSearchPatterns(area) : null;
  const cityPlaceholders = cityPatterns
    ? cityPatterns.map((_, i) => `$${i + 1}`).join(", ")
    : null;

  const paramsList: (string | number)[] = [];
  if (cityPatterns) paramsList.push(...cityPatterns);
  paramsList.push(minIntactN);
  paramsList.push(limitN);

  const minIntactParam = `$${paramsList.length - 1}`;
  const limitParam = `$${paramsList.length}`;

  const cityFilter = cityPatterns
    ? `AND a.city = ANY(ARRAY[${cityPlaceholders}])`
    : "";

  const results = await queryRows<{
    place_id: string;
    display_name: string | null;
    formatted_address: string | null;
    city: string | null;
    intact_confirmed: number;
    altered_count: number;
    null_status_count: number;
    total_cats: number;
  }>(
    `
    WITH candidate_places AS (
      SELECT
        p.place_id, p.display_name, p.formatted_address, a.city,
        COUNT(*) FILTER (WHERE c.altered_status IN ('intact','No'))::INT as intact_confirmed,
        COUNT(*) FILTER (WHERE c.altered_status IN ('spayed','neutered','altered','Yes'))::INT as altered_count,
        COUNT(*) FILTER (WHERE c.altered_status IS NULL
          OR c.altered_status NOT IN ('spayed','neutered','altered','Yes','intact','No'))::INT as null_status_count,
        COUNT(*)::INT as total_cats
      FROM sot.places p
      JOIN sot.addresses a ON a.address_id = p.sot_address_id
      JOIN sot.cat_place cp ON cp.place_id = p.place_id
        AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
      JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE p.merged_into_place_id IS NULL
        ${cityFilter}
        AND NOT EXISTS (
          SELECT 1 FROM sot.place_soft_blacklist sb
          WHERE sb.place_id = p.place_id
            AND sb.is_active = TRUE
            AND sb.blacklist_type IN ('all','cat_linking')
        )
      GROUP BY p.place_id, p.display_name, p.formatted_address, a.city
      HAVING COUNT(*) FILTER (WHERE c.altered_status IN ('intact','No')) >= ${minIntactParam}
    ),
    no_active_request AS (
      SELECT cp.*
      FROM candidate_places cp
      WHERE NOT EXISTS (
        SELECT 1 FROM ops.requests r
        WHERE r.place_id = cp.place_id
          AND r.merged_into_request_id IS NULL
          AND r.status NOT IN ('completed','cancelled')
      )
        AND cp.total_cats >= 3
    )
    SELECT * FROM no_active_request
    ORDER BY intact_confirmed DESC, total_cats DESC
    LIMIT ${limitParam}
    `,
    paramsList
  );

  if (!results || results.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        area: area || "all",
        min_intact: minIntactN,
        message: area
          ? `No places in ${area} match: at least ${minIntactN} confirmed-intact cats AND no active request AND not blacklisted. This is a real answer.`
          : `No places match: at least ${minIntactN} confirmed-intact cats AND no active request AND not blacklisted. Don't confabulate.`,
      },
      caveats: [
        "Empty result is the answer. Most low-rate places have NULL status (unknown) or are already being worked.",
      ],
    };
  }

  const totalIntact = results.reduce((s, r) => s + r.intact_confirmed, 0);
  const totalAltered = results.reduce((s, r) => s + r.altered_count, 0);
  const totalNull = results.reduce((s, r) => s + r.null_status_count, 0);
  const totalCats = results.reduce((s, r) => s + r.total_cats, 0);

  const enrichedPlaces = results.map((r) => {
    const known = r.altered_count + r.intact_confirmed;
    const rateAmongKnown =
      known > 0 ? Math.round((r.altered_count / known) * 100) : null;
    return { ...r, rate_among_known: rateAmongKnown };
  });

  return wrapPlaceResult(
    {
      found: true,
      area: area || "all",
      min_intact: minIntactN,
      result_count: results.length,
      places: enrichedPlaces,
      summary: `Found ${results.length} place(s)${area ? ` in ${area}` : ""} with at least ${minIntactN} confirmed-intact cats and no active request. Top: ${enrichedPlaces[0].display_name || enrichedPlaces[0].formatted_address} (${enrichedPlaces[0].intact_confirmed} confirmed intact).`,
    },
    {
      total_cats: totalCats,
      altered_cats: totalAltered,
      intact_confirmed: totalIntact,
      null_status_count: totalNull,
      has_active_request: false,
    }
  );
}

// =============================================================================
// IMPLEMENTATION: 11. trapper_stats
// =============================================================================

async function trapperStats(
  queryType: string,
  name?: string,
  trapperType?: string,
  limit?: number
): Promise<ToolResult> {
  const maxResults = limit || 10;

  // Staff queries
  if (
    queryType === "staff" ||
    queryType === "staff_count" ||
    queryType === "staff_list"
  ) {
    return queryStaffInfo(
      queryType === "staff_count"
        ? "count"
        : queryType === "staff_list"
          ? "list"
          : name
            ? "individual"
            : "list",
      name
    );
  }

  switch (queryType) {
    case "count": {
      const result = await queryOne<{ total: number; ffsc: number; community: number }>(
        `SELECT
          COUNT(*) FILTER (WHERE role_status = 'active') as total,
          COUNT(*) FILTER (WHERE role = 'ffsc_trapper' AND role_status = 'active') as ffsc,
          COUNT(*) FILTER (WHERE role = 'community_trapper' AND role_status = 'active') as community
        FROM ops.person_roles
        WHERE role IN ('trapper','ffsc_trapper','community_trapper','head_trapper')`
      );
      return {
        success: true,
        data: {
          total_active: result?.total || 0,
          ffsc_trappers: result?.ffsc || 0,
          community_trappers: result?.community || 0,
          summary: `FFSC has ${result?.total || 0} active trappers: ${result?.ffsc || 0} FFSC volunteers and ${result?.community || 0} community trappers.`,
        },
      };
    }

    case "list": {
      const rows = await queryRows<{
        display_name: string;
        trapper_type: string;
        role_status: string;
      }>(
        `SELECT display_name, trapper_type, role_status
         FROM ops.v_trapper_full_stats
         WHERE role_status = 'active'
         ${trapperType && trapperType !== "all" ? "AND trapper_type = $1" : ""}
         ORDER BY display_name
         LIMIT $${trapperType && trapperType !== "all" ? 2 : 1}`,
        trapperType && trapperType !== "all"
          ? [trapperType, maxResults]
          : [maxResults]
      );
      return {
        success: true,
        data: {
          trappers: rows,
          count: rows.length,
          summary: `${rows.length} active trapper(s) found.`,
        },
      };
    }

    case "individual": {
      if (!name) {
        return {
          success: false,
          error: "Please provide a trapper name to look up",
        };
      }

      const trapper = await queryOne<{
        person_id: string;
        display_name: string;
        trapper_type: string;
        role_status: string;
        active_assignments: number;
        completed_assignments: number;
        total_cats_caught: number;
        total_clinic_cats: number;
        unique_clinic_days: number;
        avg_cats_per_day: number;
        total_altered: number;
        first_activity_date: string;
        last_activity_date: string;
      }>(
        `SELECT person_id, display_name, trapper_type, role_status,
          COALESCE(active_assignments, 0) as active_assignments,
          COALESCE(completed_assignments, 0) as completed_assignments,
          COALESCE(total_cats_caught, 0) as total_cats_caught,
          COALESCE(total_clinic_cats, 0) as total_clinic_cats,
          COALESCE(unique_clinic_days, 0) as unique_clinic_days,
          COALESCE(ROUND(avg_cats_per_day, 1), 0) as avg_cats_per_day,
          COALESCE(total_altered, 0) as total_altered,
          first_activity_date::text, last_activity_date::text
        FROM ops.v_trapper_full_stats
        WHERE display_name ILIKE $1
        LIMIT 1`,
        [`%${name}%`]
      );

      if (!trapper) {
        return {
          success: true,
          data: {
            found: false,
            summary: `No trapper found matching "${name}"`,
          },
        };
      }

      return {
        success: true,
        data: {
          found: true,
          trapper: {
            name: trapper.display_name,
            type: trapper.trapper_type,
            status: trapper.role_status,
          },
          stats: {
            active_assignments: trapper.active_assignments,
            completed_assignments: trapper.completed_assignments,
            total_cats_caught: trapper.total_cats_caught,
            total_clinic_cats: trapper.total_clinic_cats,
            clinic_days: trapper.unique_clinic_days,
            avg_cats_per_day: trapper.avg_cats_per_day,
            total_altered: trapper.total_altered,
            first_activity: trapper.first_activity_date,
            last_activity: trapper.last_activity_date,
          },
          summary: `${trapper.display_name} (${trapper.trapper_type?.replace(/_/g, " ")}): ${trapper.total_clinic_cats} cats to clinic, ${trapper.total_altered} altered, ${trapper.completed_assignments} requests completed. Last active: ${trapper.last_activity_date || "unknown"}.`,
        },
      };
    }

    case "summary": {
      const aggregates = await queryOne<{
        total_active_trappers: number;
        ffsc_trappers: number;
        community_trappers: number;
        inactive_trappers: number;
        all_clinic_cats: number;
        all_clinic_days: number;
        avg_cats_per_day_all: number;
        all_cats_caught: number;
      }>(
        `SELECT total_active_trappers, ffsc_trappers, community_trappers, inactive_trappers,
          all_clinic_cats, all_clinic_days,
          ROUND(avg_cats_per_day_all, 1) as avg_cats_per_day_all, all_cats_caught
        FROM ops.v_trapper_aggregate_stats LIMIT 1`
      );

      if (!aggregates) {
        const fallback = await queryOne<{
          total: number;
          ffsc: number;
          community: number;
        }>(
          `SELECT
            COUNT(*) FILTER (WHERE role_status = 'active') as total,
            COUNT(*) FILTER (WHERE role = 'ffsc_trapper' AND role_status = 'active') as ffsc,
            COUNT(*) FILTER (WHERE role = 'community_trapper' AND role_status = 'active') as community
          FROM ops.person_roles
          WHERE role IN ('trapper','ffsc_trapper','community_trapper','head_trapper')`
        );
        return {
          success: true,
          data: {
            total_active: fallback?.total || 0,
            ffsc_trappers: fallback?.ffsc || 0,
            community_trappers: fallback?.community || 0,
            summary: `FFSC has ${fallback?.total || 0} active trappers.`,
          },
        };
      }

      return {
        success: true,
        data: {
          total_active: aggregates.total_active_trappers,
          ffsc_trappers: aggregates.ffsc_trappers,
          community_trappers: aggregates.community_trappers,
          inactive_trappers: aggregates.inactive_trappers,
          total_clinic_cats: aggregates.all_clinic_cats,
          total_clinic_days: aggregates.all_clinic_days,
          avg_cats_per_day: aggregates.avg_cats_per_day_all,
          total_cats_caught: aggregates.all_cats_caught,
          summary: `FFSC has ${aggregates.total_active_trappers} active trappers: ${aggregates.ffsc_trappers} FFSC volunteers and ${aggregates.community_trappers} community trappers. Together they've brought ${aggregates.all_clinic_cats} cats to clinic over ${aggregates.all_clinic_days} clinic days.`,
        },
      };
    }

    case "by_type": {
      const byType = await queryRows<{
        trapper_type: string;
        role_status: string;
        count: number;
      }>(
        `SELECT role as trapper_type, role_status, COUNT(*) as count
        FROM ops.person_roles
        WHERE role IN ('trapper','ffsc_trapper','community_trapper','head_trapper')
        ${trapperType && trapperType !== "all" ? "AND role = $1" : ""}
        GROUP BY role, role_status
        ORDER BY role, role_status`,
        trapperType && trapperType !== "all" ? [trapperType] : []
      );

      const breakdown: Record<string, { active: number; inactive: number }> =
        {};
      for (const row of byType) {
        if (!breakdown[row.trapper_type])
          breakdown[row.trapper_type] = { active: 0, inactive: 0 };
        if (row.role_status === "active")
          breakdown[row.trapper_type].active = row.count;
        else breakdown[row.trapper_type].inactive += row.count;
      }

      const summaryParts = Object.entries(breakdown).map(
        ([type, counts]) =>
          `${type.replace(/_/g, " ")}: ${counts.active} active, ${counts.inactive} inactive`
      );

      return {
        success: true,
        data: {
          breakdown,
          summary: summaryParts.join("; ") || "No trappers found",
        },
      };
    }

    case "top_performers": {
      const topTrappers = await queryRows<{
        display_name: string;
        trapper_type: string;
        total_clinic_cats: number;
        total_altered: number;
        unique_clinic_days: number;
        completed_assignments: number;
      }>(
        `SELECT display_name, trapper_type,
          COALESCE(total_clinic_cats, 0) as total_clinic_cats,
          COALESCE(total_altered, 0) as total_altered,
          COALESCE(unique_clinic_days, 0) as unique_clinic_days,
          COALESCE(completed_assignments, 0) as completed_assignments
        FROM ops.v_trapper_full_stats
        WHERE role_status = 'active'
        ${trapperType && trapperType !== "all" ? "AND trapper_type = $1" : ""}
        ORDER BY total_clinic_cats DESC NULLS LAST
        LIMIT $${trapperType && trapperType !== "all" ? 2 : 1}`,
        trapperType && trapperType !== "all"
          ? [trapperType, maxResults]
          : [maxResults]
      );

      const topList = topTrappers.map(
        (t, i) =>
          `${i + 1}. ${t.display_name}: ${t.total_clinic_cats} cats, ${t.total_altered} altered, ${t.unique_clinic_days} clinic days`
      );

      return {
        success: true,
        data: {
          trappers: topTrappers.map((t) => ({
            name: t.display_name,
            type: t.trapper_type,
            clinic_cats: t.total_clinic_cats,
            altered: t.total_altered,
            clinic_days: t.unique_clinic_days,
            completed_requests: t.completed_assignments,
          })),
          summary: `Top ${topTrappers.length} trappers by clinic cats:\n${topList.join("\n")}`,
        },
      };
    }

    default:
      return {
        success: false,
        error: `Unknown query type: ${queryType}. Use 'count', 'list', 'individual', 'summary', 'by_type', 'top_performers', 'staff', 'staff_count', or 'staff_list'.`,
      };
  }
}

// INTERNAL: Staff info helper (used by trapperStats for staff query_types)
async function queryStaffInfo(
  queryType: string,
  name?: string
): Promise<ToolResult> {
  switch (queryType) {
    case "count": {
      const result = await queryOne<{ total: number; active: number }>(
        `SELECT COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_active = true) as active
        FROM ops.staff`
      );
      return {
        success: true,
        data: {
          total_staff: result?.total || 0,
          active_staff: result?.active || 0,
          note: "Staff are FFSC employees (coordinators, administrators). This does NOT include trappers.",
        },
      };
    }

    case "list": {
      const rows = await queryRows<{
        display_name: string;
        role: string;
        department: string | null;
        is_active: boolean;
        email: string | null;
      }>(
        `SELECT s.display_name, s.role, s.department, s.is_active,
          (SELECT pi.id_value_norm FROM sot.person_identifiers pi
           WHERE pi.person_id = s.person_id AND pi.id_type = 'email' LIMIT 1) as email
        FROM ops.staff s ORDER BY s.is_active DESC, s.display_name`
      );
      return {
        success: true,
        data: {
          staff: rows,
          total: rows.length,
          active: rows.filter((r) => r.is_active).length,
          note: "Staff are FFSC employees. Trappers are separate volunteers.",
        },
      };
    }

    case "individual": {
      if (!name) {
        return {
          success: false,
          error: "Please provide a staff member's name",
        };
      }
      const row = await queryOne<{
        staff_id: string;
        display_name: string;
        role: string;
        department: string | null;
        is_active: boolean;
        person_id: string | null;
      }>(
        `SELECT s.staff_id, s.display_name, s.role, s.department, s.is_active, s.person_id
        FROM ops.staff s
        WHERE LOWER(s.display_name) LIKE '%' || LOWER($1) || '%'
        LIMIT 1`,
        [name]
      );
      if (!row)
        return {
          success: true,
          data: {
            found: false,
            message: `No staff member found matching "${name}"`,
          },
        };
      return { success: true, data: { found: true, staff: row } };
    }

    default:
      return {
        success: false,
        error: `Unknown staff query type: ${queryType}.`,
      };
  }
}

// =============================================================================
// IMPLEMENTATION: 12. request_stats
// =============================================================================

async function requestStats(
  filterType: string,
  area?: string
): Promise<ToolResult> {
  switch (filterType) {
    case "recent": {
      const result = await queryRows(
        `SELECT r.status, COUNT(*) as count
        FROM ops.requests r
        ${area ? "LEFT JOIN sot.places p ON r.place_id = p.place_id" : ""}
        WHERE r.merged_into_request_id IS NULL
        AND r.created_at > NOW() - INTERVAL '30 days'
        ${area ? "AND p.formatted_address ILIKE $1" : ""}
        GROUP BY r.status ORDER BY count DESC`,
        area ? [`%${area}%`] : []
      );
      return {
        success: true,
        data: {
          period: "Last 30 days",
          area: area || "All areas",
          by_status: result,
        },
      };
    }

    case "by_status": {
      const result = await queryRows(
        `SELECT r.status, COUNT(*) as count
        FROM ops.requests r
        ${area ? "LEFT JOIN sot.places p ON r.place_id = p.place_id WHERE r.merged_into_request_id IS NULL AND p.formatted_address ILIKE $1" : "WHERE r.merged_into_request_id IS NULL"}
        GROUP BY r.status ORDER BY count DESC`,
        area ? [`%${area}%`] : []
      );
      return {
        success: true,
        data: { area: area || "All areas", by_status: result },
      };
    }

    case "by_area": {
      const result = await queryRows(
        `SELECT
          COALESCE(
            CASE
              WHEN p.formatted_address ILIKE '%santa rosa%' THEN 'Santa Rosa'
              WHEN p.formatted_address ILIKE '%petaluma%' THEN 'Petaluma'
              WHEN p.formatted_address ILIKE '%rohnert park%' THEN 'Rohnert Park'
              WHEN p.formatted_address ILIKE '%sebastopol%' THEN 'Sebastopol'
              WHEN p.formatted_address ILIKE '%healdsburg%' THEN 'Healdsburg'
              WHEN p.formatted_address ILIKE '%windsor%' THEN 'Windsor'
              WHEN p.formatted_address ILIKE '%sonoma%' THEN 'Sonoma'
              WHEN p.formatted_address ILIKE '%cotati%' THEN 'Cotati'
              WHEN p.formatted_address ILIKE '%cloverdale%' THEN 'Cloverdale'
              WHEN p.formatted_address ILIKE '%novato%' THEN 'Novato'
              ELSE 'Other'
            END, 'Unknown'
          ) as area, COUNT(*) as count
        FROM ops.requests r
        LEFT JOIN sot.places p ON r.place_id = p.place_id
        WHERE r.merged_into_request_id IS NULL AND r.status NOT IN ('cancelled')
        GROUP BY area ORDER BY count DESC LIMIT 10`
      );
      return { success: true, data: { by_area: result } };
    }

    case "pending": {
      const result = await queryOne(
        `SELECT
          COUNT(*) FILTER (WHERE r.status = 'new') as new_requests,
          COUNT(*) FILTER (WHERE r.status = 'triaged') as triaged,
          COUNT(*) FILTER (WHERE r.status = 'scheduled') as scheduled,
          COUNT(*) FILTER (WHERE r.status = 'in_progress') as in_progress,
          COUNT(*) as total_pending
        FROM ops.requests r
        ${area ? "LEFT JOIN sot.places p ON r.place_id = p.place_id" : ""}
        WHERE r.merged_into_request_id IS NULL
        AND r.status NOT IN ${TERMINAL_PAIR_SQL}
        ${area ? "AND p.formatted_address ILIKE $1" : ""}`,
        area ? [`%${area}%`] : []
      );
      return {
        success: true,
        data: { area: area || "All areas", pending: result },
      };
    }

    default:
      return {
        success: false,
        error: `Unknown filter type: ${filterType}`,
      };
  }
}

// =============================================================================
// IMPLEMENTATION: 13. create_reminder
// =============================================================================

function parseRelativeTime(timeStr: string): Date {
  const now = new Date();
  const lower = timeStr.toLowerCase().trim();

  if (lower === "tomorrow" || lower === "tomorrow morning") {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date;
  }
  if (lower === "tomorrow afternoon") {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(14, 0, 0, 0);
    return date;
  }
  if (lower === "next week") {
    const date = new Date(now);
    date.setDate(date.getDate() + 7);
    date.setHours(9, 0, 0, 0);
    return date;
  }

  const inMatch = lower.match(
    /^in\s+(\d+)\s+(hour|hours|day|days|week|weeks)$/
  );
  if (inMatch) {
    const amount = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const date = new Date(now);
    if (unit.startsWith("hour")) date.setHours(date.getHours() + amount);
    else if (unit.startsWith("day")) date.setDate(date.getDate() + amount);
    else if (unit.startsWith("week"))
      date.setDate(date.getDate() + amount * 7);
    return date;
  }

  const parsed = new Date(timeStr);
  if (!isNaN(parsed.getTime())) return parsed;

  // Default: tomorrow 9 AM
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

interface ContactInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

async function createReminderImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return {
      success: false,
      error: "Staff context required to create reminders.",
    };
  }

  const title = input.title as string;
  const dueTime = input.due_time as string;
  const notes = input.notes as string | undefined;
  const contactInfo: ContactInfo | undefined =
    input.contact_name || input.contact_phone || input.contact_email || input.contact_address
      ? {
          name: input.contact_name as string | undefined,
          phone: input.contact_phone as string | undefined,
          email: input.contact_email as string | undefined,
          address: input.contact_address as string | undefined,
          notes: input.contact_notes as string | undefined,
        }
      : undefined;

  const dueAt = parseRelativeTime(dueTime);
  const hasContactInfo = contactInfo && (contactInfo.name || contactInfo.phone || contactInfo.email || contactInfo.address);
  const contactInfoJson = hasContactInfo ? JSON.stringify(contactInfo) : null;

  // Check for similar existing reminders
  let existingSimilar: { title: string; due_at: string }[] = [];
  try {
    const titleKeyword = title
      .replace(
        /^(follow up|check|call|email|contact|remind)\s+(on|about|with|re)?\s*/i,
        ""
      )
      .split(/\s+/)[0];
    existingSimilar = await queryRows<{ title: string; due_at: string }>(
      `SELECT title, due_at::text FROM ops.staff_reminders
       WHERE staff_id = $1 AND status IN ('pending','due')
       AND title ILIKE '%' || $2 || '%'
       LIMIT 5`,
      [context.staffId, titleKeyword || ""]
    );
  } catch {
    // Don't fail if duplicate check fails
  }

  try {
    const result = await queryOne<{ reminder_id: string; due_at: string }>(
      `INSERT INTO ops.staff_reminders (
        staff_id, title, notes, due_at, remind_at,
        created_via, tippy_conversation_id, contact_info
      ) VALUES ($1, $2, $3, $4, $4, 'tippy', $5, $6)
      RETURNING reminder_id, due_at`,
      [
        context.staffId,
        title,
        notes || null,
        dueAt.toISOString(),
        context.conversationId || null,
        contactInfoJson,
      ]
    );

    if (!result) return { success: false, error: "Failed to create reminder" };

    const formattedDate = dueAt.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    return {
      success: true,
      data: {
        reminder_id: result.reminder_id,
        title,
        due_at: formattedDate,
        existing_similar:
          existingSimilar.length > 0 ? existingSimilar : undefined,
        message: `Reminder created: "${title}" for ${formattedDate}. You'll see it on your dashboard.`,
      },
    };
  } catch (error) {
    console.error("Create reminder error:", error);
    return { success: false, error: "Failed to create reminder" };
  }
}

// =============================================================================
// IMPLEMENTATION: 14. send_message
// =============================================================================

async function sendMessageImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return { success: false, error: "Staff context required to send messages" };
  }

  const recipientName = input.recipient_name as string;
  const subject = input.subject as string;
  const content = input.content as string;
  const priority = (input.priority as string) || "normal";
  const entityType = input.entity_type as string | undefined;
  const entityIdentifier = input.entity_identifier as string | undefined;

  // Resolve entity if provided
  let entityId: string | null = null;
  let entityLabel: string | null = null;

  if (entityType && entityIdentifier) {
    if (entityType === "place") {
      const place = await resolvePlace(entityIdentifier);
      if (place) {
        entityId = place.place_id;
        entityLabel = place.display_name;
      }
    } else if (entityType === "cat") {
      const cat = await resolveCat(entityIdentifier);
      if (cat) {
        entityId = cat.cat_id;
        entityLabel = cat.display_name;
      }
    } else if (entityType === "person") {
      const person = await resolvePerson(entityIdentifier);
      if (person) {
        entityId = person.person_id;
        entityLabel = person.display_name;
      }
    } else if (entityType === "request") {
      const request = await queryOne<{
        request_id: string;
        summary: string;
      }>(
        `SELECT request_id, short_address as summary FROM ops.requests
         WHERE merged_into_request_id IS NULL
           AND (request_id::text = $1 OR short_address ILIKE $2)
         LIMIT 1`,
        [entityIdentifier, `%${entityIdentifier}%`]
      );
      if (request) {
        entityId = request.request_id;
        entityLabel = request.summary;
      }
    }
  }

  const result = await queryOne<{
    result: {
      success: boolean;
      message_id?: string;
      recipient_name?: string;
      error?: string;
    };
  }>(
    `SELECT ops.send_staff_message(
      $1, $2, $3, $4, $5, $6, $7, $8, 'tippy', $9
    ) as result`,
    [
      context.staffId,
      recipientName,
      subject,
      content,
      priority,
      entityType || null,
      entityId || null,
      entityLabel || null,
      context.conversationId || null,
    ]
  );

  if (!result) {
    return { success: false, error: "Failed to send message" };
  }

  const parsed =
    typeof result.result === "string"
      ? JSON.parse(result.result)
      : result.result;

  if (!parsed.success) {
    return { success: false, error: parsed.error || "Failed to send message" };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      recipient_name: parsed.recipient_name,
      message_id: parsed.message_id,
      entity_linked: entityId
        ? { type: entityType, label: entityLabel }
        : null,
    },
  };
}

// =============================================================================
// IMPLEMENTATION: 15. log_event (dispatcher)
// =============================================================================

async function logEvent(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  const actionType = input.action_type as string;

  switch (actionType) {
    case "field_event":
      return logFieldEventImpl(input, context);
    case "site_observation":
      return logSiteObservationImpl(input, context);
    case "data_discrepancy":
      return logDataDiscrepancyImpl(input);
    case "flag_anomaly":
      return flagAnomalyImpl(input, context);
    case "data_correction":
      return proposeDataCorrectionImpl(input, context);
    case "draft_request":
      return createDraftRequestImpl(input, context);
    case "update_request":
      return updateRequestImpl(input, context);
    case "save_lookup":
      return saveLookupImpl(input, context);
    case "add_note":
      return addNoteImpl(input, context);
    default:
      return { success: false, error: `Unknown action_type: ${actionType}` };
  }
}

// --- Sub-implementations for log_event ---

function buildEventNotes(
  eventType: string,
  catCount?: number,
  eartippedCount?: number,
  notes?: string
): string {
  const parts: string[] = [];
  const eventLabels: Record<string, string> = {
    observation: "Field observation",
    trapping: "Trapping event",
    feeding: "Feeding station check",
    sighting: "Cat sighting",
    other: "Other event",
  };
  parts.push(`[${eventLabels[eventType] || eventType}]`);
  if (catCount) parts.push(`${catCount} cats`);
  if (eartippedCount) parts.push(`(${eartippedCount} eartipped)`);
  if (notes) parts.push(`- ${notes}`);
  parts.push(`Logged via Tippy at ${new Date().toISOString()}`);
  return parts.join(" ");
}

async function logFieldEventImpl(
  input: Record<string, unknown>,
  _context?: ToolContext
): Promise<ToolResult> {
  const eventType = (input.event_type as string) || "observation";
  const location = (input.location as string) || (input.address as string);
  const catCount = input.cat_count as number | undefined;
  const eartippedCount = input.eartipped_count as number | undefined;
  const notes = input.notes as string | undefined;

  if (!location) {
    return { success: false, error: "Location is required for field events" };
  }

  const sourceTypeMap: Record<string, string> = {
    observation: "trapper_site_visit",
    trapping: "verified_cats",
    feeding: "trapper_site_visit",
    sighting: "trapper_site_visit",
    other: "trapper_site_visit",
  };
  const sourceType = sourceTypeMap[eventType] || "trapper_site_visit";

  let place = await resolvePlace(location);

  if (!place) {
    const newPlace = await queryOne<{ place_id: string }>(
      `SELECT * FROM sot.find_or_create_place_deduped($1, NULL, NULL, NULL, 'tippy_event')`,
      [location]
    );
    if (!newPlace) {
      return {
        success: false,
        error: `Could not find or create place for: ${location}`,
      };
    }
    place = {
      place_id: newPlace.place_id,
      display_name: null,
      formatted_address: location,
    };
  }

  if (catCount && catCount > 0) {
    await queryOne(
      `INSERT INTO sot.place_colony_estimates (
        place_id, total_cats, source_type, observation_date, source_system, notes
      ) VALUES ($1, $2, $3, NOW(), 'tippy_event', $4) RETURNING estimate_id`,
      [
        place.place_id,
        catCount,
        sourceType,
        buildEventNotes(eventType, catCount, eartippedCount, notes),
      ]
    );
  }

  await queryOne(
    `INSERT INTO ops.journal_entries (
      entry_kind, occurred_at, primary_place_id, body, created_by, tags
    ) VALUES ($1, NOW(), $2, $3, 'tippy_ai', '{}') RETURNING id`,
    [
      eventType,
      place.place_id,
      buildEventNotes(eventType, catCount, eartippedCount, notes),
    ]
  );

  return {
    success: true,
    data: {
      logged: true,
      place_id: place.place_id,
      place_name: place.display_name || place.formatted_address,
      event_type: eventType,
      cat_count: catCount,
      eartipped_count: eartippedCount,
      message: `Logged ${eventType} event at "${place.display_name || place.formatted_address}"${catCount ? ` - ${catCount} cats reported` : ""}`,
    },
  };
}

async function logSiteObservationImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return {
      success: false,
      error: "You need to be logged in to log site observations.",
    };
  }

  const address = (input.address as string) || (input.location as string);
  const catCount = input.cat_count as number;
  const observationNotes = input.notes as string | undefined;

  if (!address || !catCount) {
    return {
      success: false,
      error: "address and cat_count are required for site observations",
    };
  }

  try {
    const title = `AI Observation: ~${catCount} cats at ${address}`;
    const description = JSON.stringify({
      type: "tippy_ai_observation",
      address,
      estimated_cats: catCount,
      observation_notes: observationNotes || null,
      observer_staff_id: context.staffId,
      observer_name: context.staffName,
      reported_via: "tippy_chat",
      confidence_weight: 0.4,
      needs_verification: true,
      logged_at: new Date().toISOString(),
    });

    await queryOne(
      `INSERT INTO ops.data_improvements (
        title, description, category, priority, source, status, suggested_fix
      ) VALUES ($1, $2, 'missing_data', 'low', 'tippy_feedback', 'pending', $3)
      RETURNING improvement_id`,
      [
        title,
        description,
        JSON.stringify({
          action: "verify_and_add_to_colony_estimates",
          source_type: "tippy_ai_observation",
          confidence: 0.4,
        }),
      ]
    );

    return {
      success: true,
      data: {
        logged: true,
        address,
        cat_count: catCount,
        confidence: "40%",
        status: "pending_review",
        message: `Observation logged: ~${catCount} cats at ${address}. Will be reviewed before being added to colony data. Tip: UI submissions have 75% weight vs 40% for AI-reported.`,
      },
    };
  } catch (error) {
    console.error("Log site observation error:", error);
    return { success: false, error: "Failed to log observation" };
  }
}

async function logDataDiscrepancyImpl(
  input: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const title = (input.title as string) || "Data discrepancy";
    const description = JSON.stringify({
      description: input.description || input.notes || "",
      raw_data: input.raw_data || null,
      processed_data: input.processed_data || null,
      logged_at: new Date().toISOString(),
    });

    await queryOne(
      `INSERT INTO ops.data_improvements (
        title, description, entity_type, entity_id, category, priority,
        suggested_fix, source, status
      ) VALUES ($1, $2, $3, $4::uuid, 'missing_data', 'normal', $5, 'automated_check', 'pending')
      ON CONFLICT DO NOTHING`,
      [
        title,
        description,
        (input.entity_type as string) || null,
        (input.entity_id as string) || null,
        input.suggested_fix
          ? JSON.stringify({ suggestion: input.suggested_fix })
          : null,
      ]
    );

    return { success: true, data: { logged: true } };
  } catch (error) {
    console.error("Log discrepancy error:", error);
    return { success: true, data: { logged: false, note: "Could not log" } };
  }
}

async function flagAnomalyImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return { success: false, error: "Staff context required to flag anomalies." };
  }

  try {
    const result = await queryOne<{ anomaly_id: string }>(
      `INSERT INTO ops.tippy_anomaly_log (
        conversation_id, staff_id, entity_type, entity_id,
        anomaly_type, description, evidence, severity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING anomaly_id`,
      [
        context.conversationId || null,
        context.staffId,
        (input.entity_type as string) || null,
        (input.entity_id as string) || null,
        (input.anomaly_type as string) || "other",
        (input.description as string) || "",
        input.evidence ? JSON.stringify(input.evidence) : "{}",
        (input.severity as string) || "medium",
      ]
    );

    const effectiveSeverity = (input.severity as string) || "medium";
    if (result?.anomaly_id && effectiveSeverity !== "low") {
      fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/admin/anomalies/linear`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anomaly_id: result.anomaly_id }),
        }
      ).catch((err) =>
        console.warn("Linear issue creation failed (non-blocking):", err)
      );
    }

    return {
      success: true,
      data: {
        message: `Anomaly flagged for review (ID: ${result?.anomaly_id}).`,
        anomaly_id: result?.anomaly_id,
        severity: effectiveSeverity,
      },
    };
  } catch (error) {
    console.error("flagAnomaly error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to flag anomaly",
    };
  }
}

async function proposeDataCorrectionImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  try {
    const correctionId = await queryOne<{
      tippy_propose_correction: string;
    }>(
      `SELECT ops.tippy_propose_correction(
        $1, $2::uuid, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, $9, $10::uuid
      )`,
      [
        (input.entity_type as string) || "",
        (input.entity_id as string) || "",
        (input.field_name as string) || "",
        input.current_value
          ? JSON.stringify(input.current_value)
          : null,
        JSON.stringify(input.proposed_value || ""),
        (input.discovery_context as string) || "",
        JSON.stringify(input.evidence_sources || []),
        (input.reasoning as string) || null,
        (input.confidence as string) || "low",
        context?.conversationId || null,
      ]
    );

    return {
      success: true,
      data: {
        correction_id: correctionId?.tippy_propose_correction,
        message: "Correction proposed for staff review",
        silent: true,
      },
    };
  } catch (error) {
    console.error("proposeDataCorrection error:", error);
    return {
      success: true,
      data: { message: "Could not log correction", silent: true },
    };
  }
}

async function createDraftRequestImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return {
      success: false,
      error: "Staff context required to create draft requests.",
    };
  }

  const address =
    (input.address as string) || (input.location as string) || "";
  const summary = (input.summary as string) || "";
  const reasoning = (input.reasoning as string) || "";

  if (!address || !summary) {
    return {
      success: false,
      error: "address and summary are required for draft requests",
    };
  }

  try {
    let placeId: string | null = null;
    let placeContext: Record<string, unknown> | null = null;

    const placeResult = await resolvePlace(address);
    if (placeResult) {
      placeId = placeResult.place_id;

      const contextResult = await queryOne<{
        total_requests: number;
        active_requests: number;
        cats_altered: number;
        latest_request_date: string | null;
      }>(
        `SELECT
          (SELECT COUNT(*) FROM ops.requests WHERE place_id = $1 AND merged_into_request_id IS NULL AND status NOT IN ('cancelled','redirected')) AS total_requests,
          (SELECT COUNT(*) FROM ops.requests WHERE place_id = $1 AND merged_into_request_id IS NULL AND status NOT IN ('completed','cancelled','redirected','partial')) AS active_requests,
          (SELECT COALESCE(SUM(vas.cats_altered), 0)::int FROM ops.v_request_alteration_stats vas JOIN ops.requests r ON r.request_id = vas.request_id WHERE r.place_id = $1 AND r.merged_into_request_id IS NULL) AS cats_altered,
          (SELECT MAX(source_created_at)::text FROM ops.requests WHERE place_id = $1 AND merged_into_request_id IS NULL) AS latest_request_date`,
        [placeId]
      );

      if (contextResult) {
        placeContext = {
          resolved_place_name: placeResult.display_name,
          resolved_address: placeResult.formatted_address,
          total_requests: contextResult.total_requests,
          active_requests: contextResult.active_requests,
          cats_already_altered: contextResult.cats_altered,
          latest_request_date: contextResult.latest_request_date,
        };
      }
    }

    const result = await queryOne<{
      draft_id: string;
      expires_at: string;
    }>(
      `INSERT INTO ops.tippy_draft_requests (
        created_by_staff_id, conversation_id, raw_address, place_id,
        requester_name, requester_phone, requester_email,
        estimated_cat_count, summary, notes, has_kittens, priority,
        tippy_reasoning, place_context
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING draft_id, expires_at`,
      [
        context.staffId,
        context.conversationId || null,
        address,
        placeId,
        (input.requester_name as string) || null,
        (input.requester_phone as string) || null,
        (input.requester_email as string) || null,
        (input.estimated_cat_count as number) ?? null,
        summary,
        (input.notes as string) || null,
        (input.has_kittens as boolean) ?? false,
        (input.priority as string) || "normal",
        reasoning,
        placeContext ? JSON.stringify(placeContext) : null,
      ]
    );

    if (!result) return { success: false, error: "Failed to create draft request" };

    let message = `Draft request created. A coordinator will review it.`;
    if (placeContext && (placeContext.active_requests as number) > 0) {
      message += ` Note: ${placeContext.active_requests} active request(s) already at this location.`;
    }

    return {
      success: true,
      data: {
        message,
        draft_id: result.draft_id,
        expires_at: result.expires_at,
        place_resolved: !!placeId,
        existing_history: placeContext
          ? {
              active_requests: placeContext.active_requests,
              cats_already_altered: placeContext.cats_already_altered,
            }
          : null,
      },
    };
  } catch (error) {
    console.error("createDraftRequest error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create draft request",
    };
  }
}

const UPDATE_REQUEST_ALLOWED_FIELDS = new Set([
  "summary",
  "notes",
  "estimated_cat_count",
  "total_cats_reported",
  "cat_name",
  "cat_description",
  "location_description",
  "has_kittens",
  "kitten_count",
  "kitten_age_estimate",
  "has_medical_concerns",
  "medical_description",
  "is_being_fed",
  "feeder_name",
  "feeding_frequency",
  "feeding_time",
  "feeding_location",
  "best_times_seen",
  "best_trapping_time",
  "urgency_notes",
  "access_notes",
  "handleability",
  "dogs_on_site",
  "trap_savvy",
  "previous_tnr",
  "colony_duration",
  "cats_are_friendly",
  "important_notes",
]);

async function updateRequestImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return { success: false, error: "Staff context required to update requests." };
  }

  const requestId = input.request_id as string;
  const fields = (input.fields as Record<string, unknown>) || {};
  const reasoning = (input.reasoning as string) || "";
  const sourceDescription = input.source_description as string | undefined;

  if (!requestId) {
    return { success: false, error: "request_id is required" };
  }

  if (!UUID_REGEX.test(requestId)) {
    return { success: false, error: "Invalid request ID format" };
  }

  const safeFields: Record<string, unknown> = {};
  const rejectedFields: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (UPDATE_REQUEST_ALLOWED_FIELDS.has(key)) {
      safeFields[key] = value;
    } else {
      rejectedFields.push(key);
    }
  }

  if (Object.keys(safeFields).length === 0) {
    return {
      success: false,
      error: `No valid fields to update.${rejectedFields.length ? ` Rejected: ${rejectedFields.join(", ")}` : ""}`,
    };
  }

  try {
    const existing = await queryOne<{ request_id: string }>(
      `SELECT request_id FROM ops.requests WHERE request_id = $1 AND merged_into_request_id IS NULL`,
      [requestId]
    );
    if (!existing) return { success: false, error: "Request not found" };

    const updates: string[] = [];
    const values: unknown[] = [];
    const auditChanges: Array<{
      field: string;
      oldValue: unknown;
      newValue: unknown;
    }> = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(safeFields)) {
      updates.push(`${key} = $${paramIndex}`);
      values.push(value ?? null);
      auditChanges.push({ field: key, oldValue: null, newValue: value });
      paramIndex++;
    }

    updates.push(`updated_at = NOW()`);
    values.push(requestId);

    await execute(
      `UPDATE ops.requests SET ${updates.join(", ")} WHERE request_id = $${paramIndex}`,
      values
    );

    if (auditChanges.length > 0) {
      try {
        await logFieldEdits("request", requestId, auditChanges, {
          editedBy: context.staffId,
          editSource: "api",
        });
      } catch (err) {
        console.error("[update_request] logFieldEdits failed:", err);
      }
    }

    try {
      const journalBody = [
        reasoning,
        sourceDescription ? `Source: ${sourceDescription}` : null,
        `Fields updated: ${Object.keys(safeFields).join(", ")}`,
      ]
        .filter(Boolean)
        .join("\n");

      await execute(
        `INSERT INTO ops.request_journal (request_id, entry_kind, body, tags, created_by)
         VALUES ($1, 'communication', $2, $3, $4)`,
        [
          requestId,
          journalBody,
          JSON.stringify(["tippy_enrichment"]),
          context.staffId,
        ]
      );
    } catch (err) {
      console.error("[update_request] journal entry failed:", err);
    }

    const updatedFields = Object.keys(safeFields);
    let message = `Updated ${updatedFields.length} field(s): ${updatedFields.join(", ")}.`;
    if (rejectedFields.length) {
      message += ` (Skipped restricted fields: ${rejectedFields.join(", ")})`;
    }

    return {
      success: true,
      data: {
        message,
        updated_fields: updatedFields,
        rejected_fields: rejectedFields,
      },
    };
  } catch (error) {
    console.error("updateRequest error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update request",
    };
  }
}

async function saveLookupImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return { success: false, error: "Staff context required to save lookups." };
  }

  const title = (input.title as string) || "Research lookup";
  const summary = (input.summary as string) || "";
  const queryText = input.query_text as string | undefined;

  const resultData: Record<string, unknown> = {};
  let entityType: string | null = null;
  let entityId: string | null = null;

  if (context.recentToolResults && context.recentToolResults.length > 0) {
    const toolResults = context.recentToolResults.filter(
      (r) => r.success && r.data
    );
    resultData.tool_results = toolResults.map((r) => r.data);

    for (const result of toolResults) {
      const data = result.data as Record<string, unknown>;
      if (data.place_id && !entityId) {
        entityType = "place";
        entityId = data.place_id as string;
      } else if (data.cat_id && !entityId) {
        entityType = "cat";
        entityId = data.cat_id as string;
      } else if (data.person_id && !entityId) {
        entityType = "person";
        entityId = data.person_id as string;
      } else if (
        data.places &&
        Array.isArray(data.places) &&
        data.places.length > 0
      ) {
        entityType = "place";
        entityId = data.places[0].place_id;
      }
    }
  }

  try {
    const result = await queryOne<{ lookup_id: string }>(
      `INSERT INTO ops.staff_lookups (
        staff_id, title, query_text, summary, result_data,
        entity_type, entity_id, tool_calls
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING lookup_id`,
      [
        context.staffId,
        title,
        queryText || "Research lookup",
        summary,
        JSON.stringify(resultData),
        entityType,
        entityId,
        context.recentToolResults
          ? JSON.stringify(
              context.recentToolResults.map((r) => ({
                success: r.success,
                has_data: !!r.data,
              }))
            )
          : null,
      ]
    );

    if (!result) return { success: false, error: "Failed to save lookup" };

    return {
      success: true,
      data: {
        lookup_id: result.lookup_id,
        title,
        summary,
        entity_linked: !!entityId,
        message: `Saved to your lookups: "${title}". View it on your dashboard at /me.`,
      },
    };
  } catch (error) {
    console.error("Save lookup error:", error);
    return { success: false, error: "Failed to save lookup" };
  }
}

// =============================================================================
// IMPLEMENTATION: add_note (sub-action of log_event)
// =============================================================================

async function addNoteImpl(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  const notes = (input.notes as string) || (input.description as string) || "";
  if (!notes) {
    return { success: false, error: "notes content is required for add_note" };
  }

  const entityType = input.entity_type as string | undefined;
  const entityId = input.entity_id as string | undefined;
  const location = (input.location as string) || (input.address as string);

  // Resolve the target entity
  let primaryPlaceId: string | null = null;
  let primaryPersonId: string | null = null;
  let primaryCatId: string | null = null;
  let primaryRequestId: string | null = null;
  let entityLabel = "unknown";

  if (entityId && UUID_REGEX.test(entityId)) {
    // Direct UUID reference
    switch (entityType) {
      case "place":
        primaryPlaceId = entityId;
        break;
      case "person":
        primaryPersonId = entityId;
        break;
      case "cat":
        primaryCatId = entityId;
        break;
      case "request":
        primaryRequestId = entityId;
        break;
      default:
        primaryPlaceId = entityId; // Default to place
    }
    entityLabel = entityId;
  } else if (location) {
    // Resolve by address/name
    const place = await resolvePlace(location);
    if (place) {
      primaryPlaceId = place.place_id;
      entityLabel = place.display_name || place.formatted_address || location;
    } else {
      return {
        success: false,
        error: `Could not find a place matching "${location}". Try a more specific address.`,
      };
    }
  } else if (entityType === "person" && input.name) {
    const person = await resolvePerson(input.name as string);
    if (person) {
      primaryPersonId = person.person_id;
      entityLabel = person.display_name || (input.name as string);
    } else {
      return {
        success: false,
        error: `Could not find a person matching "${input.name}".`,
      };
    }
  } else if (entityType === "cat" && input.name) {
    const cat = await resolveCat(input.name as string);
    if (cat) {
      primaryCatId = cat.cat_id;
      entityLabel = cat.display_name || (input.name as string);
    } else {
      return {
        success: false,
        error: `Could not find a cat matching "${input.name}".`,
      };
    }
  } else {
    return {
      success: false,
      error: "Provide entity_id, location, or name with entity_type to attach the note.",
    };
  }

  const tags = ["tippy"];
  if (input.tags && Array.isArray(input.tags)) {
    tags.push(...(input.tags as string[]));
  }

  try {
    const result = await queryOne<{ id: string }>(
      `INSERT INTO ops.journal_entries (
        entry_kind, occurred_at, body, created_by, tags,
        primary_place_id, primary_person_id, primary_cat_id, primary_request_id
      ) VALUES (
        'note', NOW(), $1, 'tippy_ai', $2,
        $3, $4, $5, $6
      ) RETURNING id`,
      [
        notes,
        tags,
        primaryPlaceId,
        primaryPersonId,
        primaryCatId,
        primaryRequestId,
      ]
    );

    if (!result) {
      return { success: false, error: "Failed to save note" };
    }

    return {
      success: true,
      data: {
        note_saved: true,
        journal_entry_id: result.id,
        entity_type: entityType || "place",
        entity_label: entityLabel,
        note_preview: notes.length > 100 ? notes.slice(0, 100) + "..." : notes,
        message: `Note saved for ${entityLabel}: "${notes.length > 80 ? notes.slice(0, 80) + "..." : notes}"`,
      },
    };
  } catch (error) {
    console.error("addNote error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save note",
    };
  }
}

// =============================================================================
// TOOL_DISPATCH + executeToolCallV2
// =============================================================================

type ToolHandler = (
  input: Record<string, unknown>,
  ctx?: ToolContext
) => Promise<ToolResult>;

const TOOL_DISPATCH: Record<string, ToolHandler> = {
  run_sql: (input) =>
    runReadOnlySql(input.sql as string, input.reasoning as string),
  full_place_briefing: (input) =>
    fullPlaceBriefing(
      input.address as string | undefined,
      input.place_id as string | undefined
    ),
  place_search: (input) => placeSearch(input.address as string),
  person_lookup: (input) =>
    personLookup(
      input.identifier as string,
      input.identifier_type as string | undefined
    ),
  cat_lookup: (input) =>
    catLookup(
      input.identifier as string,
      input.identifier_type as string | undefined
    ),
  cat_search: (input) =>
    catSearch(
      input.color as string | undefined,
      input.pattern as string | undefined,
      input.breed as string | undefined,
      input.sex as string | undefined,
      input.age_group as string | undefined,
      input.place_name as string | undefined
    ),
  area_stats: (input) =>
    areaStats(
      input.area as string | undefined,
      input.question as string | undefined
    ),
  spatial_context: (input) =>
    spatialContext(
      input.address as string,
      input.lat as number | undefined,
      input.lng as number | undefined
    ),
  compare_places: (input) =>
    comparePlaces(input.address1 as string, input.address2 as string),
  find_priority_sites: (input) =>
    findPrioritySites(
      input.area as string | undefined,
      input.min_intact as number | undefined,
      input.limit as number | undefined
    ),
  trapper_stats: (input) =>
    trapperStats(
      input.query_type as string,
      input.name as string | undefined,
      input.trapper_type as string | undefined,
      input.limit as number | undefined
    ),
  request_stats: (input) =>
    requestStats(
      input.filter_type as string,
      input.area as string | undefined
    ),
  create_reminder: (input, ctx) => createReminderImpl(input, ctx),
  send_message: (input, ctx) => sendMessageImpl(input, ctx),
  log_event: (input, ctx) => logEvent(input, ctx),
};

export async function executeToolCallV2(
  toolName: string,
  toolInput: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  try {
    const handler = TOOL_DISPATCH[toolName];
    if (!handler)
      return { success: false, error: `Unknown tool: ${toolName}` };
    return await handler(toolInput, context);
  } catch (error) {
    console.error(`Tool execution error (${toolName}):`, error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Database query failed",
    };
  }
}
