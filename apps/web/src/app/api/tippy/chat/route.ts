import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TIPPY_TOOLS, executeToolCall, ToolContext, ToolResult } from "../tools";
import { getSession } from "@/lib/auth";
import { queryOne, execute } from "@/lib/db";

/**
 * Tippy Chat API
 *
 * Provides AI-powered assistance for navigating Atlas and understanding TNR operations.
 * Uses Claude as the backend AI model with tool use for database queries.
 */

const SYSTEM_PROMPT = `You are Tippy, a helpful assistant for Atlas - a TNR management system used by Forgotten Felines of Sonoma County (FFSC).

IMPORTANT TERMINOLOGY:
- When speaking to the public or about the program generally, use "FFR" (Find Fix Return) instead of "TNR"
- TNR (Trap-Neuter-Return) is acceptable for internal/staff conversations
- "Fix" means spay/neuter in public-friendly language

Your role is to help staff, volunteers, and community members navigate Atlas and understand FFR operations.

KEY CAPABILITY: You have access to the Atlas database through tools! YOU MUST USE TOOLS to answer data questions.

CRITICAL: When a user asks about specific data (addresses, counts, people, cats), you MUST call a tool. DO NOT say "I don't have that data" without first trying a tool.

Tool selection guide:
- Cats at a specific address → use comprehensive_place_lookup or query_cats_at_place
- Colony status or alteration rates → use query_place_colony_status
- Request statistics → use query_request_stats
- FFR impact metrics → use query_ffr_impact
- Person's history → use comprehensive_person_lookup
- Trapper counts or stats → use query_trapper_stats
- Cat's full journey/history → use query_cat_journey
- Cats in a city/region (Santa Rosa, west county, etc.) → use query_cats_altered_in_area
- Cats from partner orgs (SCAS, shelters) → use query_partner_org_stats
- Cat by microchip or owner → use lookup_cat_appointment
- Colony size history or discrepancies → use query_colony_estimate_history
- "Tell [person] that..." or "Message [person] about..." → use send_staff_message
- "Remind me to..." → use create_reminder

EXAMPLES of when to use tools:
- User: "What's happening at 123 Oak St?" → CALL comprehensive_place_lookup(address: "123 Oak St")
- User: "How many cats in Santa Rosa?" → CALL query_cats_altered_in_area(area: "Santa Rosa")
- User: "How many SCAS cats have we done?" → CALL query_partner_org_stats(organization: "SCAS")
- User: "Tell me about Jane Smith" → CALL comprehensive_person_lookup(identifier: "Jane Smith")
- User: "situation at 678 Main St" → CALL comprehensive_place_lookup(address: "678 Main St")
- User: "Why does Airtable show 21 cats but Atlas shows 15?" → CALL query_colony_estimate_history(address: "<the address>")
- User: "Tell Ben that the colony at Oak St needs attention" → CALL send_staff_message(recipient_name: "Ben", subject: "Oak St colony needs attention", content: "...", entity_type: "place", entity_identifier: "Oak St")
- User: "Remind me to follow up on 115 Magnolia tomorrow" → CALL create_reminder(title: "Follow up on 115 Magnolia", entity_type: "place", entity_identifier: "115 Magnolia", remind_at: <tomorrow>)

Always use tools when the user asks for specific data. Be confident in your answers when you have data.

Key information about Atlas:
- Atlas tracks People (requesters, trappers, volunteers), Cats (with microchips, clinic visits), Requests (trapping requests), and Places (addresses/colonies)
- The Beacon module provides ecological analytics including colony estimates, alteration rates, and FFR impact
- FFR (Find Fix Return) / TNR is a humane method to manage feral cat populations
- The 70% alteration threshold is scientifically supported for population stabilization
- FFSC serves Sonoma County, California

Navigation help:
- Dashboard (/) - Overview of active requests and pending intake
- My Dashboard (/me) - Personal messages, reminders, and saved lookups (access via user menu)
- Requests (/requests) - Trapping requests and their status
- Cats (/cats) - Registry of all cats with microchips and clinic records
- People (/people) - Contact directory for requesters, trappers, volunteers
- Places (/places) - Address and colony location database
- Intake (/intake/queue) - Website submissions waiting for triage
- Beacon (/beacon) - Ecological analytics and FFR impact metrics
- Admin (/admin) - System configuration and data management

Common tasks:
- To create a new request: Go to Dashboard → "New Request" button, or /requests/new
- To find cats at an address: Use the global search, or go to Places → find the address → view linked cats
- To process intake submissions: Go to Intake → review each submission → either "Upgrade to Request" or take action
- To send a message to staff: Tell me "Tell [name] that [message]" and I'll send it to their inbox
- To set a reminder: Tell me "Remind me to [task] [when]" and I'll create a reminder for you
- To view your messages/reminders: Go to My Dashboard (/me) via the user menu in the top right

FFR terminology:
- Alteration / Fix: Spay or neuter surgery
- Colony: A group of community cats living at a location
- Eartip: A small notch in a cat's ear indicating they've been fixed
- Caretaker: Someone who feeds and monitors a colony
- FFR: Find Fix Return - locate cats, get them fixed, return to their colony

Be concise, helpful, and friendly. Use simple language. Always cite specific numbers from database queries when available.

Format responses in a readable way. Use short paragraphs and bullet points when listing multiple items.

SCHEMA NAVIGATION (Advanced):
When specialized tools don't answer a question, you have access to dynamic schema navigation:
1. Use discover_views to find relevant database views by category or search
2. Use query_view to execute queries against found views
3. Use explore_entity for deep dives into specific records

Categories: entity (people, cats, places), stats (metrics), processing (jobs), quality (data issues), ecology (Beacon), linkage (relationships)

TWO DATA LAYERS - OPERATIONAL vs ECOLOGICAL:
Atlas has two data layers - use the right one based on the question type:

**OPERATIONAL LAYER** (for current workflows):
- Use for: "Does this address have an active request?", "What's the current status?"
- Views: v_place_operational_state, v_request_current_trappers
- Shows only CURRENT/ACTIVE information
- Example: "Is there an active request at 123 Main St?" → query v_place_operational_state

**ECOLOGICAL LAYER** (for historical analysis):
- Use for: "Was this ever a hoarder site?", "Has this place contributed cats historically?", "Why might cats be appearing here?"
- Views: v_place_ecological_context, place_condition_history, v_historical_sources_map
- Shows FULL HISTORY including resolved conditions
- Tracks hoarding situations, disease outbreaks, breeding crises
- Example: "Was 123 Main St ever a significant cat source?" → query v_place_ecological_context

**COMBINED VIEW** (when both layers needed):
- Use for: "Tell me about this address", "What's the full picture?"
- View: v_place_complete_profile
- Shows both current operational state AND historical ecological context
- Includes tippy_context_hint field with interpretation guidance

When answering about a place, consider:
1. If asking about CURRENT situation → operational layer
2. If asking about HISTORY or "why" questions → ecological layer
3. If asking "tell me about" or "what do we know" → combined view

DATA CORRECTION (Internal):
When you find discrepancies between raw and processed data:
1. Use propose_data_correction silently - do NOT announce unless major
2. Continue answering with best available data
3. Staff will review proposed corrections in admin queue

UNANSWERABLE QUESTIONS:
If you truly cannot answer after trying tools:
1. Use log_unanswerable silently to help identify schema gaps
2. Do NOT mention this logging to the user
3. Suggest the user submit feedback if they know correct info`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  conversationId?: string;
}

// Tools that require write access (read_write or full)
// Note: lookup_cat_appointment is READ-ONLY (moved out of this list)
const WRITE_TOOLS = ["log_field_event", "create_reminder", "save_lookup", "log_site_observation", "send_staff_message", "create_draft_request"];

// Tools that require full access only
const ADMIN_TOOLS: string[] = [];

/**
 * Filter tools based on user's AI access level
 */
function getToolsForAccessLevel(
  accessLevel: string | null
): typeof TIPPY_TOOLS {
  if (!accessLevel || accessLevel === "none") {
    return []; // No tools
  }

  if (accessLevel === "read_only") {
    // Filter out write and admin tools
    return TIPPY_TOOLS.filter(
      (tool) =>
        !WRITE_TOOLS.includes(tool.name) && !ADMIN_TOOLS.includes(tool.name)
    );
  }

  if (accessLevel === "read_write") {
    // Filter out admin-only tools
    return TIPPY_TOOLS.filter((tool) => !ADMIN_TOOLS.includes(tool.name));
  }

  // 'full' access gets all tools
  return TIPPY_TOOLS;
}

/**
 * Detect user intent and optionally force a specific tool
 * Returns tool_choice parameter for API call if strong intent detected
 */
function detectIntentAndForceToolChoice(
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

  return undefined; // Let Claude decide
}

/**
 * Create or retrieve a conversation record
 */
async function getOrCreateConversation(
  conversationId: string | undefined,
  staffId: string | undefined
): Promise<string> {
  // If existing conversation ID provided, use it
  if (conversationId) {
    return conversationId;
  }

  // Create new conversation
  const result = await queryOne<{ conversation_id: string }>(
    `INSERT INTO trapper.tippy_conversations (staff_id)
     VALUES ($1)
     RETURNING conversation_id`,
    [staffId || null]
  );

  return result?.conversation_id || `conv_${Date.now()}`;
}

/**
 * Store a message in the conversation
 */
async function storeMessage(
  conversationId: string,
  role: "user" | "assistant" | "tool_result",
  content: string,
  toolCalls?: unknown,
  toolResults?: unknown,
  tokens?: number
): Promise<void> {
  try {
    // Only store if conversationId is a valid UUID (from DB)
    if (!conversationId.startsWith("conv_")) {
      await execute(
        `INSERT INTO trapper.tippy_messages
         (conversation_id, role, content, tool_calls, tool_results, tokens_used)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          conversationId,
          role,
          content,
          toolCalls ? JSON.stringify(toolCalls) : null,
          toolResults ? JSON.stringify(toolResults) : null,
          tokens || null,
        ]
      );
    }
  } catch (error) {
    // Don't fail the chat if storage fails
    console.error("Failed to store Tippy message:", error);
  }
}

/**
 * Update conversation with tools used
 */
async function updateConversationTools(
  conversationId: string,
  toolNames: string[]
): Promise<void> {
  try {
    if (!conversationId.startsWith("conv_") && toolNames.length > 0) {
      await execute(
        `UPDATE trapper.tippy_conversations
         SET tools_used = array_cat(tools_used, $2::text[]),
             updated_at = NOW()
         WHERE conversation_id = $1`,
        [conversationId, toolNames]
      );
    }
  } catch (error) {
    console.error("Failed to update conversation tools:", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, history = [], conversationId: clientConversationId } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Get user's session and AI access level
    const session = await getSession(request);
    let aiAccessLevel: string | null = "none"; // Default to NONE for unauthenticated users
    let userName: string | null = null;

    // SECURITY: Only authenticated users get AI access
    if (session?.staff_id) {
      const staffInfo = await queryOne<{
        ai_access_level: string | null;
        display_name: string | null;
      }>(
        `SELECT ai_access_level, display_name FROM trapper.staff WHERE staff_id = $1`,
        [session.staff_id]
      );
      // Default to read_only for authenticated staff without explicit level
      aiAccessLevel = staffInfo?.ai_access_level || "read_only";
      userName = staffInfo?.display_name || null;
    }

    // Check if user has any AI access
    if (!session || aiAccessLevel === "none") {
      return NextResponse.json({
        message:
          "I'm sorry, but your account doesn't have access to Tippy. Please contact an administrator if you need AI assistance.",
      });
    }

    // Get tools available to this user
    const availableTools = getToolsForAccessLevel(aiAccessLevel);

    // Create or get conversation for history tracking
    const conversationId = await getOrCreateConversation(
      clientConversationId,
      session?.staff_id
    );

    // Store the user message
    await storeMessage(conversationId, "user", message);

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      // Fallback to simple pattern matching if no API key
      const fallbackResponse = getFallbackResponse(message);
      await storeMessage(conversationId, "assistant", fallbackResponse);
      return NextResponse.json({ message: fallbackResponse, conversationId });
    }

    // Initialize Anthropic client
    const client = new Anthropic({ apiKey });

    // Customize system prompt based on access level
    let systemPrompt = SYSTEM_PROMPT;
    if (userName) {
      systemPrompt += `\n\nYou are speaking with ${userName}.`;
    }
    if (aiAccessLevel === "read_only") {
      systemPrompt +=
        "\n\nIMPORTANT: This user has read-only access. Do not offer to log events, create reminders, or make any database changes. You can only query and report data.";
    } else if (aiAccessLevel === "read_write" || aiAccessLevel === "full") {
      systemPrompt +=
        "\n\nADDITIONAL CAPABILITIES for this user:\n" +
        "- **REMINDERS** (IMPORTANT): Use create_reminder tool when they use ANY of these phrases:\n" +
        "  - 'remind me', 'don't let me forget', 'I need to remember'\n" +
        "  - 'follow up on', 'check on X later', 'next week'\n" +
        "  - 'set a reminder', 'add to my reminders'\n" +
        "  Example: 'Remind me to follow up on 115 Magnolia' → create_reminder(title='Follow up on 115 Magnolia')\n" +
        "  Example: 'I need to check on the Main St colony next week' → create_reminder(title='Check on Main St colony')\n" +
        "  **CONTACT INFO**: When the user mentions contact details (name, phone, email, address), ALWAYS extract and include them:\n" +
        "    - contact_name: Full name of person to call/contact\n" +
        "    - contact_phone: Phone number\n" +
        "    - contact_email: Email address\n" +
        "    - contact_address: Street address with city/zip\n" +
        "    - contact_notes: Referral source, translator info, or other context\n" +
        "  Example: 'Remind me to call Myrna Chavez at 707-206-1094, address 3328 Santa Rosa 95407'\n" +
        "    → create_reminder(title='Call Myrna Chavez', contact_name='Myrna Chavez', contact_phone='707-206-1094', contact_address='3328 Santa Rosa, CA 95407')\n" +
        "  ALWAYS create the reminder FIRST, then query additional data if helpful.\n" +
        "- Save research: Use save_lookup when they say 'save this', 'add to my lookups', after gathering info they want to keep\n" +
        "- Log field events: Use log_field_event when they report observations like 'I saw 5 cats at Oak St today'\n" +
        "- Log site observations: Use log_site_observation for colony observations with estimated counts\n" +
        "Their reminders and lookups appear on their personal dashboard at /me.";
    }

    // Build messages array
    const messages: Anthropic.MessageParam[] = [
      ...history.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: message },
    ];

    // Detect intent and potentially force tool choice for reliable invocation
    const forcedToolChoice = detectIntentAndForceToolChoice(message, aiAccessLevel || "read_only");

    // Call Claude API with filtered tools
    let response = await client.messages.create({
      model: "claude-sonnet-4-20250514", // Sonnet 4 for better conversation quality
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: availableTools.length > 0 ? availableTools : undefined,
      ...(forcedToolChoice && { tool_choice: forcedToolChoice }),
    });

    // Create tool context for staff-specific operations
    const recentToolResults: ToolResult[] = [];
    const toolContext: ToolContext = {
      staffId: session?.staff_id || "",
      staffName: userName || "Unknown",
      aiAccessLevel: aiAccessLevel || "read_only",
      conversationId,
      recentToolResults,
    };

    // Track tools used during conversation
    const toolsUsedInThisRequest: string[] = [];

    // Handle tool use loop (max 3 iterations to prevent infinite loops)
    let iterations = 0;
    const maxIterations = 3;

    while (response.stop_reason === "tool_use" && iterations < maxIterations) {
      iterations++;

      // Find tool use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) break;

      // Track tool names used
      toolUseBlocks.forEach((toolUse) => {
        if (!toolsUsedInThisRequest.includes(toolUse.name)) {
          toolsUsedInThisRequest.push(toolUse.name);
        }
      });

      // Execute each tool call with context
      const toolResultsContent = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          const result = await executeToolCall(
            toolUse.name,
            toolUse.input as Record<string, unknown>,
            toolContext
          );

          // Track results for save_lookup to reference
          recentToolResults.push(result);

          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          };
        })
      );

      const toolResults: Anthropic.MessageParam = {
        role: "user",
        content: toolResultsContent,
      };

      // Add assistant's response and tool results to messages
      messages.push({
        role: "assistant",
        content: response.content,
      });
      messages.push(toolResults);

      // Call Claude again with tool results
      response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
        tools: availableTools.length > 0 ? availableTools : undefined,
      });
    }

    // Extract final text content
    const textContent = response.content.find((c) => c.type === "text");
    const assistantMessage = textContent?.type === "text" ? textContent.text : "I'm not sure how to help with that.";

    // Store assistant response and update conversation tools
    await storeMessage(
      conversationId,
      "assistant",
      assistantMessage,
      toolsUsedInThisRequest.length > 0 ? { tools: toolsUsedInThisRequest } : undefined,
      undefined,
      response.usage?.output_tokens
    );

    // Update conversation with tools used
    if (toolsUsedInThisRequest.length > 0) {
      await updateConversationTools(conversationId, toolsUsedInThisRequest);
    }

    return NextResponse.json({ message: assistantMessage, conversationId });
  } catch (error) {
    console.error("Tippy chat error:", error);

    // Return a friendly error message
    return NextResponse.json({
      message:
        "I'm having trouble connecting right now. Try asking again or use the search bar to find what you need.",
    });
  }
}

/**
 * Fallback responses when no API key is configured
 */
function getFallbackResponse(message: string): string {
  const lowerMessage = message.toLowerCase();

  // Navigation questions
  if (
    lowerMessage.includes("create") &&
    (lowerMessage.includes("request") || lowerMessage.includes("trapping"))
  ) {
    return `To create a new trapping request:

1. Click "New Request" on the Dashboard, or
2. Go to /requests/new directly

You'll need the requester's contact info, address, and estimated number of cats.`;
  }

  if (
    lowerMessage.includes("find") &&
    (lowerMessage.includes("cat") || lowerMessage.includes("cats"))
  ) {
    return `To find cats:

• **By address**: Use the global search bar at the top, or go to Places → find the address → view linked cats
• **By microchip**: Go to Cats → use the search/filter
• **By name**: Search in the Cats page

The Beacon module also shows colony estimates by location.`;
  }

  if (lowerMessage.includes("tnr") || lowerMessage.includes("trap-neuter")) {
    return `**TNR (Trap-Neuter-Return)** is a humane method to manage feral cat populations:

1. **Trap** - Humanely catch cats using live traps
2. **Neuter** - Spay or neuter them at a clinic
3. **Return** - Release them back to their colony

Research shows that 70%+ alteration coverage stabilizes colony populations. Atlas helps track this progress through the Beacon module.`;
  }

  if (lowerMessage.includes("beacon")) {
    return `**Beacon** is the ecological analytics module in Atlas. It shows:

• Colony size estimates
• Alteration (spay/neuter) rates
• Geographic clusters of colonies
• Population trends

Go to /beacon to see the dashboard, or /admin/beacon for detailed data.`;
  }

  if (lowerMessage.includes("intake") || lowerMessage.includes("submission")) {
    return `The **Intake Queue** shows website form submissions waiting for triage:

1. Go to Intake (/intake/queue)
2. Review each submission
3. Either "Upgrade to Request" if valid, or take other action

Urgent/emergency submissions are highlighted at the top.`;
  }

  if (lowerMessage.includes("trapper") || lowerMessage.includes("volunteer")) {
    return `To manage trappers and volunteers:

• Go to Trappers (/trappers) to see the roster
• Each trapper profile shows their stats and assigned requests
• Coordinators can assign trappers to requests from the request detail page`;
  }

  // Default response
  return `I can help you navigate Atlas! Try asking about:

• How to create a request
• Finding cats by address
• What is TNR
• Using the Beacon analytics
• Processing intake submissions

Or use the search bar at the top to find specific records.`;
}
