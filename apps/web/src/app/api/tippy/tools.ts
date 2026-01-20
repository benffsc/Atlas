import { queryOne, queryRows } from "@/lib/db";

/**
 * Tippy Database Query Tools
 *
 * These tools allow Tippy to query the Atlas database to answer
 * questions about cats, places, people, and requests.
 *
 * All queries are READ-ONLY for security.
 */

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Context passed to tool execution for staff-specific operations
 */
export interface ToolContext {
  staffId: string;
  staffName: string;
  aiAccessLevel: string;
  conversationId?: string;
  recentToolResults?: ToolResult[];  // For save_lookup to reference prior queries
}

/**
 * Tool definitions for Claude's tool use feature
 */
export const TIPPY_TOOLS = [
  {
    name: "query_cats_at_place",
    description:
      "Get count and details of cats at a specific address or place. Use when user asks about cats at a location.",
    input_schema: {
      type: "object" as const,
      properties: {
        address_search: {
          type: "string",
          description: "Address or place name to search for (e.g., 'Selvage Rd', '123 Main St')",
        },
      },
      required: ["address_search"],
    },
  },
  {
    name: "query_place_colony_status",
    description:
      "Get colony size estimate, alteration rate, and FFR progress for a place. Use for questions about colony health or TNR/FFR progress.",
    input_schema: {
      type: "object" as const,
      properties: {
        address_search: {
          type: "string",
          description: "Address or place name to search for",
        },
      },
      required: ["address_search"],
    },
  },
  {
    name: "query_request_stats",
    description:
      "Get statistics about requests - counts by status, recent activity, or area breakdown.",
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
  {
    name: "query_ffr_impact",
    description:
      "Get FFR (Find Fix Return) impact metrics - total cats helped, alteration rates, requests completed. Use for impact questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        area: {
          type: "string",
          description: "Optional area to filter by (leave empty for overall stats)",
        },
        time_period: {
          type: "string",
          enum: ["all_time", "this_year", "last_30_days"],
          description: "Time period for stats",
        },
      },
      required: [],
    },
  },
  {
    name: "query_cats_altered_in_area",
    description:
      "Get count of cats that have been spayed/neutered in a specific city, region, or area. IMPORTANT: Use this for ANY regional questions like 'west county', 'north county', 'russian river', 'wine country', etc. Also use for city-level questions like 'Santa Rosa', 'Petaluma'. Handles regional names by expanding to constituent cities.",
    input_schema: {
      type: "object" as const,
      properties: {
        area: {
          type: "string",
          description: "City or region name. Can be a city (e.g., 'Santa Rosa', 'Petaluma'), a region (e.g., 'west county', 'russian river', 'wine country', 'north county'), or a neighborhood (e.g., 'Coffey Park', 'Rincon Valley')",
        },
      },
      required: ["area"],
    },
  },
  {
    name: "query_region_stats",
    description:
      "Get comprehensive statistics for a region or area including cats, requests, and colonies. Use for broad questions like 'what's happening in west county?', 'tell me about the russian river area', 'cat population in north county'. Handles regional names (west county, russian river, wine country, north county, south county, sonoma valley, the springs, etc.)",
    input_schema: {
      type: "object" as const,
      properties: {
        region: {
          type: "string",
          description: "Region or area name (e.g., 'west county', 'russian river', 'north county', 'wine country', 'Petaluma area')",
        },
      },
      required: ["region"],
    },
  },
  {
    name: "query_person_history",
    description:
      "Get summary of a person's history with FFSC - their requests, cats helped, role.",
    input_schema: {
      type: "object" as const,
      properties: {
        name_search: {
          type: "string",
          description: "Person's name to search for",
        },
      },
      required: ["name_search"],
    },
  },
  {
    name: "query_knowledge_base",
    description:
      "Search the FFSC knowledge base for procedures, training materials, FAQs, talking points, and policies. Use this when staff ask about how to do something, policies, objection handling, or need guidance on FFSC operations.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query - what the user is asking about (e.g., 'how to set traps', 'objection handling', 'training requirements')",
        },
        category: {
          type: "string",
          enum: ["procedures", "training", "faq", "troubleshooting", "talking_points", "equipment", "policy"],
          description: "Optional category filter to narrow results",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "log_field_event",
    description:
      "Log a field event that just happened. Use when staff say things like 'I just caught 2 cats at Oak St' or 'We trapped 3 cats today' or 'Saw 5 cats at the feeding station'. This records the observation for tracking.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_type: {
          type: "string",
          enum: ["observation", "trapping", "feeding", "sighting", "other"],
          description: "Type of event being logged",
        },
        location: {
          type: "string",
          description: "Address or place name where the event occurred",
        },
        cat_count: {
          type: "number",
          description: "Number of cats involved (seen, trapped, etc.)",
        },
        eartipped_count: {
          type: "number",
          description: "Number of cats that had ear tips (already altered)",
        },
        notes: {
          type: "string",
          description: "Additional details about the event",
        },
      },
      required: ["event_type", "location"],
    },
  },
  {
    name: "lookup_cat_appointment",
    description:
      "Look up a specific cat's clinic appointment history by microchip number, cat name, or owner name. Searches both verified Atlas records AND raw ClinicHQ data. Use when staff ask about a specific cat's visit, microchip lookup, or appointment history. Reports discrepancies between raw and processed data.",
    input_schema: {
      type: "object" as const,
      properties: {
        microchip: {
          type: "string",
          description: "Microchip number to search for (e.g., '985112012345678')",
        },
        cat_name: {
          type: "string",
          description: "Cat's name to search for",
        },
        owner_name: {
          type: "string",
          description: "Owner's name to search for",
        },
        owner_phone: {
          type: "string",
          description: "Owner's phone number to search for",
        },
      },
      required: [],
    },
  },
  {
    name: "create_reminder",
    description:
      "Create a personal reminder for the current staff member. Use when they say things like 'Remind me to check on X', 'Don't let me forget...', 'I need to follow up on X next week'. Supports relative times like 'tomorrow', 'next week', 'in 3 days'.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Short title for the reminder (e.g., 'Check on Oak St colony', 'Follow up with Smith')",
        },
        notes: {
          type: "string",
          description: "Optional additional details or context",
        },
        due_time: {
          type: "string",
          description: "When to remind - accepts relative (tomorrow, next week, in 3 days, in 2 hours) or ISO date string",
        },
        entity_type: {
          type: "string",
          enum: ["place", "cat", "person", "request", "intake"],
          description: "Type of entity this reminder relates to (optional)",
        },
        entity_identifier: {
          type: "string",
          description: "Address, name, or ID to link to an entity (optional - Tippy will try to find the entity)",
        },
      },
      required: ["title", "due_time"],
    },
  },
  {
    name: "save_lookup",
    description:
      "Save the current research/lookup to the staff member's personal lookups for later reference. Use when they say 'save this', 'add this to my lookups', 'I want to remember this research'. Only call AFTER you've gathered data to save.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Title for the saved lookup (e.g., 'Oak St colony research', 'Smith family history')",
        },
        summary: {
          type: "string",
          description: "Brief summary of findings to show in the dashboard",
        },
        query_text: {
          type: "string",
          description: "The original question/search that was asked",
        },
      },
      required: ["title", "summary"],
    },
  },
  {
    name: "log_data_discrepancy",
    description:
      "Internal tool to log a data discrepancy found during lookup. Use when raw ClinicHQ data doesn't match processed Atlas records. Do NOT announce to user - just log silently for admin review.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Brief description of the discrepancy",
        },
        description: {
          type: "string",
          description: "Detailed explanation of the mismatch",
        },
        entity_type: {
          type: "string",
          enum: ["cat", "place", "person", "request"],
          description: "Type of entity affected",
        },
        entity_id: {
          type: "string",
          description: "UUID of the affected entity (if known)",
        },
        raw_data: {
          type: "object",
          description: "The raw/staged record data",
        },
        processed_data: {
          type: "object",
          description: "The processed Atlas record data",
        },
        suggested_fix: {
          type: "string",
          description: "Suggested resolution approach",
        },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "log_site_observation",
    description:
      "Log a site observation or cat sighting report from the user. Creates a PENDING review item with lower confidence (40%) than UI submissions (75%). After logging, encourage the user to submit via the Atlas UI for a higher-weight observation. Use when someone says 'I saw X cats at Y location' or reports colony observations.",
    input_schema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description: "Address or location description where observation was made",
        },
        cat_count: {
          type: "number",
          description: "Estimated number of cats observed",
        },
        observation_notes: {
          type: "string",
          description: "Additional details about the observation (cat descriptions, behavior, conditions)",
        },
        observer_name: {
          type: "string",
          description: "Name of person making the observation (from context)",
        },
      },
      required: ["address", "cat_count"],
    },
  },
  {
    name: "query_person_cat_relationships",
    description:
      "Get foster/adopter/owner history for a person - how many cats they've fostered, adopted, or owned. Use when someone asks 'How many cats has X fostered?' or 'What cats has Jane adopted?' Also returns where cats came from (clinic, ShelterLuv, etc.)",
    input_schema: {
      type: "object" as const,
      properties: {
        person_name: {
          type: "string",
          description: "Person's name to search for",
        },
        person_email: {
          type: "string",
          description: "Person's email to search for (more precise than name)",
        },
        relationship_type: {
          type: "string",
          enum: ["adopter", "foster", "owner", "caretaker"],
          description: "Optional filter by relationship type",
        },
      },
      required: [],
    },
  },
  {
    name: "query_places_by_context",
    description:
      "Find places by context type - colony sites, foster homes, adopter residences, clinics, etc. Use when someone asks 'Show me foster homes in Petaluma' or 'Where are the colony sites in west county?'",
    input_schema: {
      type: "object" as const,
      properties: {
        context_type: {
          type: "string",
          enum: ["colony_site", "foster_home", "adopter_residence", "volunteer_location", "trapper_base", "clinic", "shelter", "partner_org"],
          description: "Type of place context to search for",
        },
        area: {
          type: "string",
          description: "Optional area/city/region to filter by (e.g., 'Petaluma', 'west county', 'Santa Rosa')",
        },
      },
      required: ["context_type"],
    },
  },
  {
    name: "query_cat_journey",
    description:
      "Track a cat's journey through FFSC - where trapped, clinic visits, foster placements, adoption. Use when someone asks 'What's the history of cat with microchip X?' or 'Where did this cat come from?'",
    input_schema: {
      type: "object" as const,
      properties: {
        microchip: {
          type: "string",
          description: "Microchip number to search for",
        },
        cat_name: {
          type: "string",
          description: "Cat's name to search for",
        },
      },
      required: [],
    },
  },
  {
    name: "query_trapper_stats",
    description:
      "Get statistics about FFSC trappers - counts by type, active/inactive status, performance metrics, or individual trapper details. Use when users ask about trappers, active volunteers, trapper counts, or trapper performance.",
    input_schema: {
      type: "object" as const,
      properties: {
        query_type: {
          type: "string",
          enum: ["summary", "by_type", "individual", "top_performers"],
          description:
            "summary=org-wide counts, by_type=breakdown by trapper type, individual=specific trapper stats, top_performers=ranked list",
        },
        trapper_name: {
          type: "string",
          description: "For individual lookups - trapper's name to search",
        },
        trapper_type: {
          type: "string",
          enum: ["all", "ffsc_trapper", "community_trapper", "coordinator", "head_trapper"],
          description: "Filter by trapper type (for by_type and top_performers)",
        },
        limit: {
          type: "number",
          description: "Max results for lists (default 10)",
        },
      },
      required: ["query_type"],
    },
  },
  {
    name: "send_staff_message",
    description:
      "Send a message to another staff member. Use when user says things like 'Tell Ben that...', 'Let Sarah know...', 'Message the coordinator about...', 'Notify [person] that...'. The message will appear on their /me dashboard. You can optionally link the message to an entity (place, cat, person, or request).",
    input_schema: {
      type: "object" as const,
      properties: {
        recipient_name: {
          type: "string",
          description: "Name of the staff member to message (first name, last name, or display name)",
        },
        subject: {
          type: "string",
          description: "Brief subject line (10 words max)",
        },
        content: {
          type: "string",
          description: "The message content - include all relevant details",
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
          description: "Address, cat name/microchip, person name/email, or request ID (optional - used to link message)",
        },
      },
      required: ["recipient_name", "subject", "content"],
    },
  },
  {
    name: "comprehensive_person_lookup",
    description:
      "Get COMPLETE information about a person by tracing ALL data sources. Searches across: Atlas core records (people, cats, requests), ClinicHQ appointments (owner/trapper roles), ShelterLuv (adopter, foster history), Volunteer Hub (status, hours), and Airtable (trapper assignments). Use when user asks for 'everything about' a person, wants complete context, or is investigating someone's full history.",
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
          description: "Type of identifier. Use 'auto' to detect automatically (default).",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "comprehensive_cat_lookup",
    description:
      "Get COMPLETE information about a cat by tracing ALL data sources. Returns full journey including: Atlas core (cat details, altered status), ClinicHQ appointments (procedures, tests, vaccinations), ShelterLuv (intake, outcomes, foster/adoption history), and all connected people (owners, trappers, fosters, adopters). Use when user asks for a cat's 'journey', 'full story', 'complete history', or wants to trace a cat through the system.",
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
          description: "Type of identifier. Use 'auto' to detect automatically (default).",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "comprehensive_place_lookup",
    description:
      "Get COMPLETE information about a place/address by tracing ALL activity. Returns: colony status (estimated size, alteration rate), all cats ever at this location, all requests, people connected (requesters, trappers, residents), clinic appointments for cats from here, and historical observations. Use when user asks 'what's happening at [address]', 'show me everything about this location', or wants full location history.",
    input_schema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description: "Full or partial address to search",
        },
      },
      required: ["address"],
    },
  },
  // === DATA QUALITY TOOLS (MIG_487) ===
  {
    name: "check_data_quality",
    description:
      "Check data quality for a person, cat, or place. Returns completeness score, missing fields, potential issues, and data sources. Use when staff ask about data quality, want to verify records, or need to identify incomplete records.",
    input_schema: {
      type: "object" as const,
      properties: {
        entity_type: {
          type: "string",
          enum: ["person", "cat", "place"],
          description: "Type of entity to check",
        },
        identifier: {
          type: "string",
          description: "ID, email, phone, microchip, or address to search for",
        },
      },
      required: ["entity_type", "identifier"],
    },
  },
  {
    name: "find_potential_duplicates",
    description:
      "Find potential duplicate records for deduplication review. Returns similar people, cats, or places with match confidence scores. Use when staff suspect duplicates, want to clean up data, or before creating new records.",
    input_schema: {
      type: "object" as const,
      properties: {
        entity_type: {
          type: "string",
          enum: ["person", "cat", "place"],
          description: "Type of entity to check for duplicates",
        },
        identifier: {
          type: "string",
          description: "Name, email, microchip, or address to check against",
        },
      },
      required: ["entity_type", "identifier"],
    },
  },
  {
    name: "query_merge_history",
    description:
      "Show merge history for an entity - what records were merged together and why. Use when staff ask 'what was merged into this?' or want to understand data lineage after deduplication.",
    input_schema: {
      type: "object" as const,
      properties: {
        entity_type: {
          type: "string",
          enum: ["person", "cat", "place"],
          description: "Type of entity",
        },
        entity_id: {
          type: "string",
          description: "UUID of the entity to check merge history for",
        },
      },
      required: ["entity_type", "entity_id"],
    },
  },
  {
    name: "query_data_lineage",
    description:
      "Trace data lineage - show all sources that contributed to an entity's data. Returns sources, staged records, identifiers, and which source provided which field. Use when staff ask 'where did this data come from?' or need to verify data provenance.",
    input_schema: {
      type: "object" as const,
      properties: {
        entity_type: {
          type: "string",
          enum: ["person", "cat", "place"],
          description: "Type of entity",
        },
        entity_id: {
          type: "string",
          description: "UUID of the entity",
        },
      },
      required: ["entity_type", "entity_id"],
    },
  },
  {
    name: "query_volunteerhub_data",
    description:
      "Get VolunteerHub-specific data for a person including hours logged, roles, certifications, and activity history. Use when staff ask about volunteer hours, training status, or VolunteerHub records.",
    input_schema: {
      type: "object" as const,
      properties: {
        person_identifier: {
          type: "string",
          description: "Email, phone, name, or person_id to search for",
        },
      },
      required: ["person_identifier"],
    },
  },
  {
    name: "query_source_extension",
    description:
      "Query source-specific extension data (ShelterLuv cat details, ClinicHQ appointment notes, etc). Use when staff need details specific to a data source that aren't in the main Atlas records.",
    input_schema: {
      type: "object" as const,
      properties: {
        source: {
          type: "string",
          enum: ["volunteerhub", "shelterluv", "clinichq", "petlink"],
          description: "Source system to query",
        },
        entity_type: {
          type: "string",
          enum: ["person", "cat", "appointment"],
          description: "Type of entity",
        },
        entity_id: {
          type: "string",
          description: "Entity identifier (UUID, microchip, email, etc.)",
        },
      },
      required: ["source", "entity_type", "entity_id"],
    },
  },
];

/**
 * Execute a tool call and return results
 * Context is optional for backward compatibility but required for staff-specific tools
 */
export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "query_cats_at_place":
        return await queryCatsAtPlace(toolInput.address_search as string);

      case "query_place_colony_status":
        return await queryPlaceColonyStatus(toolInput.address_search as string);

      case "query_request_stats":
        return await queryRequestStats(
          toolInput.filter_type as string,
          toolInput.area as string | undefined
        );

      case "query_ffr_impact":
        return await queryFfrImpact(
          toolInput.area as string | undefined,
          toolInput.time_period as string | undefined
        );

      case "query_cats_altered_in_area":
        return await queryCatsAlteredInArea(toolInput.area as string);

      case "query_region_stats":
        return await queryRegionStats(toolInput.region as string);

      case "query_person_history":
        return await queryPersonHistory(toolInput.name_search as string);

      case "query_knowledge_base":
        return await queryKnowledgeBase(
          toolInput.query as string,
          toolInput.category as string | undefined
        );

      case "log_field_event":
        return await logFieldEvent(
          toolInput.event_type as string,
          toolInput.location as string,
          toolInput.cat_count as number | undefined,
          toolInput.eartipped_count as number | undefined,
          toolInput.notes as string | undefined
        );

      case "lookup_cat_appointment":
        return await lookupCatAppointment(
          toolInput.microchip as string | undefined,
          toolInput.cat_name as string | undefined,
          toolInput.owner_name as string | undefined,
          toolInput.owner_phone as string | undefined
        );

      case "create_reminder":
        return await createReminder(
          toolInput.title as string,
          toolInput.due_time as string,
          toolInput.notes as string | undefined,
          toolInput.entity_type as string | undefined,
          toolInput.entity_identifier as string | undefined,
          context
        );

      case "save_lookup":
        return await saveLookup(
          toolInput.title as string,
          toolInput.summary as string,
          toolInput.query_text as string | undefined,
          context
        );

      case "log_data_discrepancy":
        return await logDataDiscrepancy(
          toolInput.title as string,
          toolInput.description as string,
          toolInput.entity_type as string | undefined,
          toolInput.entity_id as string | undefined,
          toolInput.raw_data as Record<string, unknown> | undefined,
          toolInput.processed_data as Record<string, unknown> | undefined,
          toolInput.suggested_fix as string | undefined
        );

      case "log_site_observation":
        return await logSiteObservation(
          toolInput.address as string,
          toolInput.cat_count as number,
          toolInput.observation_notes as string | undefined,
          context
        );

      case "query_person_cat_relationships":
        return await queryPersonCatRelationships(
          toolInput.person_name as string | undefined,
          toolInput.person_email as string | undefined,
          toolInput.relationship_type as string | undefined
        );

      case "query_places_by_context":
        return await queryPlacesByContext(
          toolInput.context_type as string,
          toolInput.area as string | undefined
        );

      case "query_cat_journey":
        return await queryCatJourney(
          toolInput.microchip as string | undefined,
          toolInput.cat_name as string | undefined
        );

      case "query_trapper_stats":
        return await queryTrapperStats(
          toolInput.query_type as string,
          toolInput.trapper_name as string | undefined,
          toolInput.trapper_type as string | undefined,
          toolInput.limit as number | undefined
        );

      case "send_staff_message":
        return await sendStaffMessage(
          toolInput.recipient_name as string,
          toolInput.subject as string,
          toolInput.content as string,
          toolInput.priority as string | undefined,
          toolInput.entity_type as string | undefined,
          toolInput.entity_identifier as string | undefined,
          context
        );

      case "comprehensive_person_lookup":
        return await comprehensivePersonLookup(
          toolInput.identifier as string,
          toolInput.identifier_type as string | undefined
        );

      case "comprehensive_cat_lookup":
        return await comprehensiveCatLookup(
          toolInput.identifier as string,
          toolInput.identifier_type as string | undefined
        );

      case "comprehensive_place_lookup":
        return await comprehensivePlaceLookup(toolInput.address as string);

      // === DATA QUALITY TOOLS (MIG_487) ===
      case "check_data_quality":
        return await checkDataQuality(
          toolInput.entity_type as string,
          toolInput.identifier as string
        );

      case "find_potential_duplicates":
        return await findPotentialDuplicates(
          toolInput.entity_type as string,
          toolInput.identifier as string
        );

      case "query_merge_history":
        return await queryMergeHistory(
          toolInput.entity_type as string,
          toolInput.entity_id as string
        );

      case "query_data_lineage":
        return await queryDataLineage(
          toolInput.entity_type as string,
          toolInput.entity_id as string
        );

      case "query_volunteerhub_data":
        return await queryVolunteerhubData(
          toolInput.person_identifier as string
        );

      case "query_source_extension":
        return await querySourceExtension(
          toolInput.source as string,
          toolInput.entity_type as string,
          toolInput.entity_id as string
        );

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`Tool execution error (${toolName}):`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Database query failed",
    };
  }
}

/**
 * Query cats at a specific place/address
 */
async function queryCatsAtPlace(addressSearch: string): Promise<ToolResult> {
  const results = await queryRows(
    `
    SELECT
      p.place_id,
      p.display_name as place_name,
      p.formatted_address as address,
      COUNT(DISTINCT c.cat_id) as total_cats,
      COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'Yes')) as altered_cats,
      COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status = 'intact' OR c.altered_status = 'No') as unaltered_cats
    FROM trapper.places p
    LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
    LEFT JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
    WHERE (p.display_name ILIKE $1 OR p.formatted_address ILIKE $1)
      AND p.merged_into_place_id IS NULL
    GROUP BY p.place_id, p.display_name, p.formatted_address
    ORDER BY COUNT(DISTINCT c.cat_id) DESC
    LIMIT 5
    `,
    [`%${addressSearch}%`]
  );

  if (!results || results.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        message: `No places found matching "${addressSearch}"`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      places: results,
      summary: results.length === 1
        ? `Found ${results[0].total_cats} cats at ${results[0].place_name || results[0].address}`
        : `Found ${results.length} places matching "${addressSearch}"`,
    },
  };
}

/**
 * Query colony status for a place
 */
async function queryPlaceColonyStatus(addressSearch: string): Promise<ToolResult> {
  const result = await queryOne<{
    place_id: string;
    display_name: string | null;
    formatted_address: string | null;
    colony_estimate: number;
    verified_altered: number;
    verified_cats: number;
    completed_requests: number;
    active_requests: number;
    alteration_rate_pct: number | null;
    estimated_work_remaining: number;
  }>(
    `
    WITH place_match AS (
      SELECT place_id, display_name, formatted_address
      FROM trapper.places
      WHERE (display_name ILIKE $1 OR formatted_address ILIKE $1)
        AND merged_into_place_id IS NULL
      ORDER BY
        CASE WHEN display_name ILIKE $1 THEN 0 ELSE 1 END,
        display_name
      LIMIT 1
    ),
    ecology AS (
      SELECT
        pm.place_id,
        pm.display_name,
        pm.formatted_address,
        COALESCE(
          (SELECT total_cats FROM trapper.place_colony_estimates pce
           WHERE pce.place_id = pm.place_id
           ORDER BY observation_date DESC NULLS LAST LIMIT 1),
          (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pm.place_id)
        ) as colony_estimate,
        (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr
         JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
         WHERE cpr.place_id = pm.place_id
         AND c.altered_status IN ('spayed', 'neutered', 'Yes')) as verified_altered,
        (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pm.place_id) as verified_cats,
        (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.place_id = pm.place_id AND r.status = 'completed') as completed_requests,
        (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.place_id = pm.place_id AND r.status NOT IN ('completed', 'cancelled')) as active_requests
      FROM place_match pm
    )
    SELECT
      place_id,
      display_name,
      formatted_address,
      colony_estimate,
      verified_altered,
      verified_cats,
      completed_requests,
      active_requests,
      CASE WHEN colony_estimate > 0
        THEN ROUND((verified_altered::numeric / colony_estimate) * 100, 1)
        ELSE NULL
      END as alteration_rate_pct,
      GREATEST(0, colony_estimate - verified_altered) as estimated_work_remaining
    FROM ecology
    `,
    [`%${addressSearch}%`]
  );

  if (!result) {
    return {
      success: true,
      data: {
        found: false,
        message: `No place found matching "${addressSearch}"`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      place: result,
      summary: `${result.display_name || result.formatted_address}: ~${result.colony_estimate} cats, ${result.verified_altered} altered (${result.alteration_rate_pct || 0}%), ${result.estimated_work_remaining} remaining`,
    },
  };
}

/**
 * Query request statistics
 */
async function queryRequestStats(
  filterType: string,
  area?: string
): Promise<ToolResult> {
  let result;

  switch (filterType) {
    case "recent":
      result = await queryRows(
        `
        SELECT r.status, COUNT(*) as count
        FROM trapper.sot_requests r
        ${area ? "LEFT JOIN trapper.places p ON r.place_id = p.place_id" : ""}
        WHERE r.created_at > NOW() - INTERVAL '30 days'
        ${area ? "AND p.formatted_address ILIKE $1" : ""}
        GROUP BY r.status
        ORDER BY count DESC
        `,
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

    case "by_status":
      result = await queryRows(
        `
        SELECT r.status, COUNT(*) as count
        FROM trapper.sot_requests r
        ${area ? "LEFT JOIN trapper.places p ON r.place_id = p.place_id WHERE p.formatted_address ILIKE $1" : ""}
        GROUP BY r.status
        ORDER BY count DESC
        `,
        area ? [`%${area}%`] : []
      );
      return {
        success: true,
        data: {
          area: area || "All areas",
          by_status: result,
        },
      };

    case "by_area":
      result = await queryRows(
        `
        SELECT
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
            END,
            'Unknown'
          ) as area,
          COUNT(*) as count
        FROM trapper.sot_requests r
        LEFT JOIN trapper.places p ON r.place_id = p.place_id
        WHERE r.status NOT IN ('cancelled')
        GROUP BY area
        ORDER BY count DESC
        LIMIT 10
        `
      );
      return {
        success: true,
        data: { by_area: result },
      };

    case "pending":
      result = await queryOne(
        `
        SELECT
          COUNT(*) FILTER (WHERE r.status = 'new') as new_requests,
          COUNT(*) FILTER (WHERE r.status = 'triaged') as triaged,
          COUNT(*) FILTER (WHERE r.status = 'scheduled') as scheduled,
          COUNT(*) FILTER (WHERE r.status = 'in_progress') as in_progress,
          COUNT(*) as total_pending
        FROM trapper.sot_requests r
        ${area ? "LEFT JOIN trapper.places p ON r.place_id = p.place_id" : ""}
        WHERE r.status NOT IN ('completed', 'cancelled')
        ${area ? "AND p.formatted_address ILIKE $1" : ""}
        `,
        area ? [`%${area}%`] : []
      );
      return {
        success: true,
        data: {
          area: area || "All areas",
          pending: result,
        },
      };

    default:
      return { success: false, error: `Unknown filter type: ${filterType}` };
  }
}

/**
 * Query FFR impact metrics
 */
async function queryFfrImpact(
  area?: string,
  timePeriod?: string
): Promise<ToolResult> {
  let dateFilter = "";
  if (timePeriod === "this_year") {
    dateFilter = "AND a.appointment_date >= DATE_TRUNC('year', CURRENT_DATE)";
  } else if (timePeriod === "last_30_days") {
    dateFilter = "AND a.appointment_date > NOW() - INTERVAL '30 days'";
  }

  const areaFilter = area ? "AND p.formatted_address ILIKE $1" : "";
  const params = area ? [`%${area}%`] : [];

  const result = await queryOne(
    `
    WITH impact AS (
      SELECT
        COUNT(DISTINCT c.cat_id) as total_cats_helped,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'Yes')) as cats_altered,
        COUNT(DISTINCT r.request_id) as total_requests,
        COUNT(DISTINCT r.request_id) FILTER (WHERE r.status = 'completed') as completed_requests,
        COUNT(DISTINCT p.place_id) as places_served
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
      LEFT JOIN trapper.places p ON p.place_id = a.place_id
      LEFT JOIN trapper.sot_requests r ON r.place_id = p.place_id
      WHERE 1=1 ${dateFilter} ${areaFilter}
    )
    SELECT
      total_cats_helped,
      cats_altered,
      total_requests,
      completed_requests,
      places_served,
      CASE WHEN total_cats_helped > 0
        THEN ROUND((cats_altered::numeric / total_cats_helped) * 100, 1)
        ELSE 0
      END as overall_alteration_rate
    FROM impact
    `,
    params
  );

  return {
    success: true,
    data: {
      area: area || "All areas",
      period: timePeriod || "all_time",
      impact: result,
      summary: `${result?.cats_altered || 0} cats fixed through our FFR program${area ? ` in ${area}` : ""}`,
    },
  };
}

/**
 * Regional name mappings for Sonoma County
 * Maps common regional names to their constituent cities/towns/neighborhoods
 * Based on local terminology used by FFSC staff and Sonoma County residents
 */
const REGIONAL_MAPPINGS: Record<string, string[]> = {
  // ============ WEST COUNTY / RUSSIAN RIVER ============
  // "West County" is the local nickname for Russian River towns - quirky, funky, off-beat communities
  "west county": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Occidental", "Graton", "Sebastopol", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande", "Freestone", "Twin Hills"],
  "west sonoma": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Occidental", "Graton", "Sebastopol", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande", "Freestone"],
  "russian river": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande"],
  "river": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero"],
  "river towns": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Duncans Mills"],
  "lower river": ["Guerneville", "Monte Rio", "Jenner", "Duncans Mills"],

  // ============ SONOMA VALLEY / THE VALLEY ============
  // Southeastern Sonoma County, home to historic town of Sonoma
  "sonoma valley": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "El Verano", "Eldridge", "Vineburg", "Agua Caliente", "Fetters Hot Springs", "Schellville"],
  "the valley": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "El Verano", "Eldridge", "Vineburg", "Agua Caliente", "Fetters Hot Springs"],
  "valley of the moon": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs"],

  // "The Springs" - Hot springs communities between Sonoma and Glen Ellen
  "the springs": ["Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs", "El Verano"],
  "springs": ["Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs", "El Verano"],
  "boyes": ["Boyes Hot Springs"],
  "fetters": ["Fetters Hot Springs"],
  "agua caliente": ["Agua Caliente"],

  // ============ NORTH COUNTY / NORTHERN SONOMA ============
  // Along Highway 101 corridor north of Santa Rosa
  "north county": ["Cloverdale", "Geyserville", "Healdsburg", "Windsor", "Asti"],
  "northern sonoma": ["Cloverdale", "Geyserville", "Healdsburg", "Windsor", "Asti", "Lytton"],
  "upper county": ["Cloverdale", "Geyserville", "Healdsburg"],

  // Wine valleys in North County
  "alexander valley": ["Geyserville", "Cloverdale", "Asti", "Jimtown", "Lytton"],
  "dry creek": ["Healdsburg", "Geyserville"],
  "dry creek valley": ["Healdsburg", "Geyserville"],

  // ============ SOUTH COUNTY / SOUTHERN SONOMA ============
  // Southern part of county near Marin border
  "south county": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove", "Two Rock", "Lakeville", "Bloomfield"],
  "southern sonoma": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove", "Two Rock", "Lakeville"],
  "south sonoma": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove"],

  // Petaluma area specifics
  "east petaluma": ["Petaluma"],
  "west petaluma": ["Petaluma"],
  "penngrove": ["Penngrove"],
  "two rock": ["Two Rock"],

  // ============ COASTAL ============
  // Pacific coast communities
  "coast": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Annapolis", "Valley Ford", "Freestone", "Salmon Creek"],
  "coastal": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Annapolis", "Valley Ford"],
  "sonoma coast": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Valley Ford", "Salmon Creek"],
  "bodega": ["Bodega Bay", "Bodega"],

  // ============ SANTA ROSA NEIGHBORHOODS ============
  // Santa Rosa is the county seat and largest city
  "santa rosa": ["Santa Rosa", "Fountaingrove", "Coffey Park", "Bennett Valley", "Rincon Valley", "Roseland", "Montgomery Village", "Railroad Square", "Oakmont", "Skyhawk", "Spring Lake", "Junior College", "Northwest Santa Rosa", "South Park", "Downtown Santa Rosa"],

  // Specific Santa Rosa neighborhoods
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

  // Mark West / Larkfield-Wikiup area (unincorporated north of Santa Rosa)
  "mark west": ["Larkfield", "Wikiup", "Mark West", "Fulton"],
  "larkfield": ["Larkfield", "Wikiup", "Mark West"],
  "wikiup": ["Larkfield", "Wikiup"],
  "larkfield-wikiup": ["Larkfield", "Wikiup", "Mark West"],
  "fulton": ["Fulton"],

  // ============ ROHNERT PARK / COTATI AREA ============
  "rohnert park": ["Rohnert Park"],
  "cotati": ["Cotati"],
  "rp": ["Rohnert Park"],

  // ============ HEALDSBURG AREA ============
  "healdsburg": ["Healdsburg"],
  "windsor": ["Windsor"],

  // ============ WINE COUNTRY (broad term) ============
  "wine country": ["Santa Rosa", "Healdsburg", "Sonoma", "Glen Ellen", "Kenwood", "Sebastopol", "Windsor", "Geyserville"],

  // ============ CENTRAL COUNTY / HIGHWAY 101 CORRIDOR ============
  "central county": ["Santa Rosa", "Rohnert Park", "Cotati", "Windsor"],
  "101 corridor": ["Santa Rosa", "Rohnert Park", "Cotati", "Petaluma", "Windsor", "Healdsburg", "Cloverdale"],

  // ============ SURROUNDING COUNTIES ============
  // FFSC serves as the regional high-volume spay/neuter clinic for North Bay

  // Marin County (south of Sonoma)
  "marin": ["Novato", "San Rafael", "Petaluma", "Mill Valley", "Sausalito", "Corte Madera", "Larkspur", "San Anselmo", "Fairfax", "Ross", "Tiburon", "Belvedere", "Kentfield", "Greenbrae", "Terra Linda", "Lucas Valley", "Marinwood", "Ignacio", "Hamilton", "Strawberry", "Tamalpais Valley", "Marin City", "Stinson Beach", "Bolinas", "Point Reyes", "Inverness", "Olema", "Tomales"],
  "marin county": ["Novato", "San Rafael", "Mill Valley", "Sausalito", "Corte Madera", "Larkspur", "San Anselmo", "Fairfax", "Tiburon", "Kentfield", "Terra Linda", "Marinwood", "Ignacio"],
  "novato": ["Novato"],
  "san rafael": ["San Rafael", "Terra Linda", "Lucas Valley"],

  // Napa County (east of Sonoma)
  "napa": ["Napa", "American Canyon", "Calistoga", "St. Helena", "Yountville", "Angwin", "Deer Park", "Rutherford", "Oakville", "Pope Valley", "Lake Berryessa"],
  "napa county": ["Napa", "American Canyon", "Calistoga", "St. Helena", "Yountville", "Angwin"],
  "napa valley": ["Napa", "Yountville", "St. Helena", "Calistoga", "Rutherford", "Oakville"],
  "calistoga": ["Calistoga"],
  "st helena": ["St. Helena"],
  "american canyon": ["American Canyon"],

  // Lake County (north of Sonoma/Napa)
  "lake": ["Clearlake", "Lakeport", "Kelseyville", "Lower Lake", "Middletown", "Cobb", "Hidden Valley Lake", "Clearlake Oaks", "Nice", "Lucerne", "Upper Lake"],
  "lake county": ["Clearlake", "Lakeport", "Kelseyville", "Lower Lake", "Middletown", "Cobb", "Hidden Valley Lake"],
  "clearlake": ["Clearlake", "Clearlake Oaks"],
  "lakeport": ["Lakeport"],
  "middletown": ["Middletown", "Hidden Valley Lake"],

  // Mendocino County (north of Sonoma)
  "mendocino": ["Ukiah", "Fort Bragg", "Willits", "Mendocino", "Point Arena", "Hopland", "Boonville", "Philo", "Navarro", "Albion", "Elk", "Gualala", "Laytonville", "Covelo", "Redwood Valley", "Talmage"],
  "mendocino county": ["Ukiah", "Fort Bragg", "Willits", "Mendocino", "Point Arena", "Hopland", "Boonville"],
  "ukiah": ["Ukiah", "Redwood Valley", "Talmage"],
  "fort bragg": ["Fort Bragg"],
  "willits": ["Willits"],
  "anderson valley": ["Boonville", "Philo", "Navarro"],

  // Solano County (southeast)
  "solano": ["Vallejo", "Fairfield", "Vacaville", "Benicia", "Suisun City", "Dixon", "Rio Vista", "Green Valley"],
  "solano county": ["Vallejo", "Fairfield", "Vacaville", "Benicia", "Suisun City"],
  "vallejo": ["Vallejo"],
  "fairfield": ["Fairfield"],
  "benicia": ["Benicia"],

  // East Bay / Contra Costa / Alameda (occasionally serve)
  "east bay": ["Oakland", "Berkeley", "Richmond", "Concord", "Walnut Creek", "Fremont", "Hayward", "San Leandro", "Alameda", "El Cerrito", "Albany", "Emeryville", "Piedmont", "Orinda", "Lafayette", "Moraga", "Pleasant Hill", "Martinez", "Antioch", "Pittsburg", "Brentwood"],
  "contra costa": ["Richmond", "Concord", "Walnut Creek", "Martinez", "Antioch", "Pittsburg", "Brentwood", "Pleasant Hill", "Lafayette", "Orinda", "Moraga", "El Cerrito", "San Pablo", "Pinole", "Hercules"],
  "alameda county": ["Oakland", "Berkeley", "Fremont", "Hayward", "San Leandro", "Alameda", "Albany", "Emeryville", "Piedmont", "Newark", "Union City", "Castro Valley", "Livermore", "Pleasanton", "Dublin"],
  "oakland": ["Oakland"],
  "berkeley": ["Berkeley"],
  "richmond": ["Richmond", "El Cerrito", "San Pablo"],

  // San Francisco
  "san francisco": ["San Francisco"],
  "sf": ["San Francisco"],
  "the city": ["San Francisco"],

  // San Mateo / Peninsula (rare)
  "peninsula": ["San Mateo", "Daly City", "South San Francisco", "Redwood City", "Palo Alto", "Mountain View", "San Bruno", "Burlingame", "San Carlos", "Belmont", "Foster City", "Millbrae", "Pacifica", "Half Moon Bay"],
  "san mateo": ["San Mateo", "Daly City", "South San Francisco", "Redwood City", "San Bruno", "Burlingame"],

  // Regional groupings
  "north bay": ["Santa Rosa", "Petaluma", "Novato", "San Rafael", "Napa", "Vallejo", "Fairfield", "Sonoma", "Healdsburg"],
  "bay area": ["San Francisco", "Oakland", "San Jose", "Berkeley", "Fremont", "Santa Rosa", "Hayward", "Sunnyvale", "Concord", "Vallejo"],
  "greater sonoma": ["Santa Rosa", "Petaluma", "Sonoma", "Healdsburg", "Sebastopol", "Rohnert Park", "Windsor", "Cloverdale", "Novato", "Napa"],
  "out of county": ["Novato", "San Rafael", "Napa", "Vallejo", "Ukiah", "Clearlake", "Oakland", "San Francisco"],
  "out of area": ["Novato", "San Rafael", "Napa", "Vallejo", "Ukiah", "Clearlake", "Oakland", "San Francisco", "Sacramento", "Stockton"],
};

/**
 * Get search patterns for an area (handles regional names)
 */
function getAreaSearchPatterns(area: string): string[] {
  const normalizedArea = area.toLowerCase().trim();

  // Check if this is a regional name
  for (const [regionName, cities] of Object.entries(REGIONAL_MAPPINGS)) {
    if (normalizedArea.includes(regionName) || regionName.includes(normalizedArea)) {
      return cities;
    }
  }

  // Not a regional name, return the original area
  return [area];
}

/**
 * Query cats altered (spayed/neutered) in a specific area/city
 */
async function queryCatsAlteredInArea(area: string): Promise<ToolResult> {
  // Check if this is a regional name that maps to multiple cities
  const searchPatterns = getAreaSearchPatterns(area);
  const isRegionalSearch = searchPatterns.length > 1;

  // Build the WHERE clause for multiple patterns
  const patternPlaceholders = searchPatterns.map((_, i) => `p.formatted_address ILIKE $${i + 1}`).join(" OR ");
  const params = searchPatterns.map(p => `%${p}%`);

  // Query cats altered linked to places in this area
  const result = await queryOne<{
    total_cats_altered: number;
    via_cat_records: number;
    via_appointments: number;
    by_year: Array<{ year: number; count: number }>;
  }>(
    `
    WITH cat_place_altered AS (
      -- Cats marked as altered linked to places in the area
      SELECT DISTINCT c.cat_id
      FROM trapper.sot_cats c
      JOIN trapper.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
      JOIN trapper.places p ON cpr.place_id = p.place_id
      WHERE (${patternPlaceholders})
        AND c.altered_status IN ('spayed', 'neutered', 'Yes')
    ),
    appointment_altered AS (
      -- Cats altered via appointments linked to places in the area
      SELECT DISTINCT a.cat_id
      FROM trapper.sot_appointments a
      JOIN trapper.places p ON a.place_id = p.place_id
      WHERE (${patternPlaceholders})
        AND (a.is_spay = true OR a.is_neuter = true OR a.service_is_spay = true OR a.service_is_neuter = true)
        AND a.cat_id IS NOT NULL
    ),
    combined AS (
      SELECT cat_id FROM cat_place_altered
      UNION
      SELECT cat_id FROM appointment_altered
    ),
    yearly AS (
      SELECT
        EXTRACT(YEAR FROM a.appointment_date)::int as year,
        COUNT(DISTINCT a.cat_id) as count
      FROM trapper.sot_appointments a
      JOIN trapper.places p ON a.place_id = p.place_id
      WHERE (${patternPlaceholders})
        AND (a.is_spay = true OR a.is_neuter = true OR a.service_is_spay = true OR a.service_is_neuter = true)
        AND a.cat_id IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM a.appointment_date)
      ORDER BY year
    )
    SELECT
      (SELECT COUNT(*) FROM combined) as total_cats_altered,
      (SELECT COUNT(*) FROM cat_place_altered) as via_cat_records,
      (SELECT COUNT(*) FROM appointment_altered) as via_appointments,
      (SELECT json_agg(json_build_object('year', year, 'count', count)) FROM yearly) as by_year
    `,
    params
  );

  if (!result || result.total_cats_altered === 0) {
    return {
      success: true,
      data: {
        found: false,
        area: area,
        searched_cities: isRegionalSearch ? searchPatterns : undefined,
        message: isRegionalSearch
          ? `No cats found altered in ${area} (searched: ${searchPatterns.join(", ")}). This may be outside FFSC's primary service area or the data hasn't been linked yet.`
          : `No cats found altered in ${area}. This may be outside FFSC's primary service area or the data hasn't been linked yet.`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      area: area,
      is_regional_search: isRegionalSearch,
      searched_cities: isRegionalSearch ? searchPatterns : undefined,
      total_cats_altered: result.total_cats_altered,
      by_year: result.by_year || [],
      summary: isRegionalSearch
        ? `${result.total_cats_altered} cats have been altered in ${area} (includes: ${searchPatterns.slice(0, 5).join(", ")}${searchPatterns.length > 5 ? ", and more" : ""})`
        : `${result.total_cats_altered} cats have been altered in ${area}`,
    },
  };
}

/**
 * Query comprehensive stats for a region
 * Handles regional names like "west county", "russian river", etc.
 */
async function queryRegionStats(region: string): Promise<ToolResult> {
  // Get all cities/areas this region encompasses
  const searchPatterns = getAreaSearchPatterns(region);
  const isRegionalSearch = searchPatterns.length > 1;

  // Build the WHERE clause for multiple patterns
  const patternPlaceholders = searchPatterns.map((_, i) => `p.formatted_address ILIKE $${i + 1}`).join(" OR ");
  const params = searchPatterns.map(p => `%${p}%`);

  // Get comprehensive stats for the region
  const result = await queryOne<{
    total_places: number;
    total_cats: number;
    cats_altered: number;
    cats_unaltered: number;
    total_requests: number;
    completed_requests: number;
    active_requests: number;
    total_colony_estimates: number;
    avg_colony_size: number;
    largest_colony: number;
    cities_with_activity: string[];
  }>(
    `
    WITH regional_places AS (
      SELECT DISTINCT p.place_id, p.formatted_address
      FROM trapper.places p
      WHERE (${patternPlaceholders})
        AND p.merged_into_place_id IS NULL
    ),
    cat_stats AS (
      SELECT
        COUNT(DISTINCT c.cat_id) as total_cats,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'Yes')) as cats_altered,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('intact', 'No') OR c.altered_status IS NULL) as cats_unaltered
      FROM regional_places rp
      JOIN trapper.cat_place_relationships cpr ON cpr.place_id = rp.place_id
      JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
    ),
    request_stats AS (
      SELECT
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE r.status = 'completed') as completed_requests,
        COUNT(*) FILTER (WHERE r.status NOT IN ('completed', 'cancelled')) as active_requests
      FROM trapper.sot_requests r
      JOIN regional_places rp ON r.place_id = rp.place_id
    ),
    colony_stats AS (
      SELECT
        COUNT(*) as total_estimates,
        COALESCE(AVG(pce.total_cats), 0) as avg_colony_size,
        COALESCE(MAX(pce.total_cats), 0) as largest_colony
      FROM trapper.place_colony_estimates pce
      JOIN regional_places rp ON pce.place_id = rp.place_id
    ),
    city_activity AS (
      SELECT DISTINCT
        CASE
          ${searchPatterns.map(city => `WHEN rp.formatted_address ILIKE '%${city.replace(/'/g, "''")}%' THEN '${city.replace(/'/g, "''")}'`).join("\n          ")}
          ELSE 'Other'
        END as city
      FROM regional_places rp
    )
    SELECT
      (SELECT COUNT(*) FROM regional_places) as total_places,
      cs.total_cats,
      cs.cats_altered,
      cs.cats_unaltered,
      rs.total_requests,
      rs.completed_requests,
      rs.active_requests,
      cos.total_estimates as total_colony_estimates,
      ROUND(cos.avg_colony_size::numeric, 1) as avg_colony_size,
      cos.largest_colony,
      ARRAY(SELECT city FROM city_activity WHERE city != 'Other' LIMIT 10) as cities_with_activity
    FROM cat_stats cs, request_stats rs, colony_stats cos
    `,
    params
  );

  if (!result || (result.total_places === 0 && result.total_cats === 0)) {
    return {
      success: true,
      data: {
        found: false,
        region: region,
        searched_cities: isRegionalSearch ? searchPatterns : undefined,
        message: isRegionalSearch
          ? `No data found for ${region} (searched: ${searchPatterns.slice(0, 5).join(", ")}${searchPatterns.length > 5 ? ", ..." : ""}). This region may be outside FFSC's primary service area.`
          : `No data found for ${region}. This may be outside FFSC's primary service area.`,
      },
    };
  }

  // Calculate alteration rate
  const totalTracked = (result.cats_altered || 0) + (result.cats_unaltered || 0);
  const alterationRate = totalTracked > 0
    ? Math.round((result.cats_altered / totalTracked) * 100)
    : 0;

  return {
    success: true,
    data: {
      found: true,
      region: region,
      is_regional_search: isRegionalSearch,
      searched_cities: searchPatterns,
      stats: {
        places_tracked: result.total_places,
        cats_in_database: result.total_cats,
        cats_altered: result.cats_altered,
        cats_unaltered: result.cats_unaltered,
        alteration_rate_pct: alterationRate,
        total_requests: result.total_requests,
        completed_requests: result.completed_requests,
        active_requests: result.active_requests,
        colony_estimates: result.total_colony_estimates,
        avg_colony_size: result.avg_colony_size,
        largest_colony: result.largest_colony,
        cities_with_activity: result.cities_with_activity,
      },
      summary: `**${region}** (${isRegionalSearch ? searchPatterns.slice(0, 3).join(", ") + (searchPatterns.length > 3 ? ", ..." : "") : region}):
• ${result.total_places} places tracked with ${result.total_cats} cats in database
• ${result.cats_altered} cats altered (${alterationRate}% alteration rate)
• ${result.total_requests} total requests (${result.completed_requests} completed, ${result.active_requests} active)
• ${result.total_colony_estimates} colony estimates, avg size ~${result.avg_colony_size} cats`,
    },
  };
}

/**
 * Query person history
 */
async function queryPersonHistory(nameSearch: string): Promise<ToolResult> {
  const result = await queryOne(
    `
    WITH person_match AS (
      SELECT person_id, display_name, primary_email, entity_type
      FROM trapper.sot_people
      WHERE display_name ILIKE $1
        AND merged_into_person_id IS NULL
      ORDER BY
        CASE WHEN display_name ILIKE $1 THEN 0 ELSE 1 END
      LIMIT 1
    ),
    person_stats AS (
      SELECT
        pm.person_id,
        pm.display_name,
        pm.primary_email,
        pm.entity_type,
        (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = pm.person_id) as requests_made,
        (SELECT COUNT(*) FROM trapper.request_trapper_assignments rta WHERE rta.person_id = pm.person_id) as requests_trapped,
        (SELECT string_agg(DISTINCT pr.role_name, ', ') FROM trapper.person_roles pr WHERE pr.person_id = pm.person_id) as roles
      FROM person_match pm
    )
    SELECT * FROM person_stats
    `,
    [`%${nameSearch}%`]
  );

  if (!result) {
    return {
      success: true,
      data: {
        found: false,
        message: `No person found matching "${nameSearch}"`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      person: result,
      summary: `${result.display_name}: ${result.requests_made} requests made, ${result.requests_trapped} trapped${result.roles ? `, roles: ${result.roles}` : ""}`,
    },
  };
}

/**
 * Query knowledge base for procedures, training, FAQs, etc.
 */
async function queryKnowledgeBase(
  searchQuery: string,
  category?: string
): Promise<ToolResult> {
  // Use the database search function (assumes staff access level for Tippy)
  const results = await queryRows(
    `SELECT * FROM trapper.search_knowledge($1, $2, $3, $4)`,
    [searchQuery, "staff", category || null, 5]
  );

  if (!results || results.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        message: `No knowledge base articles found matching "${searchQuery}"${category ? ` in category "${category}"` : ""}. Try a different search term.`,
      },
    };
  }

  // Get full content for top 3 results
  const enrichedResults = [];
  for (const result of results.slice(0, 3)) {
    const fullArticle = await queryOne<{ content: string; keywords: string[] | null }>(
      `SELECT content, keywords FROM trapper.knowledge_articles WHERE article_id = $1`,
      [(result as { article_id: string }).article_id]
    );
    enrichedResults.push({
      ...(result as Record<string, unknown>),
      content: fullArticle?.content || "",
      keywords: fullArticle?.keywords || [],
    });
  }

  return {
    success: true,
    data: {
      found: true,
      articles: enrichedResults,
      total_results: results.length,
      summary: results.length === 1
        ? `Found 1 article: "${(results[0] as { title: string }).title}"`
        : `Found ${results.length} relevant articles`,
    },
  };
}

/**
 * Log a field event reported by staff
 * This creates an observation record tied to a place
 */
async function logFieldEvent(
  eventType: string,
  location: string,
  catCount?: number,
  eartippedCount?: number,
  notes?: string
): Promise<ToolResult> {
  // Map event types to source types for colony estimates
  const sourceTypeMap: Record<string, string> = {
    observation: "trapper_site_visit",
    trapping: "verified_cats",
    feeding: "trapper_site_visit",
    sighting: "trapper_site_visit",
    other: "trapper_site_visit",
  };

  const sourceType = sourceTypeMap[eventType] || "trapper_site_visit";

  // Try to find a matching place
  const place = await queryOne<{ place_id: string; display_name: string | null; formatted_address: string | null }>(
    `
    SELECT place_id, display_name, formatted_address
    FROM trapper.places
    WHERE (display_name ILIKE $1 OR formatted_address ILIKE $1)
      AND merged_into_place_id IS NULL
    ORDER BY
      CASE WHEN display_name ILIKE $1 THEN 0 ELSE 1 END,
      display_name
    LIMIT 1
    `,
    [`%${location}%`]
  );

  if (!place) {
    // Create a new place if not found (using find_or_create_place_deduped)
    const newPlace = await queryOne<{ place_id: string }>(
      `SELECT * FROM trapper.find_or_create_place_deduped($1, NULL, NULL, NULL, 'tippy_event')`,
      [location]
    );

    if (!newPlace) {
      return {
        success: false,
        error: `Could not find or create place for location: ${location}`,
      };
    }

    // Log the event as a colony estimate observation
    if (catCount && catCount > 0) {
      await queryOne(
        `
        INSERT INTO trapper.place_colony_estimates (
          place_id,
          total_cats,
          source_type,
          observation_date,
          source_system,
          notes
        ) VALUES ($1, $2, $3, NOW(), 'tippy_event', $4)
        RETURNING estimate_id
        `,
        [
          newPlace.place_id,
          catCount,
          sourceType,
          buildEventNotes(eventType, catCount, eartippedCount, notes),
        ]
      );
    }

    // Also log to journal_entries for audit trail
    await queryOne(
      `
      INSERT INTO trapper.journal_entries (
        entry_type,
        entry_date,
        place_id,
        content,
        source_system,
        created_by
      ) VALUES ($1, NOW(), $2, $3, 'tippy_event', 'tippy_ai')
      RETURNING entry_id
      `,
      [
        eventType,
        newPlace.place_id,
        buildEventNotes(eventType, catCount, eartippedCount, notes),
      ]
    );

    return {
      success: true,
      data: {
        logged: true,
        place_created: true,
        place_id: newPlace.place_id,
        event_type: eventType,
        cat_count: catCount,
        eartipped_count: eartippedCount,
        message: `Logged ${eventType} event at new location "${location}"${catCount ? ` - ${catCount} cats reported` : ""}`,
      },
    };
  }

  // Log to existing place
  if (catCount && catCount > 0) {
    await queryOne(
      `
      INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        source_type,
        observation_date,
        source_system,
        notes
      ) VALUES ($1, $2, $3, NOW(), 'tippy_event', $4)
      RETURNING estimate_id
      `,
      [
        place.place_id,
        catCount,
        sourceType,
        buildEventNotes(eventType, catCount, eartippedCount, notes),
      ]
    );
  }

  // Log to journal_entries for audit trail
  await queryOne(
    `
    INSERT INTO trapper.journal_entries (
      entry_type,
      entry_date,
      place_id,
      content,
      source_system,
      created_by
    ) VALUES ($1, NOW(), $2, $3, 'tippy_event', 'tippy_ai')
    RETURNING entry_id
    `,
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
      message: `Logged ${eventType} event at "${place.display_name || place.formatted_address}"${catCount ? ` - ${catCount} cats reported${eartippedCount ? ` (${eartippedCount} eartipped)` : ""}` : ""}`,
    },
  };
}

/**
 * Build formatted notes string for event logging
 */
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

  if (catCount) {
    parts.push(`${catCount} cats`);
  }

  if (eartippedCount) {
    parts.push(`(${eartippedCount} eartipped)`);
  }

  if (notes) {
    parts.push(`- ${notes}`);
  }

  parts.push(`Logged via Tippy at ${new Date().toISOString()}`);

  return parts.join(" ");
}

/**
 * Look up cat appointment history by microchip, name, or owner info
 * Searches both verified Atlas records AND raw ClinicHQ data
 * Reports discrepancies and logs unmatched queries for review
 */
async function lookupCatAppointment(
  microchip?: string,
  catName?: string,
  ownerName?: string,
  ownerPhone?: string
): Promise<ToolResult> {
  if (!microchip && !catName && !ownerName && !ownerPhone) {
    return {
      success: false,
      error: "Please provide at least one search parameter: microchip, cat name, owner name, or owner phone",
    };
  }

  interface AtlasRecord {
    cat_id: string;
    cat_name: string;
    microchip: string | null;
    altered_status: string;
    appointment_count: number;
    last_appointment: string | null;
    last_service: string | null;
    owner_names: string[];
  }

  interface RawRecord {
    source_row_id: string;
    cat_name: string;
    microchip: string | null;
    owner_name: string | null;
    owner_phone: string | null;
    owner_address: string | null;
    appointment_date: string | null;
    service_type: string | null;
    is_processed: boolean;
  }

  // Search Atlas verified records (sot_cats + sot_appointments)
  let atlasResults: AtlasRecord[] = [];
  let rawResults: RawRecord[] = [];

  // Build Atlas query
  const atlasConditions: string[] = [];
  const atlasParams: (string | null)[] = [];
  let paramIndex = 1;

  if (microchip) {
    atlasConditions.push(`ci.id_value = $${paramIndex}`);
    atlasParams.push(microchip.replace(/\s/g, ""));
    paramIndex++;
  }
  if (catName) {
    atlasConditions.push(`c.display_name ILIKE $${paramIndex}`);
    atlasParams.push(`%${catName}%`);
    paramIndex++;
  }

  if (atlasConditions.length > 0) {
    atlasResults = await queryRows<AtlasRecord>(
      `
      SELECT DISTINCT ON (c.cat_id)
        c.cat_id,
        c.display_name as cat_name,
        ci.id_value as microchip,
        c.altered_status,
        (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id) as appointment_count,
        (SELECT MAX(appointment_date)::text FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id) as last_appointment,
        (SELECT service_type FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id ORDER BY appointment_date DESC LIMIT 1) as last_service,
        ARRAY(
          SELECT DISTINCT p.display_name
          FROM trapper.sot_appointments a
          JOIN trapper.sot_people p ON a.person_id = p.person_id
          WHERE a.cat_id = c.cat_id AND p.display_name IS NOT NULL
          LIMIT 5
        ) as owner_names
      FROM trapper.sot_cats c
      LEFT JOIN trapper.cat_identifiers ci ON c.cat_id = ci.cat_id AND ci.id_type = 'microchip'
      WHERE (${atlasConditions.join(" OR ")})
        AND c.merged_into_cat_id IS NULL
      ORDER BY c.cat_id, c.updated_at DESC
      LIMIT 10
      `,
      atlasParams
    );
  }

  // Build raw ClinicHQ query to search staged_records
  const rawConditions: string[] = [];
  const rawParams: (string | null)[] = [];
  paramIndex = 1;

  if (microchip) {
    rawConditions.push(`payload->>'Microchip Number' = $${paramIndex}`);
    rawParams.push(microchip.replace(/\s/g, ""));
    paramIndex++;
  }
  if (catName) {
    rawConditions.push(`payload->>'Patient Name' ILIKE $${paramIndex}`);
    rawParams.push(`%${catName}%`);
    paramIndex++;
  }
  if (ownerName) {
    rawConditions.push(`(payload->>'Client First Name' || ' ' || payload->>'Client Last Name') ILIKE $${paramIndex}`);
    rawParams.push(`%${ownerName}%`);
    paramIndex++;
  }
  if (ownerPhone) {
    const normalizedPhone = ownerPhone.replace(/\D/g, "");
    rawConditions.push(`REGEXP_REPLACE(payload->>'Phone', '[^0-9]', '', 'g') LIKE $${paramIndex}`);
    rawParams.push(`%${normalizedPhone}%`);
    paramIndex++;
  }

  if (rawConditions.length > 0) {
    rawResults = await queryRows<RawRecord>(
      `
      SELECT
        source_row_id,
        payload->>'Patient Name' as cat_name,
        payload->>'Microchip Number' as microchip,
        TRIM(COALESCE(payload->>'Client First Name', '') || ' ' || COALESCE(payload->>'Client Last Name', '')) as owner_name,
        payload->>'Phone' as owner_phone,
        TRIM(COALESCE(payload->>'Address', '') || ' ' || COALESCE(payload->>'City', '') || ' ' || COALESCE(payload->>'State', '')) as owner_address,
        payload->>'Appointment Date' as appointment_date,
        payload->>'Service' as service_type,
        is_processed
      FROM trapper.staged_records
      WHERE source_system = 'clinichq'
        AND (${rawConditions.join(" OR ")})
      ORDER BY (payload->>'Appointment Date')::date DESC NULLS LAST
      LIMIT 20
      `,
      rawParams
    );
  }

  // Analyze results and find discrepancies
  const inAtlas = atlasResults.length > 0;
  const inRaw = rawResults.length > 0;
  const rawUnprocessed = rawResults.filter(r => !r.is_processed);

  // If found in raw but not in Atlas, log for review
  if (inRaw && !inAtlas && rawResults.length > 0) {
    const firstRaw = rawResults[0];
    try {
      await queryOne(
        `
        INSERT INTO trapper.review_queue (
          entity_type,
          entity_id,
          reason,
          details,
          source_system,
          created_at
        ) VALUES (
          'unlinked_appointment',
          $1,
          'Tippy lookup found raw ClinicHQ record not linked to Atlas cat',
          $2,
          'tippy_lookup',
          NOW()
        )
        ON CONFLICT DO NOTHING
        `,
        [
          firstRaw.source_row_id,
          JSON.stringify({
            search_params: { microchip, catName, ownerName, ownerPhone },
            raw_record: firstRaw,
            searched_at: new Date().toISOString(),
          }),
        ]
      );
    } catch {
      // Ignore errors logging to review queue
    }
  }

  // Build response
  if (!inAtlas && !inRaw) {
    return {
      success: true,
      data: {
        found: false,
        in_atlas: false,
        in_raw_clinichq: false,
        message: `No records found for this search. The cat may not have visited the FFSC clinic, or the search terms don't match our records.`,
        suggestion: "Try searching with different spelling, or check the microchip number is correct.",
      },
    };
  }

  if (inAtlas && !inRaw) {
    const cat = atlasResults[0];
    return {
      success: true,
      data: {
        found: true,
        in_atlas: true,
        in_raw_clinichq: false,
        atlas_record: {
          cat_name: cat.cat_name,
          microchip: cat.microchip,
          altered_status: cat.altered_status,
          appointment_count: cat.appointment_count,
          last_appointment: cat.last_appointment,
          last_service: cat.last_service,
          known_owners: cat.owner_names,
        },
        message: `Found in Atlas: "${cat.cat_name}" (${cat.altered_status || "unknown status"}). ${cat.appointment_count} appointment(s) on record. Last visit: ${cat.last_appointment || "unknown"}.`,
        note: "This cat exists in Atlas but no matching raw ClinicHQ staged record was found (may have been cleaned up after processing).",
      },
    };
  }

  if (!inAtlas && inRaw) {
    const raw = rawResults[0];
    return {
      success: true,
      data: {
        found: true,
        in_atlas: false,
        in_raw_clinichq: true,
        raw_record: {
          cat_name: raw.cat_name,
          microchip: raw.microchip,
          owner_name: raw.owner_name,
          owner_phone: raw.owner_phone,
          owner_address: raw.owner_address,
          appointment_date: raw.appointment_date,
          service_type: raw.service_type,
          is_processed: raw.is_processed,
        },
        raw_record_count: rawResults.length,
        unprocessed_count: rawUnprocessed.length,
        message: `Found in raw ClinicHQ data but NOT linked in Atlas. Last appointment: ${raw.appointment_date || "unknown"} under name "${raw.owner_name}" for cat "${raw.cat_name}".`,
        discrepancy: {
          reason: "Record exists in ClinicHQ but not properly linked in Atlas",
          likely_causes: [
            "Name/address mismatch preventing identity linking",
            "Missing or invalid microchip number",
            "Processing pipeline hasn't run yet",
            raw.is_processed ? "Processed but entity linking failed" : "Record not yet processed",
          ],
          action: "This has been logged for review. A data admin should investigate the linking issue.",
        },
      },
    };
  }

  // Both Atlas and Raw found - compare
  const atlasRec = atlasResults[0];
  const rawRec = rawResults[0];
  const nameMatch = atlasRec.cat_name?.toLowerCase() === rawRec.cat_name?.toLowerCase();
  const chipMatch = atlasRec.microchip === rawRec.microchip;

  return {
    success: true,
    data: {
      found: true,
      in_atlas: true,
      in_raw_clinichq: true,
      atlas_record: {
        cat_name: atlasRec.cat_name,
        microchip: atlasRec.microchip,
        altered_status: atlasRec.altered_status,
        appointment_count: atlasRec.appointment_count,
        last_appointment: atlasRec.last_appointment,
        last_service: atlasRec.last_service,
        known_owners: atlasRec.owner_names,
      },
      raw_record: {
        cat_name: rawRec.cat_name,
        owner_name: rawRec.owner_name,
        appointment_date: rawRec.appointment_date,
        service_type: rawRec.service_type,
      },
      raw_record_count: rawResults.length,
      data_quality: {
        names_match: nameMatch,
        microchips_match: chipMatch,
        status: nameMatch && chipMatch ? "good" : "review_needed",
      },
      message: `Found in both Atlas and raw ClinicHQ. In Atlas as "${atlasRec.cat_name}" (${atlasRec.altered_status || "unknown"}), ${atlasRec.appointment_count} appointments. Raw ClinicHQ shows last booking under "${rawRec.owner_name}" for "${rawRec.cat_name}".`,
      summary: nameMatch && chipMatch
        ? "Records match well between Atlas and ClinicHQ."
        : `Note: Name in Atlas is "${atlasRec.cat_name}", in ClinicHQ booking it's "${rawRec.cat_name}". ${!chipMatch ? "Microchip numbers also differ." : ""}`,
    },
  };
}

/**
 * Parse relative time strings into timestamps
 */
function parseRelativeTime(timeStr: string): Date {
  const now = new Date();
  const lower = timeStr.toLowerCase().trim();

  // Handle relative times
  if (lower === "tomorrow" || lower === "tomorrow morning") {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0); // 9 AM
    return date;
  }

  if (lower === "tomorrow afternoon") {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(14, 0, 0, 0); // 2 PM
    return date;
  }

  if (lower === "next week") {
    const date = new Date(now);
    date.setDate(date.getDate() + 7);
    date.setHours(9, 0, 0, 0);
    return date;
  }

  // "in X hours/days/weeks"
  const inMatch = lower.match(/^in\s+(\d+)\s+(hour|hours|day|days|week|weeks)$/);
  if (inMatch) {
    const amount = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const date = new Date(now);

    if (unit.startsWith("hour")) {
      date.setHours(date.getHours() + amount);
    } else if (unit.startsWith("day")) {
      date.setDate(date.getDate() + amount);
    } else if (unit.startsWith("week")) {
      date.setDate(date.getDate() + amount * 7);
    }
    return date;
  }

  // Try parsing as ISO date
  const parsed = new Date(timeStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Default: tomorrow at 9 AM
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

/**
 * Create a personal reminder for the staff member
 */
async function createReminder(
  title: string,
  dueTime: string,
  notes?: string,
  entityType?: string,
  entityIdentifier?: string,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return {
      success: false,
      error: "Staff context required to create reminders. Please try again.",
    };
  }

  const dueAt = parseRelativeTime(dueTime);
  let entityId: string | null = null;

  // Try to resolve entity if identifier provided
  if (entityType && entityIdentifier) {
    try {
      let query = "";
      let params: string[] = [];

      switch (entityType) {
        case "place":
          query = `SELECT place_id FROM trapper.places WHERE (display_name ILIKE $1 OR formatted_address ILIKE $1) AND merged_into_place_id IS NULL LIMIT 1`;
          params = [`%${entityIdentifier}%`];
          break;
        case "cat":
          query = `SELECT cat_id FROM trapper.sot_cats WHERE display_name ILIKE $1 LIMIT 1`;
          params = [`%${entityIdentifier}%`];
          break;
        case "person":
          query = `SELECT person_id FROM trapper.sot_people WHERE display_name ILIKE $1 LIMIT 1`;
          params = [`%${entityIdentifier}%`];
          break;
        case "request":
          query = `SELECT request_id FROM trapper.sot_requests WHERE summary ILIKE $1 OR request_id::text = $1 LIMIT 1`;
          params = [entityIdentifier.includes("-") ? entityIdentifier : `%${entityIdentifier}%`];
          break;
      }

      if (query) {
        const result = await queryOne<{ [key: string]: string }>(query, params);
        if (result) {
          entityId = Object.values(result)[0];
        }
      }
    } catch {
      // Ignore entity resolution errors
    }
  }

  // Create the reminder
  try {
    const result = await queryOne<{ reminder_id: string; due_at: string }>(
      `INSERT INTO trapper.staff_reminders (
        staff_id, title, notes, entity_type, entity_id,
        due_at, remind_at, created_via, tippy_conversation_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $6, 'tippy', $7
      )
      RETURNING reminder_id, due_at`,
      [
        context.staffId,
        title,
        notes || null,
        entityId ? entityType : null,
        entityId,
        dueAt.toISOString(),
        context.conversationId || null,
      ]
    );

    if (!result) {
      return { success: false, error: "Failed to create reminder" };
    }

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
        entity_linked: !!entityId,
        message: `Reminder created: "${title}" for ${formattedDate}.${entityId ? ` Linked to ${entityType}.` : ""} You'll see it on your dashboard.`,
      },
    };
  } catch (error) {
    console.error("Create reminder error:", error);
    return { success: false, error: "Failed to create reminder" };
  }
}

/**
 * Save a lookup/research result to the staff member's personal lookups
 */
async function saveLookup(
  title: string,
  summary: string,
  queryText?: string,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return {
      success: false,
      error: "Staff context required to save lookups. Please try again.",
    };
  }

  // Compile recent tool results into result_data
  const resultData: Record<string, unknown> = {};
  let entityType: string | null = null;
  let entityId: string | null = null;

  if (context.recentToolResults && context.recentToolResults.length > 0) {
    const toolResults = context.recentToolResults.filter((r) => r.success && r.data);
    resultData.tool_results = toolResults.map((r) => r.data);

    // Try to extract entity info from the results
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
      } else if (data.places && Array.isArray(data.places) && data.places.length > 0) {
        entityType = "place";
        entityId = data.places[0].place_id;
      }
    }
  }

  try {
    const result = await queryOne<{ lookup_id: string }>(
      `INSERT INTO trapper.staff_lookups (
        staff_id, title, query_text, summary, result_data,
        entity_type, entity_id, tool_calls
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8
      )
      RETURNING lookup_id`,
      [
        context.staffId,
        title,
        queryText || "Research lookup",
        summary,
        JSON.stringify(resultData),
        entityType,
        entityId,
        context.recentToolResults ? JSON.stringify(
          context.recentToolResults.map((r) => ({
            success: r.success,
            has_data: !!r.data,
          }))
        ) : null,
      ]
    );

    if (!result) {
      return { success: false, error: "Failed to save lookup" };
    }

    return {
      success: true,
      data: {
        lookup_id: result.lookup_id,
        title,
        summary,
        entity_linked: !!entityId,
        message: `Saved to your lookups: "${title}". You can view it anytime on your personal dashboard at /me.`,
      },
    };
  } catch (error) {
    console.error("Save lookup error:", error);
    return { success: false, error: "Failed to save lookup" };
  }
}

/**
 * Log a data discrepancy for admin review
 * This is called silently - does not return verbose info to user
 */
async function logDataDiscrepancy(
  title: string,
  description: string,
  entityType?: string,
  entityId?: string,
  rawData?: Record<string, unknown>,
  processedData?: Record<string, unknown>,
  suggestedFix?: string
): Promise<ToolResult> {
  try {
    // Build the full description with data
    const fullDescription = JSON.stringify({
      description,
      raw_data: rawData || null,
      processed_data: processedData || null,
      logged_at: new Date().toISOString(),
    });

    await queryOne(
      `INSERT INTO trapper.data_improvements (
        title,
        description,
        entity_type,
        entity_id,
        category,
        priority,
        suggested_fix,
        source,
        status
      ) VALUES (
        $1, $2, $3, $4::uuid,
        'missing_data',
        'normal',
        $5,
        'automated_check',
        'pending'
      )
      ON CONFLICT DO NOTHING`,
      [
        title,
        fullDescription,
        entityType || null,
        entityId || null,
        suggestedFix ? JSON.stringify({ suggestion: suggestedFix }) : null,
      ]
    );

    // Silent success - don't expose logging details to user
    return {
      success: true,
      data: {
        logged: true,
      },
    };
  } catch (error) {
    // Log error but don't fail the tool - this is a background operation
    console.error("Log discrepancy error:", error);
    return {
      success: true,
      data: {
        logged: false,
        note: "Could not log discrepancy",
      },
    };
  }
}

/**
 * Log a site observation via Tippy AI
 *
 * This creates a PENDING review item with lower confidence (40%) than UI submissions (75%).
 * The observation is NOT directly added to colony estimates - it goes to a review queue.
 * This encourages staff to use the Atlas UI for higher-weight observations.
 */
async function logSiteObservation(
  address: string,
  catCount: number,
  observationNotes?: string,
  context?: ToolContext
): Promise<ToolResult> {
  if (!context?.staffId) {
    return {
      success: false,
      error: "You need to be logged in to log site observations.",
    };
  }

  try {
    // Create a data improvement record for review rather than directly modifying data
    const title = `AI Observation: ~${catCount} cats at ${address}`;
    const description = JSON.stringify({
      type: "tippy_ai_observation",
      address,
      estimated_cats: catCount,
      observation_notes: observationNotes || null,
      observer_staff_id: context.staffId,
      observer_name: context.staffName,
      reported_via: "tippy_chat",
      confidence_weight: 0.40,
      needs_verification: true,
      logged_at: new Date().toISOString(),
    });

    await queryOne(
      `INSERT INTO trapper.data_improvements (
        title,
        description,
        category,
        priority,
        source,
        status,
        suggested_fix
      ) VALUES (
        $1, $2,
        'missing_data',
        'low',
        'tippy_feedback',
        'pending',
        $3
      )
      RETURNING improvement_id`,
      [
        title,
        description,
        JSON.stringify({
          action: "verify_and_add_to_colony_estimates",
          source_type: "tippy_ai_observation",
          confidence: 0.40,
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
        message:
          `Observation logged: ~${catCount} cats at ${address}. ` +
          `This will be reviewed before being added to our colony data. ` +
          `\n\n💡 **Tip:** For observations to count with higher confidence (75%), ` +
          `use the Atlas UI at /beacon or create a site visit report. ` +
          `AI-reported observations have 40% weight vs 75% for UI submissions.`,
      },
    };
  } catch (error) {
    console.error("Log site observation error:", error);
    return { success: false, error: "Failed to log observation" };
  }
}

/**
 * Query person-cat relationships (foster, adopter, owner history)
 */
async function queryPersonCatRelationships(
  personName?: string,
  personEmail?: string,
  relationshipType?: string
): Promise<ToolResult> {
  if (!personName && !personEmail) {
    return {
      success: false,
      error: "Please provide either a person name or email to search for",
    };
  }

  interface RelationshipResult {
    person_id: string;
    person_name: string;
    email: string | null;
    relationship_type: string;
    cat_count: number;
    cat_names: string[];
    cat_microchips: string[];
    sources: string[];
  }

  const results = await queryRows<RelationshipResult>(
    `SELECT * FROM trapper.query_person_cat_history($1, $2, $3)`,
    [personName || null, personEmail || null, relationshipType || null]
  );

  if (!results || results.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        message: personName
          ? `No cat relationships found for person matching "${personName}"${relationshipType ? ` with relationship type "${relationshipType}"` : ""}`
          : `No cat relationships found for email "${personEmail}"`,
        suggestion: "Try searching with a different name spelling or without the relationship type filter.",
      },
    };
  }

  // Group by person and summarize
  const byPerson = new Map<string, RelationshipResult[]>();
  for (const r of results) {
    const existing = byPerson.get(r.person_id) || [];
    existing.push(r);
    byPerson.set(r.person_id, existing);
  }

  const summaries = Array.from(byPerson.entries()).map(([personId, rels]) => {
    const totalCats = rels.reduce((sum, r) => sum + Number(r.cat_count), 0);
    const relationshipCounts = rels.map(r => `${r.cat_count} ${r.relationship_type}`).join(", ");
    const allCatNames = [...new Set(rels.flatMap(r => r.cat_names || []))].slice(0, 10);
    const sources = [...new Set(rels.flatMap(r => r.sources || []))];

    return {
      person_id: personId,
      person_name: rels[0].person_name,
      email: rels[0].email,
      total_cats: totalCats,
      relationships: relationshipCounts,
      cat_names: allCatNames,
      data_sources: sources,
    };
  });

  const primary = summaries[0];
  const catPlural = primary.total_cats === 1 ? "cat" : "cats";

  return {
    success: true,
    data: {
      found: true,
      people: summaries,
      summary: summaries.length === 1
        ? `**${primary.person_name}** has ${primary.total_cats} ${catPlural} in our records (${primary.relationships}). Names include: ${primary.cat_names.slice(0, 5).join(", ")}${primary.cat_names.length > 5 ? ", ..." : ""}. Data from: ${primary.data_sources.join(", ")}.`
        : `Found ${summaries.length} people matching. Top result: ${primary.person_name} with ${primary.total_cats} ${catPlural}.`,
    },
  };
}

/**
 * Query places by context type (colony sites, foster homes, etc.)
 */
async function queryPlacesByContext(
  contextType: string,
  area?: string
): Promise<ToolResult> {
  // Get search patterns for area (handles regional names)
  const searchPatterns = area ? getAreaSearchPatterns(area) : [];
  const isRegionalSearch = searchPatterns.length > 1;

  let areaCondition = "";
  let params: string[] = [contextType];

  if (area && searchPatterns.length > 0) {
    const patternConditions = searchPatterns.map((_, i) => `p.formatted_address ILIKE $${i + 2}`).join(" OR ");
    areaCondition = `AND (${patternConditions})`;
    params = [contextType, ...searchPatterns.map(p => `%${p}%`)];
  }

  interface PlaceContextResult {
    place_id: string;
    display_name: string | null;
    formatted_address: string | null;
    context_type: string;
    context_label: string;
    valid_from: string | null;
    confidence: number;
    is_verified: boolean;
  }

  const results = await queryRows<PlaceContextResult>(
    `
    SELECT
      pc.place_id,
      p.display_name,
      p.formatted_address,
      pc.context_type,
      pct.display_label as context_label,
      pc.valid_from::text,
      pc.confidence,
      pc.is_verified
    FROM trapper.place_contexts pc
    JOIN trapper.places p ON p.place_id = pc.place_id
    JOIN trapper.place_context_types pct ON pct.context_type = pc.context_type
    WHERE pc.context_type = $1
      AND pc.valid_to IS NULL
      AND p.merged_into_place_id IS NULL
      ${areaCondition}
    ORDER BY pc.confidence DESC, pc.assigned_at DESC
    LIMIT 20
    `,
    params
  );

  if (!results || results.length === 0) {
    const contextLabel = contextType.replace(/_/g, " ");
    return {
      success: true,
      data: {
        found: false,
        context_type: contextType,
        area: area || "all areas",
        searched_cities: isRegionalSearch ? searchPatterns : undefined,
        message: area
          ? `No ${contextLabel}s found in ${area}${isRegionalSearch ? ` (searched: ${searchPatterns.slice(0, 3).join(", ")}${searchPatterns.length > 3 ? ", ..." : ""})` : ""}.`
          : `No ${contextLabel}s found in the database.`,
      },
    };
  }

  const contextLabel = results[0].context_label;

  return {
    success: true,
    data: {
      found: true,
      context_type: contextType,
      context_label: contextLabel,
      area: area || "all areas",
      is_regional_search: isRegionalSearch,
      searched_cities: isRegionalSearch ? searchPatterns : undefined,
      places: results.map(r => ({
        place_id: r.place_id,
        name: r.display_name || r.formatted_address,
        address: r.formatted_address,
        since: r.valid_from,
        confidence: r.confidence,
        verified: r.is_verified,
      })),
      count: results.length,
      summary: `Found **${results.length} ${contextLabel}(s)**${area ? ` in ${area}` : ""}${isRegionalSearch ? ` (includes ${searchPatterns.slice(0, 3).join(", ")})` : ""}. Examples: ${results.slice(0, 3).map(r => r.display_name || r.formatted_address?.split(",")[0]).join("; ")}${results.length > 3 ? "; ..." : ""}.`,
    },
  };
}

/**
 * Query a cat's journey through FFSC (trapping, clinic, foster, adoption)
 */
async function queryCatJourney(
  microchip?: string,
  catName?: string
): Promise<ToolResult> {
  if (!microchip && !catName) {
    return {
      success: false,
      error: "Please provide either a microchip number or cat name to search for",
    };
  }

  // Find the cat
  interface CatInfo {
    cat_id: string;
    display_name: string;
    microchip: string | null;
    altered_status: string | null;
    breed: string | null;
    primary_color: string | null;
  }

  const catConditions: string[] = [];
  const catParams: string[] = [];
  let paramIndex = 1;

  if (microchip) {
    catConditions.push(`ci.id_value = $${paramIndex}`);
    catParams.push(microchip.replace(/\s/g, ""));
    paramIndex++;
  }
  if (catName) {
    catConditions.push(`c.display_name ILIKE $${paramIndex}`);
    catParams.push(`%${catName}%`);
    paramIndex++;
  }

  const catResult = await queryOne<CatInfo>(
    `
    SELECT DISTINCT ON (c.cat_id)
      c.cat_id,
      c.display_name,
      ci.id_value as microchip,
      c.altered_status,
      c.breed,
      c.primary_color
    FROM trapper.sot_cats c
    LEFT JOIN trapper.cat_identifiers ci ON c.cat_id = ci.cat_id AND ci.id_type = 'microchip'
    WHERE (${catConditions.join(" OR ")})
      AND c.merged_into_cat_id IS NULL
    LIMIT 1
    `,
    catParams
  );

  if (!catResult) {
    return {
      success: true,
      data: {
        found: false,
        message: microchip
          ? `No cat found with microchip "${microchip}"`
          : `No cat found matching name "${catName}"`,
        suggestion: "Check the microchip number for typos, or try a different name spelling.",
      },
    };
  }

  // Get clinic appointments
  interface AppointmentInfo {
    appointment_date: string;
    service_type: string | null;
    is_spay: boolean;
    is_neuter: boolean;
    place_address: string | null;
    vet_name: string | null;
  }

  const appointments = await queryRows<AppointmentInfo>(
    `
    SELECT
      a.appointment_date::text,
      a.service_type,
      a.is_spay,
      a.is_neuter,
      p.formatted_address as place_address,
      a.vet_name
    FROM trapper.sot_appointments a
    LEFT JOIN trapper.places p ON a.place_id = p.place_id
    WHERE a.cat_id = $1
    ORDER BY a.appointment_date DESC
    `,
    [catResult.cat_id]
  );

  // Get place relationships (where cat has been)
  interface PlaceInfo {
    place_id: string;
    formatted_address: string | null;
    relationship_type: string;
    contexts: string[];
  }

  const places = await queryRows<PlaceInfo>(
    `
    SELECT
      p.place_id,
      p.formatted_address,
      cpr.relationship_type,
      ARRAY_AGG(DISTINCT pc.context_type) FILTER (WHERE pc.context_type IS NOT NULL) as contexts
    FROM trapper.cat_place_relationships cpr
    JOIN trapper.places p ON p.place_id = cpr.place_id
    LEFT JOIN trapper.place_contexts pc ON pc.place_id = p.place_id AND pc.valid_to IS NULL
    WHERE cpr.cat_id = $1
      AND p.merged_into_place_id IS NULL
    GROUP BY p.place_id, p.formatted_address, cpr.relationship_type
    `,
    [catResult.cat_id]
  );

  // Get person relationships (owners, fosters, adopters)
  interface PersonRelInfo {
    person_name: string;
    relationship_type: string;
    source_system: string;
  }

  const personRels = await queryRows<PersonRelInfo>(
    `
    SELECT
      p.display_name as person_name,
      pcr.relationship_type,
      pcr.source_system
    FROM trapper.person_cat_relationships pcr
    JOIN trapper.sot_people p ON p.person_id = pcr.person_id
    WHERE pcr.cat_id = $1
      AND p.merged_into_person_id IS NULL
    ORDER BY pcr.created_at DESC
    `,
    [catResult.cat_id]
  );

  // Build journey summary
  const journeySteps: string[] = [];

  // Add origin from places with colony_site context
  const originPlaces = places.filter(p => p.contexts?.includes("colony_site"));
  if (originPlaces.length > 0) {
    journeySteps.push(`🏠 **Origin**: ${originPlaces[0].formatted_address?.split(",")[0] || "Unknown location"} (colony site)`);
  }

  // Add clinic visits
  if (appointments.length > 0) {
    const lastAppt = appointments[0];
    const alteredText = lastAppt.is_spay ? "spayed" : lastAppt.is_neuter ? "neutered" : lastAppt.service_type;
    journeySteps.push(`🏥 **Clinic**: ${appointments.length} visit(s). Last: ${lastAppt.appointment_date} (${alteredText || "service"})`);
  }

  // Add foster/adopter info
  const fosters = personRels.filter(p => p.relationship_type === "foster");
  const adopters = personRels.filter(p => p.relationship_type === "adopter");
  const owners = personRels.filter(p => p.relationship_type === "owner");

  if (fosters.length > 0) {
    journeySteps.push(`🏡 **Foster**: ${fosters.map(f => f.person_name).join(", ")}`);
  }
  if (adopters.length > 0) {
    journeySteps.push(`❤️ **Adopted by**: ${adopters.map(a => a.person_name).join(", ")}`);
  }
  if (owners.length > 0 && adopters.length === 0) {
    journeySteps.push(`👤 **Owner**: ${owners.map(o => o.person_name).join(", ")}`);
  }

  // Build summary
  const summary = `**${catResult.display_name}** (${catResult.altered_status || "unknown status"})${catResult.microchip ? `, microchip: ${catResult.microchip}` : ""}

${journeySteps.length > 0 ? journeySteps.join("\n") : "Limited journey data available."}`;

  return {
    success: true,
    data: {
      found: true,
      cat: {
        cat_id: catResult.cat_id,
        name: catResult.display_name,
        microchip: catResult.microchip,
        altered_status: catResult.altered_status,
        breed: catResult.breed,
        color: catResult.primary_color,
      },
      journey: {
        appointments: appointments.length,
        places_linked: places.length,
        people_linked: personRels.length,
        fosters: fosters.map(f => f.person_name),
        adopters: adopters.map(a => a.person_name),
        owners: owners.map(o => o.person_name),
        clinic_history: appointments.slice(0, 5).map(a => ({
          date: a.appointment_date,
          service: a.is_spay ? "Spay" : a.is_neuter ? "Neuter" : a.service_type,
          location: a.place_address?.split(",")[0],
        })),
      },
      summary,
    },
  };
}

/**
 * Query trapper statistics - counts, types, performance metrics
 */
async function queryTrapperStats(
  queryType: string,
  trapperName?: string,
  trapperType?: string,
  limit?: number
): Promise<ToolResult> {
  const maxResults = limit || 10;

  switch (queryType) {
    case "summary": {
      // Get aggregate stats from v_trapper_aggregate_stats
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
        `SELECT
          total_active_trappers,
          ffsc_trappers,
          community_trappers,
          inactive_trappers,
          all_clinic_cats,
          all_clinic_days,
          ROUND(avg_cats_per_day_all, 1) as avg_cats_per_day_all,
          all_cats_caught
        FROM trapper.v_trapper_aggregate_stats
        LIMIT 1`
      );

      if (!aggregates) {
        // Fallback to direct query if view doesn't exist
        const fallback = await queryOne<{ total: number; ffsc: number; community: number }>(
          `SELECT
            COUNT(*) FILTER (WHERE role_status = 'active') as total,
            COUNT(*) FILTER (WHERE trapper_type = 'ffsc_trapper' AND role_status = 'active') as ffsc,
            COUNT(*) FILTER (WHERE trapper_type = 'community_trapper' AND role_status = 'active') as community
          FROM trapper.person_roles
          WHERE role = 'trapper'`
        );
        return {
          success: true,
          data: {
            total_active: fallback?.total || 0,
            ffsc_trappers: fallback?.ffsc || 0,
            community_trappers: fallback?.community || 0,
            summary: `FFSC has ${fallback?.total || 0} active trappers: ${fallback?.ffsc || 0} FFSC volunteers and ${fallback?.community || 0} community trappers.`,
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
      // Get counts broken down by trapper type
      const byType = await queryRows<{
        trapper_type: string;
        role_status: string;
        count: number;
      }>(
        `SELECT
          trapper_type,
          role_status,
          COUNT(*) as count
        FROM trapper.person_roles
        WHERE role = 'trapper' AND trapper_type IS NOT NULL
        ${trapperType && trapperType !== "all" ? "AND trapper_type = $1" : ""}
        GROUP BY trapper_type, role_status
        ORDER BY trapper_type, role_status`,
        trapperType && trapperType !== "all" ? [trapperType] : []
      );

      const breakdown: Record<string, { active: number; inactive: number }> = {};
      for (const row of byType) {
        if (!breakdown[row.trapper_type]) {
          breakdown[row.trapper_type] = { active: 0, inactive: 0 };
        }
        if (row.role_status === "active") {
          breakdown[row.trapper_type].active = row.count;
        } else {
          breakdown[row.trapper_type].inactive += row.count;
        }
      }

      const summaryParts = Object.entries(breakdown).map(
        ([type, counts]) => `${type.replace(/_/g, " ")}: ${counts.active} active, ${counts.inactive} inactive`
      );

      return {
        success: true,
        data: {
          breakdown,
          summary: summaryParts.join("; ") || "No trappers found",
        },
      };
    }

    case "individual": {
      if (!trapperName) {
        return {
          success: false,
          error: "Please provide a trapper name to look up individual stats",
        };
      }

      // Find the trapper and get their stats
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
        `SELECT
          person_id,
          display_name,
          trapper_type,
          role_status,
          COALESCE(active_assignments, 0) as active_assignments,
          COALESCE(completed_assignments, 0) as completed_assignments,
          COALESCE(total_cats_caught, 0) as total_cats_caught,
          COALESCE(total_clinic_cats, 0) as total_clinic_cats,
          COALESCE(unique_clinic_days, 0) as unique_clinic_days,
          COALESCE(ROUND(avg_cats_per_day, 1), 0) as avg_cats_per_day,
          COALESCE(total_altered, 0) as total_altered,
          first_activity_date::text,
          last_activity_date::text
        FROM trapper.v_trapper_full_stats
        WHERE display_name ILIKE $1
        LIMIT 1`,
        [`%${trapperName}%`]
      );

      if (!trapper) {
        return {
          success: true,
          data: {
            found: false,
            summary: `No trapper found matching "${trapperName}"`,
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

    case "top_performers": {
      // Get top performers by total clinic cats
      const topTrappers = await queryRows<{
        display_name: string;
        trapper_type: string;
        total_clinic_cats: number;
        total_altered: number;
        unique_clinic_days: number;
        completed_assignments: number;
      }>(
        `SELECT
          display_name,
          trapper_type,
          COALESCE(total_clinic_cats, 0) as total_clinic_cats,
          COALESCE(total_altered, 0) as total_altered,
          COALESCE(unique_clinic_days, 0) as unique_clinic_days,
          COALESCE(completed_assignments, 0) as completed_assignments
        FROM trapper.v_trapper_full_stats
        WHERE role_status = 'active'
        ${trapperType && trapperType !== "all" ? "AND trapper_type = $1" : ""}
        ORDER BY total_clinic_cats DESC NULLS LAST
        LIMIT $${trapperType && trapperType !== "all" ? 2 : 1}`,
        trapperType && trapperType !== "all" ? [trapperType, maxResults] : [maxResults]
      );

      const topList = topTrappers.map((t, i) =>
        `${i + 1}. ${t.display_name}: ${t.total_clinic_cats} cats, ${t.total_altered} altered, ${t.unique_clinic_days} clinic days`
      );

      return {
        success: true,
        data: {
          trappers: topTrappers.map(t => ({
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
        error: `Unknown query type: ${queryType}. Use 'summary', 'by_type', 'individual', or 'top_performers'.`,
      };
  }
}

/**
 * Send a message to another staff member
 */
async function sendStaffMessage(
  recipientName: string,
  subject: string,
  content: string,
  priority: string | undefined,
  entityType: string | undefined,
  entityIdentifier: string | undefined,
  context: ToolContext | undefined
): Promise<ToolResult> {
  if (!context?.staffId) {
    return {
      success: false,
      error: "Staff context required to send messages",
    };
  }

  // Try to resolve entity if provided
  let entityId: string | null = null;
  let entityLabel: string | null = null;

  if (entityType && entityIdentifier) {
    if (entityType === "place") {
      const place = await queryOne<{ place_id: string; label: string }>(
        `SELECT place_id, display_name as label
         FROM trapper.places
         WHERE (display_name ILIKE $1 OR formatted_address ILIKE $1)
           AND merged_into_place_id IS NULL
         LIMIT 1`,
        [`%${entityIdentifier}%`]
      );
      if (place) {
        entityId = place.place_id;
        entityLabel = place.label;
      }
    } else if (entityType === "cat") {
      // Try microchip first, then name
      const cat = await queryOne<{ cat_id: string; display_name: string }>(
        `SELECT c.cat_id, c.display_name
         FROM trapper.sot_cats c
         LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
         WHERE c.display_name ILIKE $1
            OR ci.id_value = $1
         LIMIT 1`,
        [`%${entityIdentifier}%`]
      );
      if (cat) {
        entityId = cat.cat_id;
        entityLabel = cat.display_name;
      }
    } else if (entityType === "person") {
      const person = await queryOne<{ person_id: string; display_name: string }>(
        `SELECT p.person_id, p.display_name
         FROM trapper.sot_people p
         LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
         WHERE p.display_name ILIKE $1
            OR pi.id_value_norm = LOWER($2)
         LIMIT 1`,
        [`%${entityIdentifier}%`, entityIdentifier]
      );
      if (person) {
        entityId = person.person_id;
        entityLabel = person.display_name;
      }
    } else if (entityType === "request") {
      const request = await queryOne<{ request_id: string; summary: string }>(
        `SELECT request_id, short_address as summary
         FROM trapper.sot_requests
         WHERE request_id::text = $1
            OR short_address ILIKE $2
         LIMIT 1`,
        [entityIdentifier, `%${entityIdentifier}%`]
      );
      if (request) {
        entityId = request.request_id;
        entityLabel = request.summary;
      }
    }
  }

  // Use the SQL function to send the message
  const result = await queryOne<{
    result: {
      success: boolean;
      message_id?: string;
      recipient_name?: string;
      recipient_id?: string;
      error?: string;
    };
  }>(
    `SELECT trapper.send_staff_message(
      $1, $2, $3, $4, $5, $6, $7, $8, 'tippy', $9
    ) as result`,
    [
      context.staffId,
      recipientName,
      subject,
      content,
      priority || "normal",
      entityType || null,
      entityId || null,
      entityLabel || null,
      context.conversationId || null,
    ]
  );

  if (!result) {
    return {
      success: false,
      error: "Failed to send message",
    };
  }

  // Parse the JSONB result (may be string or object depending on pg driver)
  const parsed = typeof result.result === "string"
    ? JSON.parse(result.result)
    : result.result;

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error || "Failed to send message",
    };
  }

  return {
    success: true,
    data: {
      message_sent: true,
      recipient_name: parsed.recipient_name,
      message_id: parsed.message_id,
      entity_linked: entityId ? { type: entityType, label: entityLabel } : null,
    },
  };
}

/**
 * Comprehensive person lookup - traces ALL data sources
 */
async function comprehensivePersonLookup(
  identifier: string,
  identifierType: string | undefined
): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT trapper.comprehensive_person_lookup($1, $2) as result`,
    [identifier, identifierType || "auto"]
  );

  if (!result) {
    return {
      success: false,
      error: "Lookup failed",
    };
  }

  const parsed = typeof result.result === "string"
    ? JSON.parse(result.result)
    : result.result;

  if (!parsed.found) {
    return {
      success: true,
      data: {
        found: false,
        message: parsed.message || `No person found matching "${identifier}"`,
      },
    };
  }

  return {
    success: true,
    data: parsed,
  };
}

/**
 * Comprehensive cat lookup - traces ALL data sources
 */
async function comprehensiveCatLookup(
  identifier: string,
  identifierType: string | undefined
): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT trapper.comprehensive_cat_lookup($1, $2) as result`,
    [identifier, identifierType || "auto"]
  );

  if (!result) {
    return {
      success: false,
      error: "Lookup failed",
    };
  }

  const parsed = typeof result.result === "string"
    ? JSON.parse(result.result)
    : result.result;

  if (!parsed.found) {
    return {
      success: true,
      data: {
        found: false,
        message: parsed.message || `No cat found matching "${identifier}"`,
      },
    };
  }

  return {
    success: true,
    data: parsed,
  };
}

/**
 * Comprehensive place lookup - traces ALL activity at a location
 */
async function comprehensivePlaceLookup(address: string): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT trapper.comprehensive_place_lookup($1) as result`,
    [address]
  );

  if (!result) {
    return {
      success: false,
      error: "Lookup failed",
    };
  }

  const parsed = typeof result.result === "string"
    ? JSON.parse(result.result)
    : result.result;

  if (!parsed.found) {
    return {
      success: true,
      data: {
        found: false,
        message: parsed.message || `No place found matching "${address}"`,
      },
    };
  }

  return {
    success: true,
    data: parsed,
  };
}

// ============================================================================
// DATA QUALITY TOOLS (MIG_487)
// These tools use SQL functions from MIG_487__tippy_data_quality.sql
// ============================================================================

/**
 * Check data quality for an entity
 */
async function checkDataQuality(
  entityType: string,
  identifier: string
): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT trapper.check_entity_quality($1, $2) as result`,
    [entityType, identifier]
  );

  if (!result) {
    return {
      success: false,
      error: "Quality check failed",
    };
  }

  const parsed = typeof result.result === "string"
    ? JSON.parse(result.result)
    : result.result;

  if (!parsed.found) {
    return {
      success: true,
      data: {
        found: false,
        message: parsed.message || `No ${entityType} found matching "${identifier}"`,
      },
    };
  }

  return {
    success: true,
    data: parsed,
  };
}

/**
 * Find potential duplicates for deduplication review
 */
async function findPotentialDuplicates(
  entityType: string,
  identifier: string
): Promise<ToolResult> {
  const results = await queryRows(
    `SELECT * FROM trapper.find_potential_duplicates($1, $2)`,
    [entityType, identifier]
  );

  if (!results || results.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        message: `No potential duplicates found for ${entityType} "${identifier}"`,
        duplicates: [],
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      duplicates: results,
      count: results.length,
      summary: `Found ${results.length} potential duplicate(s) for ${entityType} "${identifier}"`,
    },
  };
}

/**
 * Query merge history for an entity
 */
async function queryMergeHistory(
  entityType: string,
  entityId: string
): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT trapper.query_merge_history($1, $2::uuid) as result`,
    [entityType, entityId]
  );

  if (!result) {
    return {
      success: false,
      error: "Merge history query failed",
    };
  }

  const parsed = typeof result.result === "string"
    ? JSON.parse(result.result)
    : result.result;

  return {
    success: true,
    data: parsed,
  };
}

/**
 * Query data lineage for an entity
 */
async function queryDataLineage(
  entityType: string,
  entityId: string
): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT trapper.query_data_lineage($1, $2::uuid) as result`,
    [entityType, entityId]
  );

  if (!result) {
    return {
      success: false,
      error: "Data lineage query failed",
    };
  }

  const parsed = typeof result.result === "string"
    ? JSON.parse(result.result)
    : result.result;

  return {
    success: true,
    data: parsed,
  };
}

/**
 * Query VolunteerHub-specific data for a person
 */
async function queryVolunteerhubData(
  personIdentifier: string
): Promise<ToolResult> {
  const result = await queryOne<{ result: unknown }>(
    `SELECT trapper.query_volunteerhub_data($1) as result`,
    [personIdentifier]
  );

  if (!result) {
    return {
      success: false,
      error: "VolunteerHub data query failed",
    };
  }

  const parsed = typeof result.result === "string"
    ? JSON.parse(result.result)
    : result.result;

  if (!parsed.found) {
    return {
      success: true,
      data: {
        found: false,
        message: parsed.message || `No VolunteerHub record found for "${personIdentifier}"`,
      },
    };
  }

  return {
    success: true,
    data: parsed,
  };
}

/**
 * Query source-specific extension data
 */
async function querySourceExtension(
  source: string,
  entityType: string,
  entityId: string
): Promise<ToolResult> {
  // For now, this queries the specific extension tables directly
  // Will be expanded as extension tables are created

  let query: string;
  let params: string[];

  if (source === "volunteerhub") {
    // VolunteerHub has a dedicated function
    return await queryVolunteerhubData(entityId);
  }

  // For other sources, construct query based on extension table pattern
  // Note: These tables may not exist yet - they will be created in future migrations
  switch (source) {
    case "shelterluv":
      if (entityType === "cat") {
        query = `
          SELECT
            ce.cat_id,
            ce.sl_animal_id,
            ce.intake_date,
            ce.intake_type,
            ce.hold_reason,
            ce.kennel_location,
            ce.sl_status,
            ce.internal_notes,
            ce.last_synced_at
          FROM trapper.shelterluv_cat_ext ce
          WHERE ce.cat_id = $1::uuid OR ce.sl_animal_id = $1
          LIMIT 1
        `;
      } else if (entityType === "person") {
        query = `
          SELECT
            pe.person_id,
            pe.sl_person_id,
            pe.sl_flags,
            pe.adoption_count,
            pe.return_count,
            pe.foster_count,
            pe.internal_notes,
            pe.last_synced_at
          FROM trapper.shelterluv_person_ext pe
          WHERE pe.person_id = $1::uuid OR pe.sl_person_id = $1
          LIMIT 1
        `;
      } else {
        return {
          success: false,
          error: `ShelterLuv extension not available for entity type: ${entityType}`,
        };
      }
      break;

    case "clinichq":
      if (entityType === "appointment") {
        query = `
          SELECT
            ae.appointment_id,
            ae.chq_visit_id,
            ae.surgery_notes,
            ae.recovery_notes,
            ae.vet_comments,
            ae.pre_op_notes,
            ae.discharge_notes,
            ae.complications,
            ae.weight_kg,
            ae.temperature_f,
            ae.vaccinations_given,
            ae.last_synced_at
          FROM trapper.clinichq_appointment_ext ae
          WHERE ae.appointment_id = $1::uuid OR ae.chq_visit_id = $1
          LIMIT 1
        `;
      } else if (entityType === "cat") {
        query = `
          SELECT
            ce.cat_id,
            ce.chq_animal_id,
            ce.weight_history,
            ce.medical_alerts,
            ce.last_synced_at
          FROM trapper.clinichq_cat_ext ce
          WHERE ce.cat_id = $1::uuid OR ce.chq_animal_id = $1
          LIMIT 1
        `;
      } else {
        return {
          success: false,
          error: `ClinicHQ extension not available for entity type: ${entityType}`,
        };
      }
      break;

    case "petlink":
      if (entityType === "cat") {
        query = `
          SELECT
            ci.cat_id,
            ci.id_value as petlink_pet_id,
            ci.created_at as registration_date,
            ci.source_system
          FROM trapper.cat_identifiers ci
          WHERE ci.id_type = 'petlink_pet_id'
            AND (ci.cat_id = $1::uuid OR ci.id_value = $1)
          LIMIT 1
        `;
      } else {
        return {
          success: false,
          error: `PetLink extension not available for entity type: ${entityType}`,
        };
      }
      break;

    default:
      return {
        success: false,
        error: `Unknown source: ${source}`,
      };
  }

  params = [entityId];

  try {
    const result = await queryOne<Record<string, unknown>>(query, params);

    if (!result) {
      return {
        success: true,
        data: {
          found: false,
          message: `No ${source} extension data found for ${entityType} "${entityId}"`,
          note: "Extension table may not exist yet or no data for this entity",
        },
      };
    }

    return {
      success: true,
      data: {
        found: true,
        source,
        entity_type: entityType,
        extension_data: result,
      },
    };
  } catch (error) {
    // Extension table may not exist yet
    return {
      success: true,
      data: {
        found: false,
        message: `Extension table for ${source} ${entityType} not available`,
        note: "This extension table may be created in a future migration",
      },
    };
  }
}
