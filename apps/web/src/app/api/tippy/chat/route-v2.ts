import { NextRequest } from "next/server";
import { apiBadRequest, apiSuccess, apiServerError } from "@/lib/api-response";
import Anthropic from "@anthropic-ai/sdk";
import { TIPPY_V2_TOOLS, executeToolCallV2, type ToolContext, type ToolResult, type ActionCardPayload } from "../tools-v2";
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
- Compare two addresses → compare_places
- Compare two cities/regions → area_stats (call twice, once per city. Do NOT use run_sql for city comparisons.)
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
RULE: Once full_place_briefing returns found:true with cat_statistics, STOP calling tools and write your response. The briefing is comprehensive — do not re-query the same place with run_sql or spatial_context.
RULE: For place_search → full_place_briefing chains, 2 tools is sufficient. Respond after the briefing.

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
Key columns for run_sql: ops.appointments(appointment_date, cat_id, place_id, client_name), sot.cats(cat_id, display_name, altered_status, is_deceased, deceased_at, sex), ops.requests(request_id, place_id, status, estimated_cat_count, requester_person_id)
Matviews: ops.mv_city_stats, ops.mv_zip_coverage, ops.mv_ffr_impact_summary

ANALYTICAL RECIPES (use with run_sql — ONE query, not schema exploration):
1. CATS ALTERED BY YEAR: SELECT EXTRACT(YEAR FROM appointment_date)::INT as year, COUNT(DISTINCT cat_id) as cats FROM ops.appointments WHERE appointment_date IS NOT NULL GROUP BY 1 ORDER BY 1
2. ESTIMATED LIVING ALTERED CATS: SELECT * FROM ops.v_altered_cat_survival_estimate — returns year-by-year cohorts with estimated_living, methodology, and data_caveat columns. SUM(estimated_living) for total. For scenario comparison: SELECT * FROM ops.estimate_living_altered_cats(0.10) overrides attrition rate.
2b. IMPACT DASHBOARD: SELECT * FROM ops.v_impact_at_a_glance — single-row summary: total altered, estimated living, active requests, cities. Includes methodology column.
3. CITY COMPARISON: Use area_stats tool, NOT run_sql. Or: SELECT * FROM ops.mv_city_stats WHERE city IN ('Santa Rosa','Petaluma')
4. MONTHLY TREND: SELECT DATE_TRUNC('month', appointment_date) as month, COUNT(DISTINCT cat_id) FROM ops.appointments WHERE appointment_date >= NOW() - INTERVAL '12 months' GROUP BY 1 ORDER BY 1
5. COLONY STATUS: SELECT * FROM sot.v_place_colony_status WHERE place_id = '<uuid>'
6. REQUEST PIPELINE: SELECT status, COUNT(*) FROM ops.requests WHERE merged_into_request_id IS NULL GROUP BY 1
7. MOST ACTIVE CARETAKERS / COMMUNITY MEMBERS: SELECT pe.display_name, COUNT(DISTINCT pp.place_id) AS places, COUNT(DISTINCT pc.cat_id) AS cats_linked, STRING_AGG(DISTINCT pp.relationship_type, ', ') AS roles FROM sot.person_place pp JOIN sot.people pe ON pe.person_id = pp.person_id AND pe.merged_into_person_id IS NULL LEFT JOIN sot.person_cat pc ON pc.person_id = pe.person_id WHERE pp.relationship_type IN ('resident','caretaker','owner') GROUP BY pe.person_id, pe.display_name HAVING COUNT(DISTINCT pp.place_id) >= 2 OR COUNT(DISTINCT pc.cat_id) >= 5 ORDER BY cats_linked DESC LIMIT 15 — Note: caretaker role is under-tagged. People with many cats across multiple places are likely colony caretakers even if tagged "resident".
8. BIGGEST TRAPPING DAYS: SELECT appointment_date, COUNT(DISTINCT cat_id) AS cats_done, COALESCE(p.display_name, p.formatted_address) AS location FROM ops.appointments a LEFT JOIN sot.places p ON p.place_id = a.place_id WHERE appointment_date IS NOT NULL GROUP BY appointment_date, p.display_name, p.formatted_address HAVING COUNT(DISTINCT cat_id) >= 10 ORDER BY cats_done DESC LIMIT 15
9. TOTAL CATS HELPED / OVERALL IMPACT: SELECT * FROM ops.v_impact_at_a_glance — one row with total_cats_seen, total_altered, estimated_living, places_with_cats, active_requests, cities_covered, methodology
10. PENDING INTAKES (kiosk/phone submissions): SELECT COUNT(*) FROM ops.intake_submissions WHERE status = 'pending' — These are NEW submissions from the kiosk or phone, NOT requests. Requests (ops.requests) are processed work items. When staff asks "pending intakes" use intake_submissions, when they ask "open requests" use ops.requests.
11. COVERAGE GAPS / WHAT DON'T WE KNOW: SELECT city, total_places, places_with_cats, cat_coverage_pct, gap_score, last_activity_date FROM ops.v_coverage_gaps ORDER BY gap_score DESC LIMIT 15 — Higher gap_score = more underserved. Our data reflects what we've DISCOVERED, not what EXISTS. Low coverage means we haven't been there.
Do NOT run "SELECT column_name FROM information_schema..." — the schema info above is sufficient.

METHODOLOGY DISCLOSURE (MANDATORY):
When presenting estimated or derived numbers (survival estimates, population projections, coverage rates):
- Say "estimated" not "are" — never present a model output as ground truth
- State the methodology: what rate, what source, what assumptions
- Note data gaps: "we only have 254 confirmed deceased out of 35K+ altered cats — most mortality is untracked"
- If using a configurable rate, say so: "using our current 13% annual attrition rate (adjustable as we collect more data)"
This applies to ALL analytical responses. Numbers without methodology are worse than no answer.`;

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
- log_event with action_type="add_note" for "note that...", "record that...", "log that..." — attaches a note to a place, person, cat, or request. Notes auto-appear in place briefings.
- Reminders and lookups appear at /me.

TRAPPER TEXT PARSING:
When a user pastes a long message (>3 lines) from trapper notes or text messages:
1. Extract structured data: addresses, cat counts, observations, names
2. For EACH distinct observation, call log_event with action_type="add_note" and the relevant location
3. For cat counts at specific addresses, also call log_event with action_type="field_event"
4. Summarize what you extracted and logged after processing`;
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
    const existing = await queryOne<{ conversation_id: string }>(
      `SELECT conversation_id FROM ops.tippy_conversations WHERE conversation_id = $1`,
      [conversationId]
    );
    if (existing) return existing.conversation_id;
  }

  const row = await queryOne<{ conversation_id: string }>(
    `INSERT INTO ops.tippy_conversations (staff_id)
     VALUES ($1)
     RETURNING conversation_id`,
    [staffId]
  );

  return row?.conversation_id || `conv_${Date.now()}`;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function buildMemoryContext(_staffId: string): Promise<string | null> {
  // tippy_staff_memory table does not exist yet — returns null until schema created.
  return null;
}

async function storeMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  toolCalls?: string[],
  _toolResults?: string[],
  tokens?: number
): Promise<void> {
  if (conversationId.startsWith("conv_")) return; // fallback ID, no DB record
  try {
    await execute(
      `INSERT INTO ops.tippy_messages
         (conversation_id, role, content, tool_calls, tokens_used)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        conversationId,
        role,
        content,
        toolCalls ? JSON.stringify({ tools: toolCalls }) : null,
        tokens ?? null,
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
  if (toolNames.length === 0 || conversationId.startsWith("conv_")) return;
  try {
    await execute(
      `UPDATE ops.tippy_conversations
       SET tools_used = array_cat(tools_used, $2::text[]),
           updated_at = NOW()
       WHERE conversation_id = $1`,
      [conversationId, toolNames]
    );
  } catch {
    // Non-blocking
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateConversationSummary(_staffId: string): Promise<void> {
  // tippy_staff_memory table does not exist yet — this is a no-op until
  // the schema is created. The V1 code had the same issue (silently failed).
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
       WHERE status = 'pending'`
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
    const reminders = await queryRows<{ title: string; due_at: string }>(
      `SELECT title, due_at::text FROM ops.staff_reminders
       WHERE staff_id = $1 AND completed_at IS NULL
         AND due_at <= NOW() + INTERVAL '24 hours'
       ORDER BY due_at LIMIT 5`,
      [staffId]
    );
    if (reminders.length > 0) {
      parts.push(
        "**Due reminders:**\n" +
          reminders.map((r) => `- ${r.title} (${r.due_at})`).join("\n")
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
          emitActionCard: (card: ActionCardPayload) => send("action_card", card),
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
      display_name: string | null;
    }>(
      `SELECT ai_access_level, display_name FROM ops.staff WHERE staff_id = $1`,
      [staffId]
    );
    aiAccessLevel = staff?.ai_access_level ?? "read_only";
    userName = staff?.display_name ?? null;
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
