/**
 * Tippy Tool Routing — Pure functions for intent detection and access control
 *
 * Extracted from route.ts (FFS-802) to enable unit testing.
 * These functions have zero runtime dependencies (no DB, no auth, no route context).
 */

// Tools that modify data (require read_write or full access)
export const WRITE_TOOLS = [
  "log_field_event",
  "create_reminder",
  "save_lookup",
  "log_site_observation",
  "send_staff_message",
  "create_draft_request",
  "flag_anomaly",
  "update_request",
];

// Tools that require full access only (admin/engineer level)
// TEMPORARY: run_sql available to all users for presentation demo
export const ADMIN_TOOLS: string[] = []; // ["run_sql"] - temporarily disabled restriction

/**
 * Filter tools based on user's AI access level.
 * Returns the subset of tools the user is allowed to invoke.
 */
export function getToolsForAccessLevel<T extends { name: string }>(
  tools: T[],
  accessLevel: string | null
): T[] {
  if (!accessLevel || accessLevel === "none") {
    return [];
  }

  if (accessLevel === "read_only") {
    return tools.filter(
      (tool) =>
        !WRITE_TOOLS.includes(tool.name) && !ADMIN_TOOLS.includes(tool.name)
    );
  }

  if (accessLevel === "read_write") {
    return tools.filter((tool) => !ADMIN_TOOLS.includes(tool.name));
  }

  // 'full' access gets all tools
  return tools;
}

/**
 * Detect user intent and optionally force a specific tool.
 * Returns tool_choice parameter for API call if strong intent detected.
 *
 * Pure function — only depends on message text and access level.
 */
export function detectIntentAndForceToolChoice(
  message: string,
  accessLevel: string
): { type: "auto" } | { type: "tool"; name: string } | undefined {
  const lower = message.toLowerCase();

  // REMINDER patterns - highest priority for write users
  if (accessLevel === "read_write" || accessLevel === "full") {
    const reminderPatterns = [
      /remind me/i,
      /don't let me forget/i,
      /i need to remember/i,
      /set a reminder/i,
      /add.*reminder/i,
      /follow up on.*(?:later|tomorrow|next|week)/i,
      /check on.*(?:later|tomorrow|next|week)/i,
    ];
    if (reminderPatterns.some((p) => p.test(message))) {
      return { type: "tool", name: "create_reminder" };
    }

    // MESSAGE patterns - "tell X that...", "message X about..."
    if (/^(tell|message|let)\s+\w+\s+(that|about|know)/i.test(lower)) {
      return { type: "tool", name: "send_staff_message" };
    }
  }

  // STAFF patterns (must check before trapper to avoid "staff" being confused with trappers)
  if (
    /how many\s+staff/i.test(lower) ||
    /staff\s+(count|list|members?|info)/i.test(lower) ||
    /who\s+(are|is)\s+(our|the)\s+staff/i.test(lower) ||
    /list\s+(of\s+)?staff/i.test(lower)
  ) {
    return { type: "tool", name: "query_staff_info" };
  }

  // TRAPPER stats patterns
  if (
    /how many.*(trappers?|volunteers?)/i.test(lower) ||
    /active trappers/i.test(lower) ||
    /trapper (stats|count|numbers)/i.test(lower)
  ) {
    return { type: "tool", name: "query_trapper_stats" };
  }

  // PARTNER ORG patterns (SCAS, shelter, etc.)
  if (
    /how many.*(scas|shelter|humane)/i.test(lower) ||
    /scas (cats?|stats)/i.test(lower)
  ) {
    return { type: "tool", name: "query_partner_org_stats" };
  }

  // FFS-744: Cat description search patterns
  const catDescriptionPatterns = [
    /(?:find|search|look for|any|where is|seen)\s+(?:the\s+)?(?:an?\s+)?(?:orange|black|white|gray|grey|calico|tortoiseshell|tabby|tuxedo|siamese|ginger)\s+(?:cat|kitten|tabby)/i,
    /(?:orange|black|white|gray|grey|calico|tortoiseshell|tabby|tuxedo|siamese|ginger)\s+(?:cat|kitten)\s+(?:at|on|near|around)/i,
    /cat\s+(?:that\s+)?(?:looks?|described|with)\s+(?:like\s+)?(?:an?\s+)?(?:orange|black|white|gray|grey|calico)/i,
  ];
  if (catDescriptionPatterns.some(p => p.test(message))) {
    return { type: "tool", name: "search_cats_by_description" };
  }

  // ADDRESS / PLACE patterns — force analyze_place_situation for address queries
  const addressPattern =
    /\d+\s+[\w]+(?: [\w]+)?\s*(?:st|street|ave|avenue|rd|road|dr|drive|ct|court|ln|lane|way|blvd|boulevard|pl|place|cir|circle)\b/i;
  if (addressPattern.test(message)) {
    const placeQueryPattern =
      /(?:what(?:'s| do we| is)|tell me|situation|anything|know about|activity|info|cats? at|colony|look ?up|going on)/i;
    if (placeQueryPattern.test(lower)) {
      return { type: "tool", name: "analyze_place_situation" };
    }
  }

  return undefined; // Let Claude decide
}

/**
 * Detect "strategic" intent — questions about resource allocation,
 * priority, where to focus, etc. PR 5 (FFS-1163).
 *
 * This is NOT a tool-forcing classifier — strategic queries need
 * multiple tools and reasoning. Instead, it's a signal the chat route
 * uses to inject extra system-prompt guidance: "be humble when data
 * is sparse, prefer find_intact_cat_clusters, exclude in-progress
 * requests, never recommend a place from a NULL-dominated rate".
 *
 * Returns true if the question is about strategy/priority/where-to-focus.
 * False otherwise. Conservative — false positives would over-restrict
 * the model on questions that don't need humility framing.
 */
export function detectStrategicIntent(message: string): boolean {
  const lower = message.toLowerCase();

  const strategicPatterns: RegExp[] = [
    // "where should we focus / target"
    /\bwhere\s+(?:should|do)\s+(?:we|i)\s+(?:focus|target|prioriti[sz]e|put|spend)/,
    // "which areas need [more] / most"
    /\bwhich\s+(?:areas?|cities|places?|colonies)\s+(?:need|should|are)/,
    // "what should we do / target / focus on"
    /\bwhat\s+should\s+we\s+(?:do|target|focus|priorit)/,
    // "priority area" / "priorities"
    /\bpriorit(?:y|ies)\s+(?:area|target|place|location|colony|cit)/,
    /\b(?:highest|top|most)\s+priorit/,
    // "needs the most help / attention / TNR / intervention"
    // Allow an optional adjective between "most/more" and the target noun:
    //   "needs more help" / "needs more targeted intervention"
    /\bneeds?\s+(?:the\s+)?(?:most|more|urgent|immediate|targeted)\s+(?:\w+\s+)?(?:help|attention|tnr|ffr|trapping|intervention|work)/,
    // "worst cat problem / area"
    /\bworst\s+(?:cat\s+)?(?:problem|area|cit|colony)/,
    // "where are the [intact|unfixed|unaltered] cats"
    /\bwhere\s+are\s+(?:the|all)\s+(?:intact|unfixed|unaltered)/,
    // "underserved" / "under-served"
    /\bunder.?served/,
    // "resource allocation"
    /\bresource\s+allocation/,
  ];

  return strategicPatterns.some((p) => p.test(lower));
}
