import { NextRequest } from "next/server";
import { apiBadRequest, apiSuccess, apiServerError } from "@/lib/api-response";
import Anthropic from "@anthropic-ai/sdk";
import { TIPPY_V2_TOOLS, executeToolCallV2, type ToolContext, type ToolResult } from "../tools-v2";
import { getSession } from "@/lib/auth";
import { queryOne, queryRows, execute } from "@/lib/db";
import { TERMINAL_PAIR_SQL } from "@/lib/request-status";
import {
  WRITE_TOOLS as V2_WRITE_TOOLS,
  ADMIN_TOOLS,
  getToolsForAccessLevel as getToolsForAccessLevelPure,
  detectIntentAndForceToolChoice,
  detectStrategicIntent,
} from "@/lib/tippy-routing";
import { KNOWN_GAPS } from "../knowledge";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIPPY_MODEL =
  (process.env.NODE_ENV !== "production" && process.env.TIPPY_TEST_MODEL) ||
  "claude-sonnet-4-20250514";

export const maxDuration = 300;

const PREFLIGHT_CACHE = new Map<string, { data: string; ts: number }>();
const PREFLIGHT_TTL_MS = 30 * 60 * 1000; // 30 min

const V2_WRITE_TOOLS_SET = new Set(["create_reminder", "send_message", "log_event"]);

const engineerNames = [
  "ben", "daniel", "sophie", "evan", "dominique", "benmisdiaz", "ben misdiaz",
];

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface MapContext {
  center?: { lat: number; lng: number };
  zoom?: number;
  bounds?: { north: number; south: number; east: number; west: number };
  selectedPlace?: { place_id: string; address: string };
  navigatedLocation?: { lat: number; lng: number; address: string };
  drawerOpen?: boolean;
  visiblePinCount?: number;
  lastSearchQuery?: string | null;
}

interface PageContext {
  path: string;
  params?: Record<string, string>;
  mapState?: MapContext | null;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  conversationId?: string;
  pageContext?: PageContext;
  stream?: boolean;
}

interface AgentLoopResult {
  fullText: string;
  toolsUsed: string[];
}

// ---------------------------------------------------------------------------
// System Prompt Builder
// ---------------------------------------------------------------------------

const BASE_PROMPT = `You are Tippy, a helpful assistant for Beacon — a TNR (Trap-Neuter-Return) management system used by Forgotten Felines of Sonoma County (FFSC).

IMPORTANT TERMINOLOGY:
- When speaking to the public, use "FFR" (Find Fix Return) instead of "TNR".
- TNR is acceptable for internal/staff conversations.
- "Fix" means spay/neuter in public-friendly language.

KEY CAPABILITY: You have full database access through 15 tools. USE THEM to answer data questions.

CRITICAL: When a user asks about specific data, you MUST call a tool. DO NOT say "I don't have that data" without first trying.

HUMILITY DEFAULT — FOUR RULES:
1. "I don't know yet" is a premium answer, not a failure.
2. Distinguish what we KNOW from what we don't. meta.rate_among_known is the honest number. null_status_count is "unknown", not "intact".
3. caveats, suspicious_patterns, and known_gaps from tool results are NOT optional. Surface them.
4. When a tool returns found: false, that IS the answer. Don't paper over it.

STAFF vs TRAPPERS:
- Staff = paid FFSC employees. Use trapper_stats with query_type="staff".
- Trappers = volunteers. Use trapper_stats.
- Exception: Crystal Furtado is both.

TOOL SELECTION GUIDE (15 tools):
- Specific address → full_place_briefing (comprehensive data + institutional context)
- Street/road name → place_search FIRST, then full_place_briefing on best match
- City/region → area_stats
- Compare places → compare_places
- Priority sites → find_priority_sites
- Person → person_lookup
- Cat by chip/name → cat_lookup
- Cat by appearance → cat_search
- Request stats → request_stats
- Trapper/staff info → trapper_stats
- Nearby activity → spatial_context
- Any data question → run_sql (full SELECT access)
- "Tell [person] that..." → send_message
- "Remind me to..." → create_reminder
- Log an event/observation → log_event

MULTI-STEP INVESTIGATION PROTOCOL:
After EVERY tool result, ask: Do I have enough? Did I get entity IDs to drill into? Are there cross-system sources unchecked?
RULE: One tool is almost never enough for place/person/cat questions.
RULE: Use parallel tool calls for independent operations.

BRIEFING STRUCTURE (for place queries):
1. Opening: One sentence — what is this place, who manages it, current status
2. The story: 2-3 sentences of what happened (names, events, timeline)
3. Current status: rate_among_known, active requests, recent appointments, data quality inline
4. What to watch: One next step or concern
5. One follow-up offer

ANTI-PATTERN: Don't structure response as tool result headers. Write paragraphs.

ENTITY LINKS — always link when you have UUIDs:
- Places: [address](/places/UUID)
- Cats: [name](/cats/UUID)
- People: [name](/people/UUID)
- Requests: [Request #](/requests/UUID)

DATA QUALITY:
- NULL altered_status = unknown, NOT intact
- PetLink emails (confidence < 0.5) are fabricated
- Shared phones can cross-link households
- Our data = what we've DISCOVERED, not what EXISTS
- High rates + low requests = limited data, not success

NARRATIVE SYNTHESIS (when narrative_seed present in tool results):
- Lead with headline
- Use key_people names, never "a contact"
- Resolve data_conflicts in prose
- Surface recommended_actions
- End with one suggested_followup

COMMUNICATION STYLE:
Tell the story. Lead with insight. Explain what numbers mean. Connect the dots. Every response needs a "so what".

NAVIGATION:
- Dashboard (/) - Overview
- Requests (/requests) - Trapping requests
- Cats (/cats) - Cat registry
- People (/people) - Contact directory
- Places (/places) - Location database
- Intake (/intake/queue) - Submissions
- Beacon (/beacon) - Analytics
- My Dashboard (/me) - Messages, reminders

DATABASE SCHEMA:
Core: sot.places, sot.cats, sot.people, sot.addresses
Relationships: sot.cat_place, sot.person_place, sot.person_cat
Identity: sot.person_identifiers (confidence >= 0.5!), ops.clinic_accounts
Operational: ops.requests, ops.appointments, ops.staff
Lifecycle: sot.cat_lifecycle_events, sot.v_adoption_context
Key columns: altered_status (spayed/neutered/altered/intact/NULL), merged_into_*_id IS NULL, location (PostGIS)
Matviews: ops.mv_city_stats, ops.mv_zip_coverage, ops.mv_ffr_impact_summary`;

function buildEngineerBlock(): string {
  return `\n\n**COMMUNICATION STYLE — ENGINEER:**\nBe direct and technical. Lead with data. Reference table names. Mention data quality issues explicitly. Skip narrative fluff.`;
}

function buildStaffBlock(): string {
  return `\n\n**COMMUNICATION STYLE — STAFF:**\nYour audience: TNR experts who understand the work but haven't used digital systems.\nRULES: Use formatting sparingly. Be informational. Matter-of-fact tone (no "amazing!", "impressive!"). Sound natural. Honest about limitations. Skeptical of high rates with low activity. Requests ≠ all TNR work.`;
}

function buildAccessBlock(level: string): string {
  if (level === "read_only")
    return "\n\nThis user has read-only access. Do not offer write operations.";
  if (level === "read_write" || level === "full")
    return `\n\nADDITIONAL CAPABILITIES:
- create_reminder for "remind me", "follow up", etc. Extract contact info.
- send_message for "tell X that..."
- log_event for field observations, draft requests, anomalies
- Reminders and lookups appear at /me.`;
  return "";
}

function buildPageContextBlock(page: PageContext): string {
  let s = "";
  if (/^\/requests\/[0-9a-f-]{36}$/i.test(page.path)) {
    const uuid = page.path.split("/").pop();
    s += `\n\nREQUEST CONTEXT: User viewing request ${uuid}. Use log_event with action_type="update_request" and request_id="${uuid}" for updates. Confirm with user first.`;
  }
  if (page.path === "/map" && page.mapState) {
    const m = page.mapState;
    s += "\n\nMAP CONTEXT: User is on the Beacon Map.";
    if (m.center) s += `\n- Center: ${m.center.lat.toFixed(5)}, ${m.center.lng.toFixed(5)}`;
    if (m.selectedPlace) s += `\n- Selected: ${m.selectedPlace.address} (${m.selectedPlace.place_id})`;
    if (m.navigatedLocation) s += `\n- Navigated to: ${m.navigatedLocation.address}`;
    if (m.visiblePinCount != null) s += `\n- Visible pins: ${m.visiblePinCount}`;
  }
  if (page.path === "/" || page.path === "/dashboard") {
    s += "\n\nUser is on the dashboard. Offer shift briefing if morning, or overview stats.";
  }
  return s;
}

function buildStrategicBlock(): string {
  return `\n\nSTRATEGIC QUERY MODE:
1. Call find_priority_sites first — returns confirmed-intact cats with no active request.
2. Empty result = real answer. Say so honestly.
3. Never recommend a place with active request.
4. Prefer rate_among_known over rate_overall.
5. Default to humility — "I can't recommend confidently" beats a wrong list.`;
}

function buildOnboardingBlock(): string {
  return `\n\nONBOARDING: New user. Define TNR terminology on first use. Include page links. Offer walkthroughs. Be detailed but not overwhelming.`;
}

function buildSystemPrompt(params: {
  userName: string | null;
  isEngineer: boolean;
  accessLevel: string;
  pageContext?: PageContext;
  preflightContext?: string;
  memoryContext?: string | null;
  isNewUser?: boolean;
  isStrategicQuery?: boolean;
}): string {
  let prompt = BASE_PROMPT;

  if (params.userName) prompt += `\n\nYou are speaking with ${params.userName}.`;
  prompt += params.isEngineer ? buildEngineerBlock() : buildStaffBlock();
  prompt += buildAccessBlock(params.accessLevel);
  if (params.pageContext) prompt += buildPageContextBlock(params.pageContext);
  if (params.preflightContext) prompt += params.preflightContext;
  if (params.isNewUser) prompt += buildOnboardingBlock();
  if (params.memoryContext) prompt += "\n\n" + params.memoryContext;
  if (params.isStrategicQuery) prompt += buildStrategicBlock();

  return prompt;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

async function getOrCreateConversation(
  conversationId: string | undefined,
  staffId: string | null
): Promise<string> {
  if (conversationId) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM ops.tippy_conversations WHERE id = $1`,
      [conversationId]
    );
    if (existing) return existing.id;
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO ops.tippy_conversations (staff_id, started_at)
     VALUES ($1, NOW())
     RETURNING id`,
    [staffId]
  );

  // Fire-and-forget summary generation for previous conversations
  if (staffId) {
    generateConversationSummary(staffId).catch(() => {});
  }

  return row!.id;
}

async function buildPreflightContext(conversationId: string): Promise<string> {
  const cached = PREFLIGHT_CACHE.get(conversationId);
  if (cached && Date.now() - cached.ts < PREFLIGHT_TTL_MS) return cached.data;

  const sections: string[] = [];

  try {
    // Data quality alerts
    const alerts = await queryRows<{ alert_type: string; message: string }>(
      `SELECT alert_type, message FROM ops.v_data_quality_alerts
       WHERE severity >= 2 ORDER BY severity DESC LIMIT 5`
    );
    if (alerts.length > 0) {
      sections.push(
        "DATA QUALITY ALERTS:\n" +
          alerts.map((a) => `- [${a.alert_type}] ${a.message}`).join("\n")
      );
    }

    // Entity linking health
    const health = await queryOne<{
      clinic_leakage: number;
      cat_place_coverage: number;
    }>(`SELECT * FROM ops.check_entity_linking_health()`);
    if (health && health.clinic_leakage > 0) {
      sections.push(`LINKING HEALTH: clinic_leakage=${health.clinic_leakage} (should be 0)`);
    }

    // Latest batch freshness
    const batch = await queryOne<{ hours_ago: number }>(
      `SELECT EXTRACT(EPOCH FROM NOW() - MAX(created_at)) / 3600 AS hours_ago
       FROM ops.file_uploads WHERE batch_ready = true`
    );
    if (batch && batch.hours_ago > 72) {
      sections.push(`DATA FRESHNESS: Last batch upload ${Math.round(batch.hours_ago)} hours ago.`);
    }

    // Seasonal phase
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 6) {
      sections.push("SEASONAL: Kitten season active. Expect higher intake volume.");
    } else if (month >= 10 && month <= 12) {
      sections.push("SEASONAL: Pre-winter TNR push. Prioritize outdoor colonies.");
    }

    // Disease counts
    const disease = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sot.v_place_colony_status
       WHERE felv_positive_count > 0 OR fiv_positive_count > 0`
    );
    if (disease && disease.cnt > 0) {
      sections.push(`DISEASE: ${disease.cnt} place(s) with FeLV/FIV-positive cats.`);
    }
  } catch {
    // Non-blocking — preflight is best-effort
  }

  const result =
    sections.length > 0 ? "\n\nSYSTEM PREFLIGHT:\n" + sections.join("\n") : "";

  PREFLIGHT_CACHE.set(conversationId, { data: result, ts: Date.now() });
  return result;
}

async function buildMemoryContext(staffId: string): Promise<string | null> {
  try {
    const memories = await queryRows<{ summary: string; created_at: string }>(
      `SELECT summary, created_at::text FROM ops.tippy_staff_memory
       WHERE staff_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [staffId]
    );
    if (memories.length === 0) return null;
    return (
      "CONVERSATION MEMORY (recent sessions):\n" +
      memories.map((m) => `[${m.created_at}] ${m.summary}`).join("\n")
    );
  } catch {
    return null;
  }
}

async function storeMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  toolCalls?: string[],
  toolResults?: string[],
  tokens?: { input?: number; output?: number }
): Promise<void> {
  try {
    await execute(
      `INSERT INTO ops.tippy_messages
         (conversation_id, role, content, tool_calls, tool_results, input_tokens, output_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        conversationId,
        role,
        content,
        toolCalls ? JSON.stringify(toolCalls) : null,
        toolResults ? JSON.stringify(toolResults) : null,
        tokens?.input ?? null,
        tokens?.output ?? null,
      ]
    );
  } catch {
    // Non-blocking
  }
}

async function updateConversationTools(
  conversationId: string,
  toolNames: string[]
): Promise<void> {
  if (toolNames.length === 0) return;
  try {
    await execute(
      `UPDATE ops.tippy_conversations
       SET tools_used = COALESCE(tools_used, '{}') || $2::text[]
       WHERE id = $1`,
      [conversationId, toolNames]
    );
  } catch {
    // Non-blocking
  }
}

async function generateConversationSummary(staffId: string): Promise<void> {
  try {
    // Find the most recent completed conversation without a summary
    const conv = await queryOne<{ id: string }>(
      `SELECT c.id FROM ops.tippy_conversations c
       LEFT JOIN ops.tippy_staff_memory m ON m.conversation_id = c.id
       WHERE c.staff_id = $1 AND m.id IS NULL
         AND c.started_at < NOW() - INTERVAL '5 minutes'
       ORDER BY c.started_at DESC LIMIT 1`,
      [staffId]
    );
    if (!conv) return;

    const messages = await queryRows<{ role: string; content: string }>(
      `SELECT role, content FROM ops.tippy_messages
       WHERE conversation_id = $1 ORDER BY created_at LIMIT 20`,
      [conv.id]
    );
    if (messages.length < 2) return;

    const client = new Anthropic();
    const transcript = messages
      .map((m) => `${m.role}: ${m.content?.substring(0, 300) || "[tool use]"}`)
      .join("\n");

    const resp = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Summarize this Tippy conversation in 1-2 sentences. Focus on: what was asked, what was found, any action items.\n\n${transcript}`,
        },
      ],
    });

    const summary =
      resp.content[0].type === "text" ? resp.content[0].text : "";
    if (summary) {
      await execute(
        `INSERT INTO ops.tippy_staff_memory (staff_id, conversation_id, summary)
         VALUES ($1, $2, $3)`,
        [staffId, conv.id, summary]
      );
    }
  } catch {
    // Fire-and-forget
  }
}

async function assembleBriefingData(staffId: string): Promise<string> {
  const parts: string[] = [];

  try {
    // Pending requests
    const pending = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ops.requests
       WHERE merged_into_request_id IS NULL
         AND status NOT IN (${TERMINAL_PAIR_SQL})`
    );
    if (pending) parts.push(`**Open requests:** ${pending.cnt}`);

    // Recent appointments
    const appts = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ops.appointments
       WHERE appointment_date >= CURRENT_DATE - INTERVAL '7 days'`
    );
    if (appts) parts.push(`**Appointments (last 7 days):** ${appts.cnt}`);

    // Intake queue
    const intake = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ops.intake_submissions
       WHERE status = 'new'`
    );
    if (intake) parts.push(`**New intake submissions:** ${intake.cnt}`);

    // Staff messages
    const msgs = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ops.staff_messages
       WHERE recipient_id = $1 AND read_at IS NULL`,
      [staffId]
    );
    if (msgs && msgs.cnt > 0) parts.push(`**Unread messages:** ${msgs.cnt}`);

    // Reminders
    const reminders = await queryRows<{ title: string; due_date: string }>(
      `SELECT title, due_date::text FROM ops.staff_reminders
       WHERE staff_id = $1 AND completed_at IS NULL
         AND due_date <= CURRENT_DATE + INTERVAL '1 day'
       ORDER BY due_date LIMIT 5`,
      [staffId]
    );
    if (reminders.length > 0) {
      parts.push(
        "**Due reminders:**\n" +
          reminders.map((r) => `- ${r.title} (${r.due_date})`).join("\n")
      );
    }
  } catch {
    parts.push("(Some briefing data unavailable)");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Agent Loop
// ---------------------------------------------------------------------------

async function runAgentLoop(params: {
  client: Anthropic;
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  availableTools: Anthropic.Tool[];
  forcedToolChoice?: { type: "auto" } | { type: "tool"; name: string };
  maxIterations?: number;
  timeBudgetMs?: number;
  stream?: boolean;
  onStatus?: (event: string, data: Record<string, unknown>) => void;
  toolContext: ToolContext;
}): Promise<AgentLoopResult> {
  const {
    client,
    systemPrompt,
    availableTools,
    forcedToolChoice,
    maxIterations = 6,
    timeBudgetMs = 280_000,
    onStatus,
    toolContext,
  } = params;

  const messages = [...params.messages];
  const toolsUsed: string[] = [];
  let fullText = "";
  const startTime = Date.now();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const elapsed = Date.now() - startTime;
    if (elapsed > timeBudgetMs) {
      // Time budget exceeded — ask for summary
      messages.push({
        role: "user",
        content:
          "[SYSTEM] Time budget exceeded. Summarize what you found so far and respond to the user.",
      });
    }

    // Use tool_choice only on first iteration if forced
    const toolChoice =
      iteration === 0 && forcedToolChoice ? forcedToolChoice : { type: "auto" as const };

    const response = await client.messages.create({
      model: TIPPY_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: availableTools.length > 0 ? availableTools : undefined,
      tool_choice: availableTools.length > 0 ? toolChoice : undefined,
    });

    // Extract text blocks and tool_use blocks
    const textBlocks: string[] = [];
    const toolUseBlocks: Anthropic.ContentBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textBlocks.push(block.text);
        if (onStatus) onStatus("delta", { text: block.text });
      } else if (block.type === "tool_use") {
        toolUseBlocks.push(block);
      }
    }

    fullText += textBlocks.join("");

    // No tool calls — we're done
    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      if (toolUseBlocks.length === 0) break;
    }

    // If we only got text with end_turn, break even if there were tool blocks collected
    if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) break;

    // Execute tool calls in parallel
    if (toolUseBlocks.length > 0) {
      const toolResultContents: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        if (toolBlock.type !== "tool_use") continue;
        const toolName = toolBlock.name;
        const toolInput = toolBlock.input as Record<string, unknown>;
        const toolId = toolBlock.id;

        toolsUsed.push(toolName);
        if (onStatus) onStatus("status", { phase: "tool_call", tool: toolName });

        let result: ToolResult;
        try {
          result = await executeToolCallV2(toolName, toolInput, toolContext);
        } catch (err) {
          result = {
            success: false,
            error: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        if (onStatus)
          onStatus("status", {
            phase: "tool_result",
            tool: toolName,
            success: result.success,
          });

        const resultStr =
          typeof result === "string" ? result : JSON.stringify(result);

        toolResultContents.push({
          type: "tool_result",
          tool_use_id: toolId,
          content: resultStr.substring(0, 50_000), // Truncate large results
        });
      }

      // Append assistant message with tool_use blocks
      messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
      // Append tool results
      messages.push({ role: "user", content: toolResultContents });

      if (onStatus) onStatus("status", { phase: "responding" });
    }

    // If time exceeded after tool execution, break after one more iteration
    if (elapsed > timeBudgetMs) break;
  }

  return { fullText, toolsUsed };
}

// ---------------------------------------------------------------------------
// Streaming Handler
// ---------------------------------------------------------------------------

async function handleStreamingChat(params: {
  client: Anthropic;
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  availableTools: Anthropic.Tool[];
  forcedToolChoice?: { type: "auto" } | { type: "tool"; name: string };
  conversationId: string;
  session: { staff_id?: string } | null;
  userName: string | null;
  aiAccessLevel: string | null;
}): Promise<Response> {
  const {
    client,
    systemPrompt,
    availableTools,
    forcedToolChoice,
    conversationId,
    session,
  } = params;

  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const toolContext: ToolContext = {
          staffId: session?.staff_id || "",
          staffName: params.userName || "Unknown",
          aiAccessLevel: params.aiAccessLevel || "read_only",
          conversationId,
        };

        const messages = [...params.messages];
        const toolsUsed: string[] = [];
        let fullText = "";
        const maxIterations = 6;
        const timeBudgetMs = 280_000;
        const startTime = Date.now();

        for (let iteration = 0; iteration < maxIterations; iteration++) {
          const elapsed = Date.now() - startTime;
          if (elapsed > timeBudgetMs) {
            messages.push({
              role: "user",
              content:
                "[SYSTEM] Time budget exceeded. Summarize what you found so far.",
            });
          }

          const toolChoice =
            iteration === 0 && forcedToolChoice
              ? forcedToolChoice
              : { type: "auto" as const };

          // Stream the response
          const stream = client.messages.stream({
            model: TIPPY_MODEL,
            max_tokens: 4096,
            system: systemPrompt,
            messages,
            tools: availableTools.length > 0 ? availableTools : undefined,
            tool_choice: availableTools.length > 0 ? toolChoice : undefined,
          });

          const toolUseBlocks: Array<{
            id: string;
            name: string;
            input: Record<string, unknown>;
          }> = [];

          let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
          let iterationText = "";
          let stopReason: string | null = null;
          const contentBlocks: Anthropic.ContentBlock[] = [];

          // Collect streamed events using for-await pattern (matching V1)
          for await (const event of stream) {
            if (event.type === "content_block_start") {
              const block = event.content_block;
              if (block.type === "tool_use") {
                currentToolUse = { id: block.id, name: block.name, inputJson: "" };
                send("status", { phase: "tool_call", tool: block.name });
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                send("delta", { text: event.delta.text });
                iterationText += event.delta.text;
              } else if (event.delta.type === "input_json_delta" && currentToolUse) {
                currentToolUse.inputJson += event.delta.partial_json;
              }
            } else if (event.type === "content_block_stop") {
              if (currentToolUse) {
                let input: Record<string, unknown> = {};
                try {
                  input = currentToolUse.inputJson ? JSON.parse(currentToolUse.inputJson) : {};
                } catch { input = {}; }
                toolUseBlocks.push({ id: currentToolUse.id, name: currentToolUse.name, input });
                contentBlocks.push({
                  type: "tool_use",
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input,
                } as Anthropic.ToolUseBlock);
                currentToolUse = null;
              } else if (iterationText) {
                contentBlocks.push({ type: "text", text: iterationText } as Anthropic.TextBlock);
              }
            } else if (event.type === "message_delta") {
              stopReason = event.delta.stop_reason ?? null;
            }
          }

          fullText += iterationText;

          // No tool calls — done
          if (toolUseBlocks.length === 0) break;

          // Execute tools
          const toolResultContents: Anthropic.ToolResultBlockParam[] = [];

          for (const tb of toolUseBlocks) {
            toolsUsed.push(tb.name);

            let result: ToolResult;
            try {
              result = await executeToolCallV2(tb.name, tb.input, toolContext);
            } catch (err) {
              result = {
                success: false,
                error: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
              };
            }

            send("status", {
              phase: "tool_result",
              tool: tb.name,
              success:
                typeof result === "object" && result !== null
                  ? result.success
                  : true,
            });

            const resultStr =
              typeof result === "string" ? result : JSON.stringify(result);

            toolResultContents.push({
              type: "tool_result",
              tool_use_id: tb.id,
              content: resultStr.substring(0, 50_000),
            });
          }

          // Append to messages
          messages.push({
            role: "assistant",
            content: contentBlocks as Anthropic.ContentBlockParam[],
          });
          messages.push({ role: "user", content: toolResultContents });

          send("status", { phase: "responding" });

          if (elapsed > timeBudgetMs) break;
        }

        // Store assistant response
        await storeMessage(
          conversationId,
          "assistant",
          fullText,
          toolsUsed.length > 0 ? toolsUsed : undefined
        );
        await updateConversationTools(conversationId, toolsUsed);

        send("done", { conversationId, toolsUsed });
        controller.close();
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown streaming error";
        send("error", { message: errorMsg });
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// Tool access filtering
// ---------------------------------------------------------------------------

function getToolsForAccessLevel(accessLevel: string | null): Anthropic.Tool[] {
  if (!accessLevel || accessLevel === "none") return [];
  if (accessLevel === "read_only")
    return TIPPY_V2_TOOLS.filter((t) => !V2_WRITE_TOOLS_SET.has(t.name));
  return TIPPY_V2_TOOLS; // read_write and full get all tools
}

// ---------------------------------------------------------------------------
// Fallback (no API key)
// ---------------------------------------------------------------------------

function getFallbackResponse(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey"))
    return "Hi! I'm Tippy, your Beacon assistant. I can help you look up places, cats, people, requests, and more. However, my AI capabilities are currently unavailable. Please check back later or contact your admin.";
  if (lower.includes("help"))
    return "I can help with:\n- Looking up places and colony data\n- Finding cats by microchip or description\n- Searching people and contacts\n- Request and trapper statistics\n- Navigating Beacon\n\nHowever, my AI capabilities are currently unavailable. Please try again later.";
  return "I'm Tippy, your Beacon assistant. My AI capabilities are currently unavailable. Please try again later or contact your admin for help.";
}

// ---------------------------------------------------------------------------
// Optimized history
// ---------------------------------------------------------------------------

function optimizedHistory(
  history: ChatMessage[]
): Anthropic.MessageParam[] {
  // Keep last 20 messages, truncate old content to 500 chars
  const MAX_HISTORY = 20;
  const TRUNCATE_AFTER = 10; // Messages older than this get truncated
  const MAX_OLD_LENGTH = 500;

  const trimmed = history.slice(-MAX_HISTORY);

  return trimmed.map((msg, i) => {
    const isOld = i < trimmed.length - TRUNCATE_AFTER;
    let content = msg.content;
    if (isOld && content.length > MAX_OLD_LENGTH) {
      content = content.substring(0, MAX_OLD_LENGTH) + "... [truncated]";
    }
    return { role: msg.role, content };
  });
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

export async function handleV2(request: NextRequest): Promise<Response> {
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  const { message, history, conversationId, pageContext, stream } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return apiBadRequest("Message is required");
  }

  // Session + access
  const session = await getSession(request);
  const staffId = session?.staff_id ?? null;

  let aiAccessLevel: string | null = null;
  let userName: string | null = null;

  if (staffId) {
    const staff = await queryOne<{
      ai_access_level: string | null;
      name: string | null;
    }>(
      `SELECT ai_access_level, name FROM ops.staff WHERE id = $1`,
      [staffId]
    );
    aiAccessLevel = staff?.ai_access_level ?? "read_only";
    userName = staff?.name ?? null;
  }

  if (!aiAccessLevel || aiAccessLevel === "none") {
    return apiSuccess({
      response:
        "You don't currently have Tippy access. Please ask your admin to enable it.",
      conversationId: null,
    });
  }

  // Available tools
  const availableTools = getToolsForAccessLevel(aiAccessLevel);

  // Conversation
  const convId = await getOrCreateConversation(conversationId, staffId);

  // Store user message
  await storeMessage(convId, "user", message.trim());

  // API key check
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const fallback = getFallbackResponse(message);
    await storeMessage(convId, "assistant", fallback);
    return apiSuccess({ response: fallback, conversationId: convId });
  }

  const client = new Anthropic({ apiKey });

  // Engineer detection
  const isEngineer = userName
    ? engineerNames.includes(userName.toLowerCase())
    : false;

  // New user detection
  let isNewUser = false;
  if (staffId) {
    const convCount = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ops.tippy_conversations WHERE staff_id = $1`,
      [staffId]
    );
    isNewUser = (convCount?.cnt ?? 0) <= 1;
  }

  // Strategic intent detection
  const isStrategicQuery = detectStrategicIntent(message);

  // Preflight + memory context
  const [preflightContext, memoryContext] = await Promise.all([
    buildPreflightContext(convId),
    staffId ? buildMemoryContext(staffId) : Promise.resolve(null),
  ]);

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    userName,
    isEngineer,
    accessLevel: aiAccessLevel,
    pageContext,
    preflightContext,
    memoryContext,
    isNewUser,
    isStrategicQuery,
  });

  // Intent detection for forced tool choice
  let forcedToolChoice:
    | { type: "auto" }
    | { type: "tool"; name: string }
    | undefined;

  const detectedIntent = detectIntentAndForceToolChoice(message, aiAccessLevel || "read_only");
  if (detectedIntent) {
    if (detectedIntent.type === "tool") {
      // Only force if the tool exists in available tools
      if (availableTools.some((t) => t.name === detectedIntent.name)) {
        forcedToolChoice = detectedIntent;
      }
    } else {
      forcedToolChoice = detectedIntent;
    }
  }

  // Shift briefing
  if (message.trim() === "__shift_briefing__") {
    const briefingData = await assembleBriefingData(staffId!);
    const briefingMessages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Generate a shift briefing for today. Here's the current data:\n\n${briefingData}\n\nFormat as a concise morning briefing. Highlight anything that needs immediate attention.`,
      },
    ];

    if (stream) {
      return handleStreamingChat({
        client,
        systemPrompt,
        messages: briefingMessages,
        availableTools,
        conversationId: convId,
        session,
        userName,
        aiAccessLevel,
      });
    }

    const toolContext: ToolContext = { staffId: staffId || "", staffName: userName || "Unknown", aiAccessLevel: aiAccessLevel || "read_only", conversationId: convId };
    const result = await runAgentLoop({
      client,
      systemPrompt,
      messages: briefingMessages,
      availableTools,
      toolContext,
    });

    await storeMessage(
      convId,
      "assistant",
      result.fullText,
      result.toolsUsed.length > 0 ? result.toolsUsed : undefined
    );
    await updateConversationTools(convId, result.toolsUsed);

    return apiSuccess({
      response: result.fullText,
      conversationId: convId,
      toolsUsed: result.toolsUsed,
    });
  }

  // Build messages array
  const historyMessages = history ? optimizedHistory(history) : [];
  const allMessages: Anthropic.MessageParam[] = [
    ...historyMessages,
    { role: "user", content: message.trim() },
  ];

  // Streaming path
  if (stream) {
    return handleStreamingChat({
      client,
      systemPrompt,
      messages: allMessages,
      availableTools,
      forcedToolChoice,
      conversationId: convId,
      session,
      userName,
      aiAccessLevel,
    });
  }

  // Non-streaming path
  try {
    const toolContext: ToolContext = { staffId: staffId || "", staffName: userName || "Unknown", aiAccessLevel: aiAccessLevel || "read_only", conversationId: convId };
    const result = await runAgentLoop({
      client,
      systemPrompt,
      messages: allMessages,
      availableTools,
      forcedToolChoice,
      toolContext,
    });

    await storeMessage(
      convId,
      "assistant",
      result.fullText,
      result.toolsUsed.length > 0 ? result.toolsUsed : undefined
    );
    await updateConversationTools(convId, result.toolsUsed);

    return apiSuccess({
      response: result.fullText,
      conversationId: convId,
      toolsUsed: result.toolsUsed,
    });
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "Unknown error";
    console.error("[tippy/chat/route-v2] Agent loop error:", errorMsg);
    return apiServerError(`Tippy encountered an error: ${errorMsg}`);
  }
}
