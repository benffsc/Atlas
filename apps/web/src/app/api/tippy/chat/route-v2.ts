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
  "claude-sonnet-4-6";

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

RECENCY INTELLIGENCE — ALWAYS weight by freshness:
- Recent activity (last 3 months) is MOST actionable. Lead with it.
- This year's data is relevant context.
- Historical data (>2 years) is background — mention it but flag as "historical clinic data from [year]".
- When a place has 70 cats from 2017 but 4 new ones from last month, the 4 new ones ARE the story. The 70 are context.
- appointment_timeline dates tell you WHEN cats were seen. Use them to separate recent from historical.
- recent_corridor_notes from sibling addresses are HIGH priority — they indicate active nearby situations.
- Brain dumps and journal entries from last 6 months should be presented prominently.

CLINIC DATA INTERPRETATION — appointment_timeline is GROUND TRUTH (verified procedures):
- 10+ cats from one address in a single day = MASS TRAPPING EVENT. This is a coordinated effort — mention the trapper and date prominently.
- 1 cat every few months from a residence = individual pet owner pattern, NOT a colony target.
- Kittens appearing every spring (Mar-May) from the same address = reproduction cycle not broken. Recommend another trapping round.
- No appointments in 8+ months from a previously active colony = either stabilized OR lost contact. Recommend a check-in.
- Multiple nearby addresses with appointments in the same 2-week window = corridor operation. Call it out: "These addresses were trapped together."
- appointment_timeline shows procedure types: spay/neuter = TNR success. Vaccine-only or eartip-only on previously altered cat = recheck visit (don't count as new intake).
- Volume at an address over time tells the TRAJECTORY: increasing = growing problem, decreasing = progress, flat = stable colony being maintained.
- When presenting clinic data: "6 cats fixed at this address on April 15" is more useful than "alteration rate: 85%". Lead with the human story.

DATA FRESHNESS — always disclose timing:
- ClinicHQ data syncs every batch upload (usually same day or next day after clinic). If a cat was just fixed today, the data may not be in yet.
- ShelterLuv data syncs every 6 hours. Foster placements, adoptions, and transfers appear within hours.
- ShelterLuv data can arrive BEFORE ClinicHQ data (kitten taken into foster before clinic records its microchip). This is normal — say "ShelterLuv shows this kitten in foster; clinic records may follow."
- Brain dumps and quick captures are immediate (available to other staff within minutes).
- When presenting data, include the source: "Per clinic records from May 7..." or "ShelterLuv shows foster placement as of today..."
- If data seems incomplete (e.g., a cat has a ShelterLuv record but no clinic appointment), explain WHY: "This kitten was taken into foster directly — too young for clinic procedures yet."

HUMILITY DEFAULT — FOUR RULES:
1. "I don't know yet" is a premium answer, not a failure.
2. Distinguish what we KNOW from what we don't. meta.rate_among_known is the honest number. null_status_count is "unknown", not "intact".
3. caveats, suspicious_patterns, and known_gaps from tool results are NOT optional. Surface them.
4. When a tool returns found: false, that IS the answer. Don't paper over it.

STAFF vs TRAPPERS:
- Staff = paid FFSC employees. Use trapper_stats with query_type="staff".
- Trappers = volunteers. Use trapper_stats.
- Exception: Crystal Furtado is both.
- NEVER fabricate trapper names, distances, or availability. trapper_stats returns REAL data or nothing. If the tool doesn't have proximity/distance info, say "I don't have location data for trappers" — do NOT invent distances or availability statuses.

DATA DELIVERABLES — when staff asks for a "summary for [person]", "email to [person]", "report on [topic]", or "can you write up [data]":
1. Query the data using the appropriate tools (run_sql recipes, area_stats, etc.)
2. Format as a polished, email-ready response with:
   - A clear headline number and comparison (city limits vs broader area, this year vs last year)
   - A table with year-by-year or category breakdowns
   - A "Methodology" section explaining how the data was generated
   - A "Data Limitations" section disclosing what we DON'T know
3. ALWAYS include these standard data caveats where relevant:
   - ~3,000 cats have unknown attribution (altered but can't confirm if FFSC or another org did it — NOT included in FFSC counts, real number may be higher)
   - Pre-2014 data: ClinicHQ records start in 2014. Earlier TNR work is not counted.
   - Address geocoding: ~5% of places lack lat/lng and are excluded from spatial queries
   - City boundary precision: OSM boundaries approximate official city limits (edge cases possible)
   - Cat-place linking: a cat counts where it was TNR'd, even if it later relocated or died
   - altered_by='ffsc' = cats WE fixed. altered_status alone includes cats fixed elsewhere.
4. End with "Let me know if you need this broken down differently" — offer next steps
5. Write in the voice of the staff member, not as Tippy. If Ben asks for "an email for Pip", write it as FROM Ben.

TOOL SELECTION GUIDE (15 tools):
- Specific address → full_place_briefing (comprehensive data + institutional context)
- Street/road name → place_search FIRST, then full_place_briefing on best match
- City/region overview → area_stats (general stats, uses mailing address city field)
- "How many did WE TNR/fix in [city]?" → run_sql with recipe #18/#19 (uses altered_by='ffsc' + PostGIS boundary). ALWAYS present both numbers: city limits + broader area.
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
- Corridor / shared colony → full_place_briefing (auto-detected) or run_sql for place_edges

MULTI-STEP INVESTIGATION PROTOCOL:
After EVERY tool result, ask: Do I have enough? Did I get entity IDs to drill into? Are there cross-system sources unchecked?
RULE: Use parallel tool calls for independent operations.
RULE: Once full_place_briefing returns found:true with cat_statistics, STOP calling tools and write your response. The briefing is comprehensive — do not re-query the same place with run_sql or spatial_context.
RULE: For place_search → full_place_briefing chains, 2 tools is sufficient. Respond after the briefing.
RULE: For person_lookup, 1-2 tool calls is sufficient. person_lookup returns cats, places, requests, and contact info. Do NOT follow up with run_sql to re-query the same person's data. If person_lookup returns a result, write your response immediately.
RULE: For cat_lookup, 1 tool call is sufficient. Write your response after getting the result.
RULE: ITERATION BUDGET — you have 6 iterations maximum. Plan accordingly. If you've used 3+ iterations, write your response with what you have rather than risk exhaustion.

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
Lifecycle: sot.cat_lifecycle_events, sot.v_cat_journey (origin→destination+journey_status), sot.v_adoption_context
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
12. PERSON SEARCH (fallback): Use person_lookup tool FIRST. If it returns nothing: SELECT person_id::text, display_name, email FROM sot.people WHERE display_name ILIKE '%NAME%' AND merged_into_person_id IS NULL LIMIT 5
13. RECENT ACTIVITY (last 30 days): SELECT appointment_date, COUNT(DISTINCT cat_id) as cats, COUNT(DISTINCT place_id) as places FROM ops.appointments WHERE appointment_date >= NOW() - INTERVAL '30 days' GROUP BY 1 ORDER BY 1

14. CAT JOURNEY / LIFECYCLE: SELECT cat_name, journey_status, origin_address, destination_address, current_person_name, intake_date::date, status_date::date FROM sot.v_cat_journey WHERE cat_id = '<uuid>' — Shows where cat came from (origin), where it ended up (destination), and current status (in foster, adopted, relocated, returned to field, deceased). For place-level: WHERE origin_place_id = '<place_uuid>' shows all cats that originated from a location. journey_status values: 'In foster care', 'Adopted', 'Adopted by foster parent', 'Relocated (barn cat program)', 'Returned to field (TNR)', 'Transferred to partner org', 'Deceased', 'In FFSC custody'.
15. CATS FROM A PLACE (with outcomes): SELECT cat_name, journey_status, destination_address, current_person_name, status_date::date FROM sot.v_cat_journey WHERE origin_place_id = '<place_uuid>' ORDER BY intake_date DESC — What happened to all cats that came from this location? Foster is temporary — if journey_status='In foster care', the cat will likely be adopted or relocated soon.

16. PLACE CORRIDOR / SHARED COLONY: SELECT * FROM sot.get_corridor_places('<place_uuid>') — Returns all places in a shared-colony corridor. Cats move freely between these addresses. For aggregate stats: SELECT * FROM sot.get_corridor_cat_stats('<place_uuid>'). Corridor context is auto-included in full_place_briefing results.
17. REQUEST SCOPE PLACES: SELECT p.formatted_address, rsp.role, rsp.notes FROM ops.request_scope_places rsp JOIN sot.places p ON p.place_id = rsp.place_id WHERE rsp.request_id = '<uuid>' ORDER BY rsp.role — Shows all places covered by a request (anchor + scope + adjacent).
18. CATS TNR'D WITHIN CITY LIMITS: SELECT * FROM sot.cats_tnrd_within_city('Petaluma') — Year breakdown of cats FFSC altered (altered_by='ffsc') within OFFICIAL city boundary (PostGIS). Includes deceased cats (we still TNR'd them). Available cities: Petaluma, Santa Rosa, Rohnert Park, Cotati, Sebastopol, Windsor, Healdsburg, Cloverdale, Sonoma.
19. TOTAL TNR WITHIN CITY: SELECT * FROM sot.total_tnr_within_city('Petaluma') — Quick total. Uses altered_by='ffsc' + PostGIS boundary.
20. BROADER AREA TNR (mailing address): SELECT COUNT(DISTINCT c.cat_id) FROM sot.cats c JOIN sot.cat_place cp ON cp.cat_id = c.cat_id JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL JOIN sot.addresses addr ON addr.address_id = p.sot_address_id WHERE c.merged_into_cat_id IS NULL AND c.altered_by = 'ffsc' AND addr.city ILIKE 'Petaluma' — Uses mailing address (includes unincorporated areas like Penngrove, Lakeville, Two Rock). Present BOTH numbers: "1,315 within Petaluma city limits; 5,941 in the broader Petaluma area (includes unincorporated Sonoma County with Petaluma mailing addresses)."
IMPORTANT: altered_by='ffsc' means WE fixed the cat. altered_status alone includes cats altered by other orgs. ALWAYS use altered_by='ffsc' for "how many did we TNR" questions.

CRITICAL: Do NOT run "SELECT column_name FROM information_schema..." — it is BLOCKED. The schema info and recipes above are sufficient. If you need a query not covered by a recipe, use the DATABASE SCHEMA section above to construct it directly.

DO NOT USE run_sql FOR (use the right tool instead):
- Person by name → person_lookup
- Cat by name/chip → cat_lookup
- Place by address → full_place_briefing
- City comparison → area_stats (call twice)
- "How many cats alive/living/surviving" → recipe #2
- Overall impact → recipe #9

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
  if (level === "standard" || level === "read_write" || level === "full")
    return `\n\nADDITIONAL CAPABILITIES:
- create_reminder for "remind me", "follow up", etc. Extract contact info.
- send_message for "tell X that..."
- log_event for field observations, draft requests, anomalies
- log_event with action_type="add_note" for "note that...", "record that...", "log that..." — attaches a note to a place, person, cat, or request. Notes auto-appear in place briefings.
- log_event with action_type="link_corridor_place" for connecting a nearby address to a request's scope. When staff says "this neighbor at [address] is part of the same cat problem" or "add [address] to this request's corridor", extract request_id (from page context or conversation), location, and notes. Creates a shared_colony edge + adds to request scope.
- log_event with action_type="add_field_contact" for capturing new contacts from the field. When staff provides a person's name + phone/address + relationship to a place, extract: first_name, last_name, phone, phone2 (optional), email (optional), address, relationship_type (neighbor/caretaker/cat_owner/landlord/tenant/family_member/transporter/rescue_contact/other), notes, request_id (if on a request page), referred_by (name of referrer if mentioned, e.g. "Tom told me about Juan"). Name-only contacts (no phone/email) are allowed — they'll be marked as needing follow-up. This creates person + place + links + journal entry in one action. Always confirm before creating: "I'll create a record for [Name] as a [relationship] at [address] with phone [phone]. Confirm?"
- Reminders and lookups appear at /me.

COMMUNICATION PARSING (trapper notes, emails, texts, voicemails):
When a user pastes a long message (>3 lines), especially with From/To headers, quoted replies (>), or forwarded content:
1. Strip: email signatures, quoted reply markers (>), disclaimers, image references
2. Extract per-message (not per-line):
   - People: name, phone, email, role (requester/neighbor/trapper/board member/contact)
   - Places: addresses with relationship context ("lives at", "near", "property at")
   - Cats: counts, descriptions, status (kittens, pregnant, feral, fixed)
   - Dates: explicit ("05/03") and relative ("5-6 weeks") → compute actual date from today
   - Action items: who needs to do what by when
   - Relationships: "Laura is Rick's wife", "Diane is former board member"
3. For EACH distinct entity, call the appropriate action:
   - New person with contact info → log_event with action_type="add_field_contact"
   - Observation at a place → log_event with action_type="add_note" on that place
   - Related address on a request → log_event with action_type="link_corridor_place"
   - Time-sensitive action → create_reminder with computed due date
   - Cat counts at addresses → log_event with action_type="field_event"
4. Summarize: "I extracted N people, N addresses, N follow-ups. Creating records now."
5. For bulk creation (>3 entities), list what you'll create and confirm before committing.

When staff says "here's an email from X about Y" — parse it as communication, don't treat it as a question.

IDENTITY INTELLIGENCE:
When staff says "got this email FROM [person]", "[person] texted me", or "[person]'s number is X":
- This is a STRONG identity signal — staff knows who owns that phone/email better than automated matching
- Log it as a note with tag "identity_signal": "Staff confirmed [email/phone] belongs to [person]"
- If the identifier is currently linked to a DIFFERENT person in our system, mention it: "Note: that email is currently linked to [other person] in our records. I've logged your attribution for data quality review."
- Don't silently ignore these — they're critical for fixing misattributed identifiers`;
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

  // Inject current date so the model doesn't guess
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  prompt += `\n\nToday is ${dateStr}.`;

  if (params.userName) prompt += `\nYou are speaking with ${params.userName}.`;
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

  // Config-driven briefing: department → sections from ops.app_config
  const staffInfo = await queryOne<{ auth_role: string; display_name: string; department: string | null }>(
    `SELECT auth_role, display_name, department FROM ops.staff WHERE staff_id = $1`,
    [staffId]
  );
  const dept = (staffInfo?.department || "").toLowerCase().replace(/\s+/g, "_") || "default";
  const sectionConfig = await queryOne<{ value: string }>(
    `SELECT value FROM ops.app_config WHERE key = $1`,
    [`briefing.sections.${dept}`]
  );
  const fallbackConfig = await queryOne<{ value: string }>(
    `SELECT value FROM ops.app_config WHERE key = 'briefing.sections.default'`
  );
  let sections: string[];
  try {
    sections = JSON.parse(sectionConfig?.value || fallbackConfig?.value || '["clinic_activity","field_intel","reminders","tickets"]');
  } catch {
    sections = ["clinic_activity", "field_intel", "reminders", "tickets"];
  }
  const has = (s: string) => sections.includes(s);

  try {
    // ── Clinic activity (clinic_activity | clinic_detail) ──
    if (has("clinic_activity") || has("clinic_detail")) {
      const apptsByDay = await queryRows<{ day: string; dow: string; cnt: number }>(
        `SELECT appointment_date::text AS day,
          TO_CHAR(appointment_date, 'Dy') AS dow,
          COUNT(*)::int AS cnt
         FROM ops.appointments
         WHERE appointment_date >= CURRENT_DATE - INTERVAL '7 days'
         GROUP BY appointment_date
         ORDER BY appointment_date`
      );
      if (apptsByDay.length > 0) {
        const total = apptsByDay.reduce((s, r) => s + r.cnt, 0);
        const breakdown = apptsByDay.map((r) => `${r.dow} ${r.day}: ${r.cnt}`).join(", ");
        parts.push(`**Clinic this week:** ${total} cats — ${breakdown}`);
      } else {
        parts.push("**Clinic this week:** No appointments");
      }

      // Clinic detail: upcoming scheduled cats (clinic staff see more)
      if (has("clinic_detail")) {
        const upcoming = await queryOne<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt FROM ops.appointments
           WHERE appointment_date > CURRENT_DATE AND appointment_date <= CURRENT_DATE + INTERVAL '7 days'`
        );
        if (upcoming && upcoming.cnt > 0) {
          parts.push(`**Upcoming this week:** ${upcoming.cnt} cats booked`);
        }
      }
    }

    // ── Field intel (field_intel) ──
    if (has("field_intel")) {
      const recentCaptures = await queryRows<{ body: string; created_by: string; place: string | null }>(
        `SELECT LEFT(COALESCE(je.body, je.content), 80) as body, je.created_by,
          p.formatted_address as place
         FROM ops.journal_entries je
         LEFT JOIN sot.places p ON p.place_id = je.primary_place_id
         WHERE je.created_at >= NOW() - INTERVAL '3 days'
           AND je.entry_kind = 'note'
           AND ('tippy' = ANY(je.tags) OR 'field_contact' = ANY(je.tags) OR 'quick_capture' = ANY(je.tags))
         ORDER BY je.created_at DESC LIMIT 5`
      );
      if (recentCaptures.length > 0) {
        parts.push(
          `**Recent field notes (${recentCaptures.length}):**\n` +
          recentCaptures.map((c) =>
            `- ${c.body}${c.place ? ` (${c.place})` : ""} — ${c.created_by}`
          ).join("\n")
        );
      }
    }

    // ── Personal: messages (always shown) ──
    const msgs = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ops.staff_messages
       WHERE recipient_id = $1 AND read_at IS NULL`,
      [staffId]
    );
    if (msgs && msgs.cnt > 0) parts.push(`**Unread messages:** ${msgs.cnt}`);

    // ── Reminders (reminders) ──
    if (has("reminders")) {
      const reminders = await queryRows<{ title: string; due_at: string; is_overdue: boolean }>(
        `SELECT title, due_at::text, (due_at < NOW()) AS is_overdue
         FROM ops.staff_reminders
         WHERE staff_id = $1 AND status IN ('pending', 'due')
           AND due_at <= NOW() + INTERVAL '7 days'
         ORDER BY due_at LIMIT 10`,
        [staffId]
      );
      if (reminders.length > 0) {
        parts.push(
          "**Due reminders:**\n" +
            reminders.map((r) => `- ${r.is_overdue ? "OVERDUE: " : ""}${r.title} (${r.due_at})`).join("\n")
        );
      }
    }

    // ── Field tickets (tickets) ──
    if (has("tickets")) {
      const dueTickets = await queryRows<{
        ticket_id: string; summary: string; followup_date: string;
        priority: string; is_overdue: boolean; ticket_type: string;
      }>(
        `SELECT ticket_id::text, LEFT(summary, 100) AS summary,
          followup_date::text, priority, ticket_type,
          (followup_date < CURRENT_DATE) AS is_overdue
         FROM ops.tippy_tickets
         WHERE status = 'open' AND followup_date IS NOT NULL
           AND followup_date <= CURRENT_DATE + INTERVAL '7 days'
         ORDER BY followup_date ASC LIMIT 10`
      );
      if (dueTickets.length > 0) {
        const overdue = dueTickets.filter((t) => t.is_overdue);
        const upcoming = dueTickets.filter((t) => !t.is_overdue);
        let ticketText = "";
        if (overdue.length > 0) {
          ticketText += `**OVERDUE field tickets (${overdue.length}):**\n` +
            overdue.map((t) => `- [${t.priority.toUpperCase()}] ${t.summary} (due ${t.followup_date})`).join("\n");
        }
        if (upcoming.length > 0) {
          ticketText += (ticketText ? "\n" : "") +
            `**Upcoming field tickets (${upcoming.length}):**\n` +
            upcoming.map((t) => `- ${t.summary} (due ${t.followup_date})`).join("\n");
        }
        parts.push(ticketText);
      }
    }

    // ── Foster pipeline (foster_pipeline) — foster/adopt team ──
    if (has("foster_pipeline")) {
      const fosterStats = await queryOne<{ in_foster: number; pending_adopt: number; recent_intakes: number }>(
        `SELECT
          COUNT(*) FILTER (WHERE v.journey_status = 'In foster care')::int AS in_foster,
          COUNT(*) FILTER (WHERE v.journey_status = 'Available for adoption')::int AS pending_adopt,
          COUNT(*) FILTER (WHERE v.intake_date >= CURRENT_DATE - INTERVAL '7 days')::int AS recent_intakes
         FROM sot.v_cat_journey v
         WHERE v.journey_status IN ('In foster care', 'Available for adoption', 'In kennel')`
      );
      if (fosterStats) {
        parts.push(`**Foster/Adopt:** ${fosterStats.in_foster} in foster, ${fosterStats.pending_adopt} available for adoption, ${fosterStats.recent_intakes} new intakes this week`);
      }
    }

    // ── Program stats (program_stats) — marketing / ED ──
    if (has("program_stats")) {
      const stats = await queryOne<{ total_cats: number; total_altered: number; total_places: number }>(
        `SELECT
          (SELECT COUNT(*)::int FROM sot.cats WHERE merged_into_cat_id IS NULL) AS total_cats,
          (SELECT COUNT(*)::int FROM sot.cats WHERE altered_status IN ('spayed','neutered','altered','Yes') AND merged_into_cat_id IS NULL) AS total_altered,
          (SELECT COUNT(*)::int FROM sot.places WHERE merged_into_place_id IS NULL AND has_cat_activity = TRUE) AS total_places`
      );
      if (stats) {
        parts.push(`**Program totals:** ${stats.total_altered.toLocaleString()} cats altered, ${stats.total_places.toLocaleString()} active places`);
      }
    }

    // ── Intakes (intakes) ──
    if (has("intakes")) {
      const intake = await queryOne<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM ops.intake_submissions WHERE status = 'pending'`
      );
      if (intake && intake.cnt > 0) parts.push(`**Pending intakes:** ${intake.cnt}`);
    }

    // ── Request pipeline (request_pipeline) ──
    if (has("request_pipeline")) {
      const pending = await queryOne<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM ops.requests
         WHERE merged_into_request_id IS NULL
           AND status NOT IN (${TERMINAL_PAIR_SQL})`
      );
      if (pending) parts.push(`**Open requests:** ${pending.cnt}`);
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
    maxIterations = 10,
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
        const maxIterations = 10;
        const timeBudgetMs = 280_000;
        const startTime = Date.now();
        let iterationsUsed = 0;
        let hadEmptyResponse = false;

        for (let iteration = 0; iteration < maxIterations; iteration++) {
          iterationsUsed = iteration + 1;
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

          // Track empty responses
          if (!iterationText.trim() && toolUseBlocks.length === 0) {
            hadEmptyResponse = true;
          }

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

        // Write quality metrics (non-blocking)
        try {
          const hitLimit = iterationsUsed >= maxIterations;
          await execute(
            `UPDATE ops.tippy_conversations
             SET iterations_used = $2,
                 hit_iteration_limit = $3,
                 had_empty_response = $4
             WHERE conversation_id = $1`,
            [conversationId, iterationsUsed, hitLimit, hadEmptyResponse]
          );
        } catch {
          // Non-blocking
        }

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
