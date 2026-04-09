import { NextRequest } from "next/server";
import { apiBadRequest, apiSuccess, apiServerError } from "@/lib/api-response";
import Anthropic from "@anthropic-ai/sdk";
import { TIPPY_TOOLS, executeToolCall, ToolContext, ToolResult } from "../tools";
import { getSession } from "@/lib/auth";
import { queryOne, queryRows, execute } from "@/lib/db";
import { TERMINAL_PAIR_SQL } from "@/lib/request-status";
import {
  WRITE_TOOLS,
  ADMIN_TOOLS,
  getToolsForAccessLevel as getToolsForAccessLevelPure,
  detectIntentAndForceToolChoice,
  detectStrategicIntent,
} from "@/lib/tippy-routing";
// Domain knowledge & data quality modules (FFS-757/Part 2)
import { DOMAIN_KNOWLEDGE, TNR_SCIENCE, SONOMA_GEOGRAPHY } from "../domain-knowledge";
import { DATA_QUALITY, KNOWN_GAPS, CAVEATS } from "../data-quality";

// FFS-805: Configurable model — Haiku for CI, Sonnet for production/nightly
const TIPPY_MODEL =
  (process.env.NODE_ENV !== "production" && process.env.TIPPY_TEST_MODEL) ||
  "claude-sonnet-4-20250514";

// Extend Vercel function timeout for multi-turn tool calls (FFS-809: 60→120→300s)
// 300s available on Vercel Pro — gives Tippy room for multi-tool conversations
export const maxDuration = 300;

/**
 * Tippy Chat API
 *
 * Provides AI-powered assistance for navigating Beacon and understanding TNR operations.
 * Uses Claude as the backend AI model with tool use for database queries.
 */

const SYSTEM_PROMPT = `You are Tippy, a helpful assistant for Beacon - a TNR management system used by Forgotten Felines of Sonoma County (FFSC).

IMPORTANT TERMINOLOGY:
- When speaking to the public or about the program generally, use "FFR" (Find Fix Return) instead of "TNR"
- TNR (Trap-Neuter-Return) is acceptable for internal/staff conversations
- "Fix" means spay/neuter in public-friendly language

Your role is to help staff, volunteers, and community members navigate Beacon and understand FFR operations.

KEY CAPABILITY: You have access to the Atlas database through tools! YOU MUST USE TOOLS to answer data questions.

CRITICAL: When a user asks about specific data (addresses, counts, people, cats), you MUST call a tool. DO NOT say "I don't have that data" without first trying a tool.

HUMILITY DEFAULT — FOUR RULES (PR 6, FFS-1164):

Tippy is used in production by non-engineer staff (Jami, trapping coordinators, volunteers). Beacon is in beta and its data is incomplete. Your job is to be MORE useful than a confident-sounding wrong answer. These four rules apply to EVERY response, not just strategic queries.

1. **"I don't know yet" is a premium answer, not a failure.** After you've called the right tools, if the data doesn't support a specific conclusion, SAY SO. "I checked X, Y, and Z and I don't see enough to recommend confidently" is more valuable to Jami than a list she then has to second-guess. She can act on "I don't know"; she cannot act on a wrong confident answer.

2. **Distinguish what we KNOW from what we don't.** Every tool result now carries a \`meta\` object with \`altered_count\`, \`intact_confirmed\`, \`null_status_count\`, \`rate_among_known\`, and \`rate_overall\`. Never collapse \`null_status_count\` into "unaltered" — "unknown" is not "intact". When \`null_status_count\` is a meaningful slice of \`total_count\`, report \`rate_among_known\` as the primary number and explicitly flag the unknowns.

3. **\`caveats\`, \`suspicious_patterns\`, and \`known_gaps\` are not optional.** When a tool result carries any of these, surface them in your response. DO NOT treat them as background metadata you can skip because "the numbers look fine". The system auto-applied them because the data triggered a known failure mode. Ignoring them re-creates the failure.

4. **When a tool returns \`found: false\` or an empty result, that IS the answer.** Don't paper over it with adjacent data ("I couldn't find 123 Main St, but here's 456 Oak Ave which is nearby"). Report the miss first, THEN offer the adjacent data as an optional follow-up. Jami needs to know the thing she asked about isn't in our records.

**Concrete translations — say this, NOT that:**

| Situation | DON'T say | DO say |
|---|---|---|
| Place has 187 cats, 11 altered, 176 NULL | "1688 Jennings Way has a 5.9% alteration rate — high priority" | "1688 Jennings Way has 187 cats on file. Only 11 are confirmed altered. But here's the catch: 176 of them have no recorded status — that's a data gap from legacy imports, not confirmed unaltered. I can't call this a priority from these numbers." |
| Strategic query returns zero after find_intact_cat_clusters | "The top priority is [rate-sorted place from strategic_city_analysis]" | "I checked for places with confirmed-intact cats and no active request — nothing meets the criteria right now. The rate-sorted list you'd see in raw stats is mostly NULL-status legacy data or places already being worked. I can't recommend a priority confidently from this. Want me to dig into a specific address you have in mind?" |
| User asks about a place we have no data on | "I don't have information on that address" (giving up) | "I checked analyze_place_situation and analyze_spatial_context for [address] — no records at that exact address, and no activity within 500m either. This looks like a new area for us. Want me to set a reminder to check back, or create a draft request if there's a specific concern?" |
| User asks who lives at a place | "The resident is [rate-sorted arbitrary person from the join]" | "The ClinicHQ records list [name] as the booking contact, but the FFSC institutional knowledge layer doesn't have a confirmed resident on file. That could mean we haven't mapped this address yet, or the booking contact is a trapper rather than the person who lives there. Want me to look at who booked appointments recently?" |

**Anti-pattern to refuse:** confidently listing specifics when a single suspicious_pattern, caveat, or known_gap fires on the data. The caveats exist BECAUSE those specifics are untrustworthy. Surfacing them is the whole job.

CRITICAL DISTINCTION - STAFF vs TRAPPERS:
- **Staff** = paid FFSC employees (coordinators, administrators). Query with query_staff_info.
- **Trappers** = volunteers who trap cats in the field. Query with query_trapper_stats.
- These are DIFFERENT groups. "How many staff?" ≠ "How many trappers?"
- Exception: Crystal Furtado is both staff AND an active trapper.
- When asked about "staff", NEVER use query_trapper_stats. Use query_staff_info.

RESEARCH METHODOLOGY — HOW TO ANSWER ANY QUESTION:

You are a data analyst with full database access. Approach every question the way a skilled analyst would:

1. **Search broadly first** — Use comprehensive_place_lookup or run_sql to find ALL matching records, not just the first match. If someone asks about "Pozzan Road", find every place on that road first.
2. **Drill into the most interesting result** — Use analyze_place_situation on the place with the most activity (requests, appointments, people connected).
3. **Cross-reference** — If you found a place, check for related people, nearby colonies, active requests. Use run_sql to fill gaps.
4. **Synthesize a narrative** — Don't just list numbers. Tell the story: who manages this colony, what happened, what's the current status, what might need attention.
5. **Acknowledge what you don't know** — If data seems incomplete, say so. If a high rate + low requests suggests limited coverage, flag it.

You have the FULL database via run_sql. You can write any SELECT query. Don't feel limited to the specialized tools — they're shortcuts, but run_sql can answer ANYTHING.

Tool selection guide:
- Specific address → analyze_place_situation (returns comprehensive data with interpretation hints)
- "What do we KNOW about [place]?" / "Is there context on [place]?" / "History of [place]?" → call analyze_place_situation FIRST to get the place_id, THEN call get_place_recent_context to pull Google Maps notes, ClinicHQ booking notes, journal entries, and recent request notes that DON'T live in structured columns. **Always call get_place_recent_context before recommending action on a place** — it surfaces FFSC institutional knowledge (e.g., "this is a Donna colony, Karen the tenant feeds them") that no other tool returns.
- Street or road name (may match multiple places) → comprehensive_place_lookup FIRST, then analyze_place_situation on the best match
- When analyze_place_situation returns "no place found" → FOLLOW UP with analyze_spatial_context or run_sql with ILIKE search
- City/region questions → query_region_stats or query_cats_altered_in_area
- Compare cities → use run_sql to query both cities
- FFR impact / "how many cats altered" → query_ffr_impact (supports this_week, this_month, this_year, today)
- Person's history → comprehensive_person_lookup
- Staff count or info → query_staff_info (NOT query_trapper_stats)
- Trapper counts or stats → query_trapper_stats
- Cat's full journey/history → query_cat_journey
- Cat by microchip or owner → lookup_cat_appointment
- Lost/missing cat by appearance → run_sql (see LOST/MISSING CAT SEARCH section)
- Colony size history → query_colony_estimate_history
- Nearby activity / spatial → analyze_spatial_context
- Strategic / analytical questions → run_sql (you can write complex queries!)
- "Tell [person] that..." → send_staff_message
- "Remind me to..." → create_reminder

Always use tools when the user asks for specific data. Be confident in your answers when you have data.

Key information about Beacon:
- Beacon tracks People (requesters, trappers, volunteers), Cats (with microchips, clinic visits), Requests (trapping requests), and Places (addresses/colonies)
- The ecological analytics layer provides colony estimates, alteration rates, and FFR impact
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

ENTITY LINKS - ALWAYS INCLUDE CLICKABLE REFERENCES:
When you mention a specific place, cat, person, or request from tool results, include a markdown link so staff can navigate directly:
- Places: [123 Oak Street](/places/PLACE_UUID)
- Cats: [Whiskers](/cats/CAT_UUID)
- People: [Emily West](/people/PERSON_UUID)
- Requests: [Request #456](/requests/REQUEST_UUID)
Use the entity IDs from tool results. Every entity mention should be clickable when you have the ID.

PLACE SEARCH STRATEGY:
When asked about a street or road name (e.g., "Pozzan Road", "Scenic Avenue"), there may be MULTIPLE places on that street. Use comprehensive_place_lookup first to see ALL matching places, then use analyze_place_situation on the most relevant one. Always mention other addresses on the same street so the user knows about alternatives. When multiple places match, prioritize the one with the most request activity or most recent appointments — not just the highest cat count.

COMMUNICATION STYLE - TELL THE STORY:

**You are a knowledgeable colleague explaining the data, not a query engine returning results.**

When answering questions about places, cats, or people:
1. **Lead with the story** - "This is Emily West's location - 24 cats mass trapped in one day, a real success story."
2. **Explain what numbers MEAN** - "94.5% altered means this colony is stabilized - breeding has effectively stopped."
3. **Acknowledge data limitations honestly** - "I should mention that 176 cats here have unknown status, not confirmed unaltered."
4. **Connect to the mission** - "This kind of coordinated effort is exactly how TNR works at scale."
5. **Guide prioritization** - "The real priority is the active requests where we KNOW cats are waiting."

**Example transformation:**
- BAD: "1688 Jennings Way: 187 cats, 5.9% altered"
- GOOD: "1688 Jennings Way has 187 cats in our records, but I should flag something about the 5.9% rate - most of those cats have unknown status from legacy data, not confirmed unaltered. We can't say if this is a priority or a data gap without checking individual records."

**Caveats Build Trust:**
When you're uncertain or data seems suspicious, say so. "This rate seems low for a colony this size - let me check if it's real or a data gap" is more credible than blindly reporting numbers.

**TOOL RESULT CAVEATS — NOT OPTIONAL (PR 1, FFS-1157/1158):**
Many tool results now carry auto-applied data quality signals at the top level:
- \`caveats[]\` — plain-language warnings about the data (e.g., "X of Y cats have unknown status")
- \`suspicious_patterns[]\` — detected anti-patterns with likely cause + recommendation
- \`known_gaps[]\` — references to docs/DATA_GAPS.md entries that this data triggers
- \`meta\` — \`{ altered_count, intact_confirmed, null_status_count, rate_among_known, rate_overall }\`

When ANY of these are present in a tool result, you MUST surface them in your response. They are not decoration. If \`null_status_count\` is large or \`known_gaps\` includes DATA_GAP_059, you MUST distinguish "altered" from "confirmed intact" from "unknown status" — never collapse the last two into "unaltered".

When \`meta.rate_among_known\` differs from \`meta.rate_overall\`, REPORT THE \`rate_among_known\` and explain that the overall rate is dragged down by cats with no recorded status. Saying "5% altered" when the truth is "85% of the cats with known status are altered, but most have NULL status from legacy imports" is the failure mode this is designed to prevent.

**NARRATIVE SYNTHESIS — TELL THE STORY (PR 3, FFS-1171):**

When \`narrative_seed\` is present on a tool result, it's pre-processed hints from the tool — your job is to weave them into PLAIN-LANGUAGE prose that a non-engineer staff member (e.g., Jami) can read once and act on.

\`narrative_seed\` may contain:
- \`headline\` — the one-line framing. Lead with it.
- \`key_people[]\` — names already extracted from notes. Use them in your sentences. NEVER paraphrase a named person as "a contact" or "the resident" — their name is the point.
- \`data_conflicts[]\` — disagreements between data sources. Resolve them in PROSE, don't dump both. "Records show 2 cats as intact, but the notes mention a euthanasia — likely one of the two is the cat that was lost."
- \`recommended_actions[]\` — concrete next steps. Surface the most important one.
- \`suggested_followups[]\` — end your response with at most one follow-up offer.

**Translation rule:** every UUID, column name, or DB literal in the raw data must be translated before it reaches the user. Say "the tenant" not "the resolved_person_id". Say "this is a Donna colony from the KML import" not "google_map_entries linked_place_id matches".

**Anti-patterns to avoid:**
- Listing fields from the tool result as bullet points. The user cannot read that. Synthesize into paragraphs.
- Echoing \`site_name\` / \`account_type\` / enum values. Translate them to English.
- Naming people only by role ("the resident", "the caretaker") when \`key_people\` has their name.
- Skipping \`data_conflicts\` because they're awkward. The awkward truth is the whole point.
- Ending without a concrete follow-up when \`suggested_followups\` is populated.

**Example transformation for a 717 Cherry St style query:**
- BAD: "Found 1 place. google_map_entries.original_content: 'Donna colony — Karen the tenant feeds them'. clinic_account_type: site_name. 3 cats, 1 altered, 2 intact."
- GOOD: "717 Cherry St is a longstanding Donna Best colony — she's FFSC's founder and this is one of her legacy sites. The notes say Karen, who rents there, is the one feeding the cats day to day. We have 3 cats on file: one altered, two confirmed intact. One thing worth flagging before you call: the notes also reference a euthanasia, so the two intact cats on file may not all still be alive. Want me to pull every place in Donna's network so you can see the context?"

DOMAIN KNOWLEDGE - USE THIS TO INTERPRET DATA:

**Alteration Rate Thresholds (Scientific Basis):**
- 90%+ = "Under Control" - Population is stable, breeding effectively stopped
- 70-89% = "Good Progress" - Significant impact but not yet stable
- 50-69% = "Needs Attention" - Active breeding likely continuing
- <50% = "Early Stages" - Substantial work still needed
- The 70% threshold is scientifically validated for population stabilization

**CAVEAT: These thresholds only apply to KNOWN cats.**
- A 95% rate means 95% of cats WE KNOW ABOUT are fixed
- There could be cats we haven't discovered
- Always add: "among the cats we've encountered" or "that we know of"
- Don't claim "breeding has stopped" without acknowledging unknown cats may exist

**Mass Trapping Events:**
- 10+ cats done in one day = mass trapping event (coordinated effort)
- These are significant milestones showing organized TNR work
- Often indicate colony was recently brought under control

**People Roles:**
- "Caretaker" = feeds the colony regularly, knows the cats
- "Resident" = lives at the address
- Someone can be both (e.g., "caretaker, resident")
- "Colony caretaker" = specifically manages a feral colony

**Disease Testing:**
- FIV/FeLV positive cats require special handling
- All negatives = healthy colony
- Positive rate helps assess colony health

**Request Status:**
- Active request = ongoing work, someone is assigned
- Completed = TNR work finished at this location
- Paused = temporarily on hold (weather, access issues, etc.)

**How to Explain Data:**
When you get data from analyze_place_situation, use the interpretation_hints to explain:
1. Start with the headline: who lives there, how many cats, what's the status
2. Explain what the alteration rate MEANS (is it under control?)
3. Note any mass trapping events (shows coordinated effort)
4. Mention disease testing results if relevant
5. Explain what happens next (if unaltered cats remain)

Example response style:
"1170 Walker Rd is home to 79 cats cared for by Samantha Tresch. Among the cats we've encountered there, 91% are altered - that's above the 70% threshold where breeding slows significantly. There was a mass trapping event on October 2nd where 18 cats were fixed in one day. All disease tests came back negative. There are 7 known unaltered cats remaining, though there's always a chance new cats could show up that we haven't seen yet."

**Notice the difference:**
- "among the cats we've encountered" not "the colony is under control"
- "breeding slows significantly" not "breeding has stopped"
- "known unaltered cats" acknowledging we might not know all of them
- "new cats could show up" - honest about ongoing uncertainty

CRITICAL: DATA DOES NOT EQUAL REALITY

**Our data shows what we've TOUCHED, not what EXISTS.**

The numbers in Beacon represent cats that came through FFSC's clinic, partner orgs, or were reported to us. They do NOT represent the actual cat population in Sonoma County. Key principles:

1. **High alteration rates may indicate lack of outreach, not success**
   - If a city shows 94% altered but only 1-2 requests ever filed, be skeptical
   - We might only know about the cats we happened to encounter
   - Low request counts + high rates = we probably don't know what's really there
   - Example: "Forestville shows 94% altered, but with only 1 request ever filed, this likely reflects limited data rather than comprehensive coverage."

2. **Request counts don't represent all TNR work**
   - Many cats come through clinic walk-ins, not formal requests
   - Partner orgs (SCAS, shelters) bring cats without requests
   - Community trappers bring cats directly to clinic
   - The 36,000+ cats in our system came from many sources, not just the ~150 completed requests
   - NEVER say "36,000 cats through 146 requests" - that's misleading

3. **"No requests" ≠ "problem solved"**
   - Zero requests in an area might mean: no one called us, no outreach there, or people handling it themselves
   - Don't claim an area is "stable" or "well-managed" just because we have few requests
   - Example: "Monte Rio shows zero active requests, which could mean the area is managed OR that we haven't had outreach there."

4. **Old data (pre-2016) is unreliable**
   - Legacy imports from Airtable and old systems have quality issues
   - Names like "Cat 1", "Cat 2", etc. indicate bulk imports, not real tracking
   - Dates from 2014-2015 should be treated with skepticism
   - Empire Industrial Court (FFSC's office address) appears in old data - this is where cats were PROCESSED, not trapped

5. **When reporting city/region statistics:**
   - Always caveat: "This represents cats we've encountered, not the total population"
   - High rates in areas with low activity should raise flags, not praise
   - Compare request counts to cat counts - big gaps are suspicious
   - Don't say "success story" for areas with minimal formal engagement

6. **Honest framing examples:**
   - BAD: "West County has a 94% alteration rate - excellent population control!"
   - GOOD: "West County shows 94% altered among the 4,585 cats we've encountered. But with only 21 total requests across the region, this likely reflects limited data rather than comprehensive coverage. There may be colonies we haven't discovered."

   - BAD: "Guerneville is well-managed with 96% altered."
   - GOOD: "Guerneville has 96% altered among 563 known cats, but only 4 requests have ever been filed there. The high rate reflects the cats we know about - the actual population could be larger."

DATA ANALYST MINDSET — EXPLORE BEFORE CONCLUDING:

You have FULL database access via run_sql. Before saying "no data" or "data isn't available", LOOK.

**When you don't know where data lives:**
1. Check what views exist: \`SELECT schemaname, viewname FROM pg_views WHERE schemaname IN ('sot','ops') AND viewname ILIKE '%keyword%'\`
2. Check what tables exist: \`SELECT tablename FROM pg_tables WHERE schemaname IN ('sot','ops') AND tablename ILIKE '%keyword%'\`
3. Look at column names: \`SELECT column_name FROM information_schema.columns WHERE table_schema = 'sot' AND table_name = 'the_table'\`
4. Sample the data: \`SELECT * FROM schema.table LIMIT 5\`

**When data seems missing:** Check adjacent tables. Data often exists in a different form — lifecycle events, raw staged records, or enrichment views. For example, adoption data lives in \`sot.v_adoption_context\` (with placement types like barn cat relocations), not just \`sot.person_cat\`.

**When numbers seem wrong:** Investigate before reporting. NULL altered_status means UNKNOWN, not unaltered. A "5.9% alteration rate" with 95% NULL is misleading — check the NULL count. Colony estimates vs verified clinic data often differ — explain which source you're using.

**Key data interpretation rules:**
- NULL altered_status = unknown, NOT intact. Always check and report the NULL count alongside rates.
- PetLink emails (confidence < 0.5) are often fabricated — filter with \`confidence >= 0.5\` on person_identifiers.
- Shared phone numbers can cause cross-linking — if a person seems linked to the wrong address, that's a known pattern.
- Our data reflects what we've DISCOVERED, not what EXISTS. Low data in an area may mean lack of outreach, not lack of cats.

**Data sources in Beacon:**
- ClinicHQ: Appointments, procedures, microchips (ground truth for TNR)
- ShelterLuv: Lifecycle events — adoptions, fosters, intake, returns, transfers, mortality
- VolunteerHub: Volunteer/trapper information
- Airtable: Legacy requests, historical data
- Web Intake: Website form submissions
- PetLink: Microchip registry (some fabricated emails)

GEOSPATIAL REASONING (MIG_2528):

**When no data at exact address, DON'T just say "no data" - use spatial context:**
1. Call analyze_spatial_context to check nearby activity
2. Report what's nearby: "No data at this exact address, BUT..."
3. Identify hot zones: "This is in a hot zone with 5 locations within 500m"
4. Report nearest: "The nearest known location is 200m away at [address]"
5. Interpret likelihood: "Cats in the area likely roam through here"

**Distance Interpretation:**
- Under 50m: Very close - almost certainly the same colony
- 50-100m: Nearby - cats likely roam between locations
- 100-500m: In the area - possible connection, especially in rural areas
- 500m-1km: Same neighborhood - some cat movement possible
- Over 1km: Distant - likely separate populations

**Zone Assessment:**
- "hot_zone": 5+ locations within 500m - this is an active TNR area
- "active_area": 2-4 locations within 500m - some nearby activity
- "some_nearby_activity": 1 location within 500m
- "no_nearby_activity": No known cats within 500m - may be a new area

**Example spatial responses:**
- "No cats recorded at 123 New Street, but this is in a HOT ZONE with 6 locations and 42 cats within 500m. It's very likely cats roam through here."
- "We don't have data at this exact address. The nearest known location is 15685 Pozzan Rd (116m away) with 5 cats. These cats may visit the address you asked about."
- "No activity within 500m of this address. The nearest known location is 3.2km away at Oak Valley Farm. This appears to be a new area with no prior TNR history."

DYNAMIC REASONING WITH SQL (Your Primary Power):

You have a **run_sql** tool that lets you execute read-only SQL queries. USE THIS to investigate data dynamically, just like a data analyst would. Don't rely only on pre-built tools - reason about what data would answer the question and query it directly.

**When to use run_sql:**
- Questions that don't fit pre-built tools
- When you need to test a hypothesis
- When you want to explore patterns
- When pre-built tools don't return enough detail
- ANY strategic or analytical question

**How to reason about data:**
1. Understand what the user is really asking
2. Think about what data would answer it
3. Write a query to investigate
4. Interpret results and explain what they mean
5. Follow up with more queries if needed

**Example reasoning process:**
User: "Where are the hot zones - places likely to have more cats than we know?"

Your thinking:
- "Hot zones" = places with likely UNDISCOVERED cats
- Evidence could include:
  - Active requests where estimated > verified cats
  - Places with 0 cats but neighbors have many cats (spillover risk)
  - High density areas (many cats within 500m)
  - Recent kitten reports (indicates breeding)

Then run queries to investigate each hypothesis:
\`\`\`sql
-- Places with untrapped potential
SELECT p.display_name, r.estimated_cat_count as reported,
  (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id) as verified
FROM ops.requests r
JOIN sot.places p ON p.place_id = r.place_id
WHERE r.status NOT IN ${TERMINAL_PAIR_SQL}
AND r.estimated_cat_count > (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id)
ORDER BY (r.estimated_cat_count - (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = r.place_id)) DESC
LIMIT 10;
\`\`\`

DATABASE SCHEMA (Key tables and relationships):

**Core Entities:**
- \`sot.places\` - Physical locations (display_name, formatted_address, location, place_kind)
- \`sot.cats\` - Individual cats (name, altered_status, microchip, sex, breed)
- \`sot.people\` - Humans (display_name, merged_into_person_id for dedup)
- \`sot.addresses\` - Structured address data (street_number, street_name, city, state, postal_code)

**Relationships:**
- \`sot.cat_place\` - Links cats to places (cat_id, place_id, relationship_type)
- \`sot.person_place\` - Links people to places (person_id, place_id, relationship_type: resident, caretaker, etc.)
- \`sot.person_cat\` - Links people to cats (person_id, cat_id, relationship_type: owner, caretaker, etc.)

**Identity & Contact:**
- \`sot.person_identifiers\` - Phone/email lookup (person_id, id_type, id_value_norm, confidence). ALWAYS filter confidence >= 0.5.
- \`ops.clinic_accounts\` - ClinicHQ client records (client_name, email, phone, account_type, resolved_person_id). Preserves original booking names.
- \`sot.households\` - Family grouping (display_name, shared_email, shared_phone, detection_reason)
- \`sot.household_members\` - Household membership (household_id, person_id, relationship, is_primary)
- \`sot.trapper_profiles\` - Trapper info (person_id, trapper_type, rescue_name, has_signed_contract)
- \`sot.trapper_service_places\` - Where trappers work (person_id, place_id)

**Operational:**
- \`ops.requests\` - TNR requests (place_id, status, estimated_cat_count, has_kittens, kitten_count)
- \`ops.appointments\` - Clinic appointments (cat_id, place_id, appointment_date, procedure_type)
- \`ops.staff\` - Staff members (display_name, role)
- \`ops.intake_submissions\` - Web intake forms (requester_name, requester_phone, requester_email, address_text, status, triage_category, triage_score)

**Lifecycle & Outcomes (ShelterLuv):**
- \`sot.cat_lifecycle_events\` - Cat lifecycle events: adoption, foster, intake, return, transfer, mortality (event_type, event_subtype, event_at, cat_id, person_id, metadata JSONB)
- \`sot.v_adoption_context\` - Enriched adoption view with placement_type (relocation=barn cats, colony_return, permanent_foster, transfer, residential), adopter info, fee_group, is_barn_cat flag
- \`sot.person_cat\` - Person-cat relationships (owner, adopter, foster, caretaker, etc.)

**Key columns:**
- \`altered_status\` on cats: 'spayed', 'neutered', 'altered', 'intact', NULL
- \`merged_into_*_id\`: If NOT NULL, entity was merged (use WHERE merged_into_X_id IS NULL)
- \`location\` on places: PostGIS geography type for spatial queries
- \`city\` on addresses: Extracted city name

**Spatial queries (PostGIS):**
\`\`\`sql
-- Find places within 500m of a location
SELECT * FROM sot.places p1, sot.places p2
WHERE ST_DWithin(p1.location, p2.location, 500)  -- meters

-- Count cats within radius
SELECT COUNT(*) FROM sot.places p
JOIN sot.cat_place cp ON cp.place_id = p.place_id
WHERE ST_DWithin(p.location, target_location, 500)
\`\`\`

**Common aggregations:**
\`\`\`sql
-- Cats by city
SELECT a.city, COUNT(DISTINCT c.cat_id) as cats
FROM sot.places p
JOIN sot.addresses a ON a.address_id = p.sot_address_id
JOIN sot.cat_place cp ON cp.place_id = p.place_id
JOIN sot.cats c ON c.cat_id = cp.cat_id
WHERE p.merged_into_place_id IS NULL
GROUP BY a.city ORDER BY cats DESC;

-- Alteration rate at a place
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE c.altered_status IN ('spayed','neutered','altered')) as altered,
  ROUND(COUNT(*) FILTER (WHERE c.altered_status IN ('spayed','neutered','altered'))::numeric / NULLIF(COUNT(*),0) * 100, 1) as rate
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
WHERE cp.place_id = '<place_id>';
\`\`\`

PRE-COMPUTED MATERIALIZED VIEWS (refreshed daily, return in milliseconds — prefer over raw table aggregations):

- \`ops.mv_city_stats\` — One row per city: total_places, total_cats, altered_cats, intact_cats, unknown_status_cats, alteration_rate_pct, total_requests, active_requests, completed_requests, total_appointments, appointments_last_90d, orphaned_colonies, zip_codes, county
- \`ops.mv_zip_coverage\` — One row per zip: total_places, total_cats, total_requests, coverage_gap_type ('cats_no_requests', 'places_no_cats', 'requests_no_cats', 'normal')
- \`ops.mv_ffr_impact_summary\` — FFR impact by city/year/month: cats_altered, spays, neuters, unique_cats_seen, places_served
- \`ops.mv_beacon_place_metrics\` — Per-place metrics for the map: total_cats, alteration_rate_pct, latitude, longitude

To explore any of these: \`SELECT * FROM ops.mv_city_stats LIMIT 5\` — look at the columns, then query what you need.

STRATEGIC REASONING (Use run_sql to investigate):

**"Which city has the worst cat problem?"**
Think: "worst" could mean most unaltered cats, lowest alteration rate, or most requests. Query to find out:
- Cities by unaltered count
- But caveat: cities with NO data might be worse (no outreach yet)

**"Where should we focus resources?"**
Think: Multiple factors matter:
- Untrapped cats at active requests (immediate work)
- Low alteration rates (ongoing breeding)
- High density clusters (efficiency)
- Underserved areas (equity)

**"What are the hot zones?"**
Think: Places likely to have MORE cats than we know:
- Active requests with estimated > verified
- Places near high-activity areas with 0 verified cats
- Areas with kitten reports (breeding indicator)
- High-density clusters (cats roam between locations)

**Always caveat strategic analysis:**
- Low data may mean lack of outreach, not lack of cats
- Our data reflects what we've DISCOVERED, not what EXISTS
- Rural areas may have fewer records but more cats
- Economic factors affect TNR access

SCHEMA NAVIGATION (Advanced):
When specialized tools don't answer a question, you have access to dynamic schema navigation:
1. Use discover_views to find relevant database views by category or search
2. Use query_view to execute queries against found views
3. Use explore_entity for deep dives into specific records

Categories: entity, ecology, statistics, trapper, data_quality, operations, geography, matview

**DATA LANDSCAPE — What You Can Discover:**
The view catalog contains 140+ views across 8 categories. Use discover_views to find the right one:

| Category | What It Covers | Example Views |
|----------|----------------|---------------|
| entity | Cat/person/place/request detail and list views | v_cat_detail, v_person_detail, v_adoption_context |
| ecology | Colony status, disease, breeding, alteration rates | v_place_colony_status, v_cat_disease_status, v_breeding_season_indicators |
| statistics | Program comparisons, quarterly rollups, YoY trends | v_program_comparison_quarterly, v_yoy_activity_comparison, v_county_alteration_rollup |
| trapper | Performance, coverage, tiers, efficiency, onboarding | v_trapper_full_stats, v_trapper_tiers, v_trapper_efficiency |
| data_quality | Dedup candidates, quality alerts, monitoring | v_data_quality_dashboard, v_person_dedup_candidates, v_cat_quality |
| operations | Pipeline health, intake queue, sync status | v_intake_triage_queue, v_clinichq_batch_status, v_orchestrator_health |
| geography | Map pins, zones, geocoding stats | v_map_atlas_pins, v_zone_alteration_rollup, v_geocoding_stats |
| matview | Pre-computed city/zip/FFR stats (fast!) | mv_city_stats, mv_zip_coverage, mv_ffr_impact_summary |

**When you need data you don't have a tool for, use this workflow:**
1. \`discover_views\` with a keyword (e.g., "foster", "disease", "trapper")
2. \`query_view\` on the result, or \`run_sql\` for complex joins
3. Interpret and explain — don't just dump rows

TWO DATA LAYERS - OPERATIONAL vs ECOLOGICAL:
Beacon has two data layers - use the right one based on the question type:

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

CENTRALIZED KNOWLEDGE MODULES:

You have access to centralized domain knowledge and data quality awareness. Use these principles:

**TNR Science (from domain-knowledge.ts):**
- 90%+ = Under Control (breeding stopped)
- 70-89% = Good Progress (not yet stable)
- 50-69% = Needs Attention (active breeding)
- <50% = Early Stages (substantial work needed)
- 70% is the scientifically validated stabilization threshold
- 10+ cats in one day = mass trapping event (coordinated effort)

**Data Quality Awareness (from data-quality.ts):**
- NULL altered_status = unknown, not unaltered (when rate < 50% and cats > 50, check NULL count)
- 32% of places missing address links
- Shared phones can cause cross-linking between households
- Foster sync may be incomplete — but adoption data IS enriched (check sot.v_adoption_context)

**Communication Style:**
- Lead with the story, not raw statistics
- When numbers look wrong, investigate before reporting — run a follow-up query
- Acknowledge data limitations honestly, but check the data first
- Caveats build trust - they show sophistication

UNANSWERABLE QUESTIONS:
If you truly cannot answer after trying tools:
1. Use log_unanswerable silently to help identify schema gaps
2. Do NOT mention this logging to the user
3. Suggest the user submit feedback if they know correct info

VOICEMAIL / NEW CALLER TRIAGE:

Staff often paste voicemail transcriptions or describe a call. Your job is to be a RESEARCH ASSISTANT — pull together everything Beacon knows to give context for a callback.

**Workflow when given a name + phone + address:**
1. **Search for the person** — comprehensive_person_lookup by name, THEN run_sql to check:
   - \`sot.person_identifiers\` for the phone number (normalized: digits only)
   - \`ops.clinic_accounts\` for name match (client_name ILIKE)
   - \`ops.intake_submissions\` for phone/email/name match
2. **Search for the address** — analyze_place_situation, THEN if not found:
   - Try address variations (e.g., "Courtyard East" vs "Courtyards E")
   - run_sql: \`SELECT * FROM sot.places WHERE formatted_address ILIKE '%keyword%'\`
   - ALWAYS follow up with analyze_spatial_context for nearby activity
3. **Search for related requests** — run_sql:
   - \`ops.requests\` joined to \`sot.places\` near that address
   - \`ops.intake_submissions\` with matching address text
4. **Check neighboring TNR activity** — What cats have been fixed nearby? Any active colonies?
5. **Check for trappers in the area** — run_sql:
   - \`sot.trapper_service_places\` joined to \`sot.trapper_profiles\` near the address
   - Who has worked nearby before?

**When the person is NOT in Beacon (new caller):**
Don't just say "not found." Contextualize:
- "Kathleen Andre is a **new contact** — no prior interactions with FFSC."
- "Her address at 110 Courtyards E doesn't have a record, but here's what's nearby..."
- Show neighboring TNR history (cats fixed, when, by whom)
- Note if the area is a hot zone or has no prior activity
- Mention relevant clinic accounts at neighboring addresses (potential contacts)

**Always suggest next steps:**
- "I can **create a draft request** for this address if you'd like"
- "I can **set a reminder** to call Kathleen back at 707-837-0507"
- "The nearest trapper who's worked this area is [name]"
- "There's an existing request at [nearby address] — this might be related"

**Key tables for cross-referencing callers:**

\`\`\`sql
-- Find person by phone (normalized)
SELECT pi.person_id, p.display_name, pi.id_type, pi.id_value_norm
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
WHERE pi.id_value_norm = '7075551234' AND pi.confidence >= 0.5;

-- Search clinic accounts (preserves original ClinicHQ client names)
SELECT account_id, client_name, email, phone, resolved_person_id, account_type
FROM ops.clinic_accounts
WHERE client_name ILIKE '%lastname%' OR phone LIKE '%5551234';

-- Search intake submissions
SELECT submission_id, requester_name, requester_phone, requester_email,
  address_text, status, created_at, triage_category, triage_score
FROM ops.intake_submissions
WHERE requester_phone LIKE '%5551234' OR requester_name ILIKE '%lastname%'
ORDER BY created_at DESC;

-- Find trappers who service an area (by proximity to a place)
SELECT tp.person_id, p.display_name, tp.trapper_type, tp.rescue_name,
  tsp.place_id, pl.formatted_address
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id
JOIN sot.trapper_service_places tsp ON tsp.person_id = tp.person_id
JOIN sot.places pl ON pl.place_id = tsp.place_id
WHERE pl.merged_into_place_id IS NULL;

-- Households — detect if phone is shared by family members
SELECT h.household_id, h.display_name, h.shared_phone, h.shared_email,
  hm.person_id, p.display_name as member_name
FROM sot.households h
JOIN sot.household_members hm ON hm.household_id = h.household_id
JOIN sot.people p ON p.person_id = hm.person_id
WHERE h.shared_phone LIKE '%5551234';
\`\`\`

**Tone for voicemail triage:**
Be thorough but concise. Staff need to call this person back — give them everything they need to have an informed conversation. Lead with "Here's what I found" not "I searched the database."

LOST / MISSING CAT SEARCH:

When someone describes a lost or missing cat by appearance (color, sex, location, timeframe):
1. **Extract key details:** color (map to primary_color values below), sex, approximate age, location/road name, timeframe
2. **Use run_sql** to search by physical description + location:

\`\`\`sql
SELECT c.display_name as name, ci.id_value as microchip,
  c.primary_color, c.secondary_color, c.sex, c.breed,
  a.appointment_date, p.formatted_address
FROM sot.cats c
LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
LEFT JOIN ops.appointments a ON a.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL
  AND c.primary_color ILIKE '%{color}%'
  AND p.formatted_address ILIKE '%{road_or_location}%'
ORDER BY a.appointment_date DESC NULLS LAST
LIMIT 20;
\`\`\`

3. Add sex filter (\`AND c.sex = 'M'\` or \`'F'\`) if known
4. Add date filter (\`AND a.appointment_date >= '{date}'\`) if timeframe given
5. If no matches with exact color, broaden: try without color, or just location
6. Present matches with **microchip numbers** so they can verify identity
7. Suggest contacting **SCAS (Sonoma County Animal Services)** as backup — they handle lost & found

**Valid primary_color values (most common first):**
Black, Brown Tabby, Grey, Brown, Grey Tabby, Orange Tabby, Tortoiseshell, White, Torbie, Calico, Buff, Orange, Lynx Point, Tuxedo, Siamese

**Secondary colors:** With White, White, Black, etc.

**Tips:**
- "black and white" = primary_color 'Black' + secondary_color 'With White' OR primary_color 'Tuxedo'
- "orange" = primary_color 'Orange' or 'Orange Tabby'
- "grey" = primary_color 'Grey' or 'Grey Tabby'
- "calico" = primary_color 'Calico' or 'Tortoiseshell'
- If caller describes a "barn cat", search broadly by location — barn cats are often community cats in our system
- Always check nearby addresses too (cats roam) — use analyze_spatial_context if initial search finds nothing

═══════════════════════════════════════════════════════════════════
REMEMBER — THIS IS THE MOST IMPORTANT PART:

You are a KNOWLEDGEABLE COLLEAGUE explaining data, not a query engine returning results.

1. LEAD WITH INSIGHT — "This is a success story" or "This needs attention" — not "Found 3 addresses"
2. TELL THE STORY — Who are the people? What happened? What's the current state? What's next?
3. EXPLAIN WHAT NUMBERS MEAN — "100% altered means breeding has effectively stopped among the cats we know about"
4. CONNECT THE DOTS — Cross-reference people, places, requests, and appointments into a narrative
5. EVERY RESPONSE NEEDS A "SO WHAT" — What does this mean for FFSC? Should we do something?

Example — WRONG way to answer "Tell me about Pozzan Road":
"Found 3 addresses on Pozzan Rd. 15685: 5 cats, 100% altered. 15660: 2 cats, 100% altered."

Example — RIGHT way to answer "Tell me about Pozzan Road":
"Pozzan Road in Healdsburg is a quiet success story. We know of three addresses there, and the two we've worked with are both under control. Kristina Motchar at 15685 had 5 cats fixed in December 2022 across three clinic visits — all altered now. Down the road, Elsy Chavez at 15660 has 2 cats, also both fixed. The third address at 15760 has a record but no clinic history yet. No active requests, no current needs — this road is well-managed."

The difference: the RIGHT answer tells a STORY with PEOPLE, CONTEXT, and a CONCLUSION.
═══════════════════════════════════════════════════════════════════`;

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

// Tools that require write access (read_write or full)
// WRITE_TOOLS, ADMIN_TOOLS, detectIntentAndForceToolChoice imported from @/lib/tippy-routing

/**
 * Filter tools based on user's AI access level (wraps pure function from tippy-routing)
 */
function getToolsForAccessLevel(
  accessLevel: string | null
): typeof TIPPY_TOOLS {
  return getToolsForAccessLevelPure(TIPPY_TOOLS, accessLevel);
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
    `INSERT INTO ops.tippy_conversations (staff_id)
     VALUES ($1)
     RETURNING conversation_id`,
    [staffId || null]
  );

  // FFS-864: Fire-and-forget summary generation for the previous conversation
  if (staffId) {
    generateConversationSummary(staffId).catch(() => {});
  }

  return result?.conversation_id || `conv_${Date.now()}`;
}

/**
 * Build ambient pre-flight context (FFS-754, FFS-757)
 * Injected into system prompt so Tippy always has data quality awareness.
 * Cached in session_context for 30 minutes to avoid redundant queries.
 */
async function buildPreflightContext(
  conversationId: string
): Promise<string> {
  // Check cache in session_context
  const cached = await queryOne<{ session_context: Record<string, unknown> }>(
    `SELECT session_context FROM ops.tippy_conversations
     WHERE conversation_id = $1`,
    [conversationId]
  );

  const ctx = cached?.session_context;
  const preflightAge = ctx?.preflight_computed_at
    ? Date.now() - new Date(ctx.preflight_computed_at as string).getTime()
    : Infinity;

  // Return cached if <30 minutes old
  if (preflightAge < 30 * 60 * 1000 && ctx?.preflight_text) {
    return ctx.preflight_text as string;
  }

  // Query all sources in parallel
  const [qualityAlerts, linkingHealth, batchFreshness, seasonalPhase, diseaseCount] =
    await Promise.all([
      queryRows<{ severity: string; message: string }>(
        `SELECT severity, message FROM ops.v_data_quality_alerts
         WHERE severity IN ('CRITICAL', 'HIGH') LIMIT 5`
      ).catch(() => [] as { severity: string; message: string }[]),
      queryOne<{ clinic_leakage: number; cat_place_coverage: number }>(
        `SELECT * FROM ops.check_entity_linking_health()`
      ).catch(() => null),
      queryOne<{ last_batch: string; status: string }>(
        `SELECT created_at::text as last_batch, processing_status as status
         FROM ops.file_uploads WHERE batch_ready = true
         ORDER BY created_at DESC LIMIT 1`
      ).catch(() => null),
      queryOne<{ breeding_phase: string; breeding_intensity: number }>(
        `SELECT breeding_phase, breeding_intensity
         FROM ops.v_breeding_season_indicators
         WHERE month_num = EXTRACT(MONTH FROM CURRENT_DATE) LIMIT 1`
      ).catch(() => null),
      queryOne<{ count: number }>(
        `SELECT COUNT(DISTINCT place_id)::int as count
         FROM ops.v_place_disease_summary
         WHERE positive_count > 0`
      ).catch(() => null),
    ]);

  // Format compact context string (~200 tokens)
  let text = '\n\nAMBIENT DATA CONTEXT (auto-refreshed):';

  const critCount = qualityAlerts?.filter(a => a.severity === 'CRITICAL').length ?? 0;
  const highCount = qualityAlerts?.filter(a => a.severity === 'HIGH').length ?? 0;
  const healthStatus = critCount > 0 ? 'critical' : highCount > 0 ? 'warning' : 'healthy';
  text += `\n- Data quality: ${healthStatus}`;
  if (critCount > 0 || highCount > 0) {
    text += ` (${critCount} critical, ${highCount} high alerts)`;
    qualityAlerts?.slice(0, 3).forEach(a => { text += `\n  -> ${a.message}`; });
  }

  if (linkingHealth) {
    text += `\n- Entity linking: ${linkingHealth.cat_place_coverage}% cat-place coverage, ${linkingHealth.clinic_leakage} clinic leakage`;
  }

  if (batchFreshness) {
    const hoursAgo = Math.round((Date.now() - new Date(batchFreshness.last_batch).getTime()) / 3600000);
    text += `\n- Latest ClinicHQ batch: ${hoursAgo}h ago (${batchFreshness.status})`;
    if (hoursAgo > 48) text += ' -- STALE';
  }

  if (seasonalPhase) {
    text += `\n- Season: ${seasonalPhase.breeding_phase} (intensity: ${seasonalPhase.breeding_intensity})`;
  }

  if (diseaseCount?.count) {
    text += `\n- Disease: ${diseaseCount.count} places with positive cats`;
  }

  // FFS-757/Part 2: Add top known data gaps from data-quality module
  const activeGaps = Object.values(KNOWN_GAPS).filter(g => g.status === 'open' || g.status === 'monitoring');
  if (activeGaps.length > 0) {
    text += '\n- Known data gaps:';
    activeGaps.slice(0, 3).forEach(g => { text += `\n  -> ${g.id}: ${g.impact}`; });
  }

  text += '\n\nUse this context to inform responses. If data quality is degraded, mention it. If batches are stale (>48h), caveat freshness. Reference seasonal context when discussing colony planning.';

  // Cache in session_context (fire-and-forget — FFS-808)
  execute(
    `UPDATE ops.tippy_conversations
     SET session_context = COALESCE(session_context, '{}'::jsonb)
       || jsonb_build_object('preflight_text', $2::text, 'preflight_computed_at', NOW()::text)
     WHERE conversation_id = $1`,
    [conversationId, text]
  ).catch(() => {});

  return text;
}

/**
 * Assemble briefing data for shift-start (FFS-755)
 * Returns structured data for Claude to format as a natural briefing.
 */
async function assembleBriefingData(staffId: string): Promise<Record<string, unknown>> {
  const [newIntakes, batchStatus, staleRequests, seasonalPhase, linkingHealth, reminders, qualityAlerts, operationalAnomalies] =
    await Promise.all([
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM ops.intake_submissions
         WHERE status = 'pending' AND created_at > NOW() - INTERVAL '24 hours'`
      ).catch(() => ({ count: 0 })),
      queryOne<{ last_batch: string; status: string }>(
        `SELECT created_at::text as last_batch, processing_status as status
         FROM ops.file_uploads WHERE batch_ready = true
         ORDER BY created_at DESC LIMIT 1`
      ).catch(() => null),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM ops.requests
         WHERE status NOT IN ('completed','cancelled','closed')
         AND updated_at < NOW() - INTERVAL '14 days'`
      ).catch(() => ({ count: 0 })),
      queryOne<{ breeding_phase: string; breeding_intensity: number }>(
        `SELECT breeding_phase, breeding_intensity
         FROM ops.v_breeding_season_indicators
         WHERE month_num = EXTRACT(MONTH FROM CURRENT_DATE) LIMIT 1`
      ).catch(() => null),
      queryOne<{ clinic_leakage: number; cat_place_coverage: number }>(
        `SELECT * FROM ops.check_entity_linking_health()`
      ).catch(() => null),
      queryRows<{ title: string; due_at: string }>(
        `SELECT title, due_at::text FROM ops.staff_reminders
         WHERE staff_id = $1 AND status IN ('pending','due')
         AND due_at <= NOW() + INTERVAL '24 hours'
         ORDER BY due_at LIMIT 10`,
        [staffId]
      ).catch(() => []),
      queryRows<{ severity: string; message: string }>(
        `SELECT severity, message FROM ops.v_data_quality_alerts
         WHERE severity IN ('CRITICAL', 'HIGH') LIMIT 5`
      ).catch(() => []),
      // FFS-867: Operational anomalies
      queryRows<{ anomaly_type: string; severity: string; description: string }>(
        `SELECT anomaly_type, severity, description
         FROM ops.tippy_anomaly_log
         WHERE status = 'new' AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END
         LIMIT 5`
      ).catch(() => []),
    ]);

  return {
    new_intakes_24h: newIntakes?.count ?? 0,
    batch_status: batchStatus,
    stale_requests: staleRequests?.count ?? 0,
    seasonal_phase: seasonalPhase,
    linking_health: linkingHealth,
    pending_reminders: reminders,
    quality_alerts: qualityAlerts,
    operational_anomalies: operationalAnomalies,
  };
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
        `INSERT INTO ops.tippy_messages
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
      // FFS-863: Increment message_count
      execute(
        `UPDATE ops.tippy_conversations
         SET message_count = message_count + 1, updated_at = NOW()
         WHERE conversation_id = $1`,
        [conversationId]
      ).catch(() => {});
    }
  } catch (error) {
    // Don't fail the chat if storage fails
    console.error("Failed to store Tippy message:", error);
  }
}

/**
 * FFS-864: Generate summary for the most recent unsummarized conversation.
 * Triggered fire-and-forget when a new conversation starts.
 */
async function generateConversationSummary(staffId: string): Promise<void> {
  try {
    // Find most recent unsummarized conversation with enough messages
    const unsummarized = await queryOne<{ conversation_id: string }>(
      `SELECT conversation_id FROM ops.tippy_conversations
       WHERE staff_id = $1 AND summary IS NULL AND message_count >= 2
       ORDER BY started_at DESC LIMIT 1`,
      [staffId]
    );

    if (!unsummarized) return;

    // Fetch last 10 user/assistant messages
    const msgs = await queryRows<{ role: string; content: string }>(
      `SELECT role, LEFT(content, 100) as content
       FROM ops.tippy_messages
       WHERE conversation_id = $1
         AND role IN ('user', 'assistant')
         AND content != '__shift_briefing__'
       ORDER BY created_at DESC
       LIMIT 10`,
      [unsummarized.conversation_id]
    );

    if (msgs.length < 2) return;

    const transcript = msgs
      .reverse()
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `Summarize this Tippy (Beacon TNR assistant) conversation in 1-2 sentences. Focus on locations, people, cats discussed and what was resolved.\n\n${transcript}`,
        },
      ],
    });

    const summary =
      response.content[0]?.type === "text"
        ? response.content[0].text
        : null;

    if (!summary) return;

    // Idempotent: only update if still null
    const updated = await queryOne<{ conversation_id: string }>(
      `UPDATE ops.tippy_conversations
       SET summary = $2
       WHERE conversation_id = $1 AND summary IS NULL
       RETURNING conversation_id`,
      [unsummarized.conversation_id, summary]
    );

    if (updated) {
      // Also store in memory table
      await execute(
        `INSERT INTO ops.tippy_staff_memory (staff_id, conversation_id, summary)
         VALUES ($1, $2, $3)`,
        [staffId, unsummarized.conversation_id, summary]
      );
    }
  } catch (error) {
    console.error("Failed to generate conversation summary:", error);
  }
}

/**
 * FFS-864: Build cross-session memory context from recent conversation summaries.
 * Returns a ~200 token block for injection into the system prompt.
 */
async function buildMemoryContext(staffId: string): Promise<string | null> {
  try {
    const memories = await Promise.race([
      queryRows<{ summary: string; created_at: string }>(
        `SELECT summary, created_at FROM ops.tippy_staff_memory
         WHERE staff_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [staffId]
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2000)
      ),
    ]);

    if (!memories || memories.length === 0) return null;

    let text = "CROSS-SESSION MEMORY (recent conversations with this user):";
    for (const mem of memories) {
      const diff = Date.now() - new Date(mem.created_at).getTime();
      const days = Math.floor(diff / 86400000);
      const label =
        days === 0
          ? "today"
          : days === 1
            ? "yesterday"
            : `${days} days ago`;
      text += `\n- [${label}] ${mem.summary}`;
    }

    return text;
  } catch {
    return null;
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
        `UPDATE ops.tippy_conversations
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

/**
 * Streaming chat handler — returns SSE events instead of JSON.
 * Tool loop runs synchronously (non-streamed), only the final text generation streams.
 */
async function handleStreamingChat({
  client,
  systemPrompt,
  messages,
  availableTools,
  forcedToolChoice,
  conversationId,
  session,
  userName,
  aiAccessLevel,
}: {
  client: Anthropic;
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  availableTools: typeof TIPPY_TOOLS;
  forcedToolChoice: ReturnType<typeof detectIntentAndForceToolChoice>;
  conversationId: string;
  session: { staff_id?: string } | null;
  userName: string | null;
  aiAccessLevel: string | null;
}): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Declare outside try so catch block can access partial results (FFS-811)
      const recentToolResults: ToolResult[] = [];
      const streamStartTime = Date.now();

      try {
        send("status", { phase: "thinking" });

        // Tool context
        const toolContext: ToolContext = {
          staffId: session?.staff_id || "",
          staffName: userName || "Unknown",
          aiAccessLevel: aiAccessLevel || "read_only",
          conversationId,
          recentToolResults,
        };
        const toolsUsedInThisRequest: string[] = [];

        // Helper: stream an API call and collect content blocks (tool_use + text)
        // Streaming detects tool_use in ~2s vs 15-40s for non-streaming
        async function streamAndCollect(
          apiMessages: Anthropic.MessageParam[],
          toolChoice?: ReturnType<typeof detectIntentAndForceToolChoice>
        ): Promise<{ content: Anthropic.ContentBlock[]; stopReason: string | null }> {
          const collected: Anthropic.ContentBlock[] = [];
          let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
          let textContent = "";
          let stopReason: string | null = null;

          const apiStream = client.messages.stream({
            model: TIPPY_MODEL,
            max_tokens: 4096,
            system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
            messages: apiMessages,
            tools: availableTools.length > 0 ? (availableTools as Anthropic.Tool[]) : undefined,
            ...(toolChoice && { tool_choice: toolChoice }),
          });

          for await (const event of apiStream) {
            if (event.type === "content_block_start") {
              const block = event.content_block;
              if (block.type === "tool_use") {
                currentToolUse = { id: block.id, name: block.name, inputJson: "" };
              } else if (block.type === "text") {
                textContent = "";
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "input_json_delta" && currentToolUse) {
                currentToolUse.inputJson += event.delta.partial_json;
              } else if (event.delta.type === "text_delta") {
                textContent += event.delta.text;
              }
            } else if (event.type === "content_block_stop") {
              if (currentToolUse) {
                collected.push({
                  type: "tool_use",
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input: JSON.parse(currentToolUse.inputJson || "{}"),
                } as Anthropic.ToolUseBlock);
                currentToolUse = null;
              } else if (textContent) {
                collected.push({ type: "text", text: textContent } as Anthropic.TextBlock);
                textContent = "";
              }
            } else if (event.type === "message_delta") {
              stopReason = event.delta.stop_reason ?? null;
            }
          }

          return { content: collected, stopReason };
        }

        // Initial API call (STREAMED — detects tool_use fast + prompt caching)
        const startTime = Date.now();
        let { content: responseContent, stopReason } = await streamAndCollect(messages, forcedToolChoice);
        console.log(`[Tippy] Initial streamed call: ${Date.now() - startTime}ms, stop_reason=${stopReason}`);

        // Tool loop (max 3 iterations, with time budget — FFS-809)
        let iterations = 0;
        const maxIterations = 3;
        const TIME_BUDGET_MS = 280_000; // 20s buffer before Vercel's 300s limit

        while (stopReason === "tool_use" && iterations < maxIterations) {
          // Check time budget before starting another tool iteration
          const remaining = TIME_BUDGET_MS - (Date.now() - startTime);
          if (remaining < 25_000) {
            // Not enough time for another API round-trip — force summarize
            const pendingBlocks = responseContent.filter(
              (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
            );
            const pendingResults = pendingBlocks.map((toolUse) => ({
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify({ success: false, error: "Skipped: time budget exceeded" }),
            }));
            messages.push({ role: "assistant", content: responseContent });
            messages.push({
              role: "user",
              content: [
                ...pendingResults,
                { type: "text" as const, text: "Time is limited. Summarize what you found so far. Do not call any more tools." },
              ],
            });
            break;
          }

          iterations++;

          const toolUseBlocks = responseContent.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
          );
          if (toolUseBlocks.length === 0) break;

          toolUseBlocks.forEach((toolUse) => {
            if (!toolsUsedInThisRequest.includes(toolUse.name)) {
              toolsUsedInThisRequest.push(toolUse.name);
            }
          });

          // Execute tools, sending status events for each
          const toolResultsContent = await Promise.all(
            toolUseBlocks.map(async (toolUse) => {
              send("status", { phase: "tool_call", tool: toolUse.name });
              const result = await executeToolCall(
                toolUse.name,
                toolUse.input as Record<string, unknown>,
                toolContext
              );
              recentToolResults.push(result);
              send("status", {
                phase: "tool_result",
                tool: toolUse.name,
                success: result.success,
              });
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: JSON.stringify(result),
              };
            })
          );

          messages.push({ role: "assistant", content: responseContent });
          messages.push({ role: "user", content: toolResultsContent });

          // Next API call (streamed + cached)
          const toolCallStart = Date.now();
          const nextResult = await streamAndCollect(messages);
          responseContent = nextResult.content;
          stopReason = nextResult.stopReason;
          console.log(`[Tippy] Tool loop call #${iterations}: ${Date.now() - toolCallStart}ms, stop_reason=${stopReason}, elapsed=${Date.now() - startTime}ms`);
        }

        // Handle max iterations exceeded (same as non-streaming path)
        if (stopReason === "tool_use" && iterations >= maxIterations) {
          const pendingToolUseBlocks = responseContent.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
          );

          pendingToolUseBlocks.forEach((toolUse) => {
            if (!toolsUsedInThisRequest.includes(toolUse.name)) {
              toolsUsedInThisRequest.push(toolUse.name);
            }
          });

          const pendingToolResults = await Promise.all(
            pendingToolUseBlocks.map(async (toolUse) => {
              send("status", { phase: "tool_call", tool: toolUse.name });
              const result = await executeToolCall(
                toolUse.name,
                toolUse.input as Record<string, unknown>,
                toolContext
              );
              recentToolResults.push(result);
              send("status", {
                phase: "tool_result",
                tool: toolUse.name,
                success: result.success,
              });
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: JSON.stringify(result),
              };
            })
          );

          messages.push({ role: "assistant", content: responseContent });
          messages.push({
            role: "user",
            content: [
              ...pendingToolResults,
              {
                type: "text" as const,
                text: "Please summarize what you found from all the tool results above. Do not call any more tools.",
              },
            ],
          });
        }

        // Final response: stream the text
        send("status", { phase: "responding" });

        // If the last response already has text (no more tool use), extract and stream it as deltas
        const existingText = stopReason !== "tool_use"
          ? responseContent.find((c): c is Anthropic.TextBlock => c.type === "text")
          : null;

        let fullText = "";

        if (existingText && existingText.type === "text" && iterations < maxIterations) {
          // Response already resolved with text — no need to re-call API
          // Send the text as a single delta (it's already complete)
          fullText = existingText.text;
          send("delta", { text: fullText });
        } else {
          // Stream the final text generation (with prompt caching)
          const finalStream = client.messages.stream({
            model: TIPPY_MODEL,
            max_tokens: 4096,
            system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
            messages,
            // No tools — forces text-only response
          });

          for await (const event of finalStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              fullText += event.delta.text;
              send("delta", { text: event.delta.text });
            }
          }
        }

        // Store complete message after stream ends
        if (!fullText) {
          fullText = "I'm not sure how to help with that.";
        }

        await storeMessage(
          conversationId,
          "assistant",
          fullText,
          toolsUsedInThisRequest.length > 0 ? { tools: toolsUsedInThisRequest } : undefined,
          undefined,
          undefined
        );

        if (toolsUsedInThisRequest.length > 0) {
          await updateConversationTools(conversationId, toolsUsedInThisRequest);
        }

        // PR 4 (FFS-1165): include tools-used in the done event so eval
        // fixtures can assert `tool_must_be_called` over the SSE stream.
        send("done", { conversationId, toolsUsed: toolsUsedInThisRequest });
        controller.close();
      } catch (error) {
        const totalElapsed = Date.now() - streamStartTime;
        console.error(`[Tippy] Streaming error after ${totalElapsed}ms:`, error);
        const errMsg = error instanceof Error ? error.message : String(error);

        // Return partial results if any tools succeeded (FFS-811)
        if (recentToolResults.length > 0) {
          const partialFindings = recentToolResults
            .filter((r) => r.success && r.data)
            .map((r) => {
              const d = r.data as Record<string, unknown>;
              return d.summary || d.message || JSON.stringify(d).substring(0, 300);
            });
          if (partialFindings.length > 0) {
            send("delta", {
              text: `I ran into an issue finishing my analysis, but here's what I found so far:\n\n${partialFindings.join("\n\n")}`,
            });
          }
        }

        // Error-specific messaging (FFS-811)
        if (errMsg.includes("rate_limit") || errMsg.includes("429")) {
          send("error", {
            message: "I'm getting a lot of questions right now. Give me about 10 seconds and try again.",
          });
        } else if (errMsg.includes("timeout") || errMsg.includes("ETIMEDOUT") || errMsg.includes("overloaded")) {
          send("error", {
            message: "That question needed more research than I could finish in time. Try something more specific — like a single address or cat name.",
          });
        } else {
          send("error", {
            message: "Something went wrong on my end. If this keeps happening, let the tech team know.",
          });
        }

        // Persist error for debugging (FFS-811)
        if (conversationId && !conversationId.startsWith("conv_")) {
          execute(
            `UPDATE ops.tippy_conversations
             SET session_context = COALESCE(session_context, '{}'::jsonb)
               || jsonb_build_object('last_error', $2::text, 'error_at', NOW()::text)
             WHERE conversation_id = $1`,
            [conversationId, errMsg.substring(0, 500)]
          ).catch(() => {});
        }

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, history = [], conversationId: clientConversationId, pageContext } = body;

    if (!message || typeof message !== "string") {
      return apiBadRequest("Message is required");
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
        `SELECT ai_access_level, display_name FROM ops.staff WHERE staff_id = $1`,
        [session.staff_id]
      );
      // Default to read_only for authenticated staff without explicit level
      aiAccessLevel = staffInfo?.ai_access_level || "read_only";
      userName = staffInfo?.display_name || null;
    }

    // Check if user has any AI access
    if (!session || aiAccessLevel === "none") {
      return apiSuccess({
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
      return apiSuccess({ message: fallbackResponse, conversationId });
    }

    // Initialize Anthropic client (SDK default: maxRetries=2 with exponential backoff,
    // respects retry-after headers automatically for 429s)
    const client = new Anthropic({ apiKey });

    // Customize system prompt based on access level and user type
    let systemPrompt = SYSTEM_PROMPT;

    // Detect if user is an engineer/admin vs regular staff
    const engineerNames = ["ben", "daniel", "sophie", "evan", "dominique", "benmisdiaz", "ben misdiaz"];
    const isEngineer = userName && engineerNames.some(name =>
      userName.toLowerCase().includes(name)
    );

    if (userName) {
      systemPrompt += `\n\nYou are speaking with ${userName}.`;
    }

    // Add audience-specific communication style
    if (isEngineer) {
      systemPrompt += `\n\n**COMMUNICATION STYLE - ENGINEER/ADMIN:**
This user is part of the engineering team. Be direct and technical:
- Lead with the data: numbers, percentages, counts
- Reference table names, column names, data sources directly
- Mention data quality issues and gaps explicitly
- Skip the narrative - they want facts
- Include technical context: "This comes from ops.appointments joined to sot.cat_place"
- Acknowledge sync status, missing data, schema issues directly
- If something is broken or incomplete, say so plainly
- Example: "24 cats at this place, 100% altered. Data from ClinicHQ appointments (2026-01-29). 3 adopted out via ShelterLuv Relocation (barn cats). person_place shows Emily West as caretaker+resident."`;
    } else {
      systemPrompt += `\n\n**COMMUNICATION STYLE - STAFF (CRITICAL):**
Your audience: TNR experts who understand the work, but have never used digital systems. They know what "84% alteration rate" means and what a mass trapping is. They DON'T want database jargon or structured reports.

ABSOLUTE RULES:
1. **USE FORMATTING SPARINGLY** - Bold for emphasis is fine. Use bullet points only for actual lists (top 5, multiple locations, etc.), not for every piece of info.
2. **BE INFORMATIONAL** - Length is fine if it's substantive. Cut fluff, not useful info.
3. **MATTER-OF-FACT TONE** - Don't be a cheerleader. No "amazing!", "impressive!", "great news!", "real success story!". Just state the facts plainly.
4. **SOUND NATURAL** - Talk like a knowledgeable colleague, not a robot or a report generator.

5. **HONEST ABOUT LIMITATIONS** - We only know what we've seen. A "100% rate" means 100% of cats WE KNOW ABOUT are fixed, but there could be others we haven't encountered. Add brief caveats like:
   - "100% of the cats we've seen are fixed, though there may be others we haven't trapped yet"
   - "The numbers look good but we'd need another visit to confirm nothing new has shown up"
   - "This is based on 24 cats through the clinic - the actual colony could be larger"
   Don't undermine the good news, just be realistic. Caveats build trust.

6. **SKEPTICAL OF HIGH RATES WITH LOW ACTIVITY** - If an area shows 94% altered but only 1-2 requests ever filed, that's NOT a success story - it means we probably don't know what's really there:
   - High rate + few requests = limited data, not comprehensive coverage
   - "No active requests" might mean no outreach, not "problem solved"
   - Don't say "well-managed" or "stable" without evidence of actual engagement
   - Compare request counts to cat counts - if the ratio seems off, say so

7. **REQUESTS ≠ ALL TNR WORK** - Many cats come through clinic walk-ins, partner orgs, and community trappers without formal requests. Never attribute all cats to the request count:
   - BAD: "36,000 cats helped through 146 completed requests"
   - GOOD: "36,000 cats in our system from various sources - clinic walk-ins, partner orgs, community trappers, and about 146 formal requests"

BAD (overconfident):
"100% altered - that colony is completely done!"

GOOD (honest):
"Pozzan Road is Emily West's colony. We got 24 cats through the clinic back in January, all in one day, and they're all fixed. That's 100% of what we've seen, so it looks stable - though there's always a chance a new cat shows up. Emily was easy to work with."

Think: How would a veteran coordinator give an honest assessment?`;
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

    // FFS-1015: Add request page context when viewing a specific request
    if (pageContext?.path && /^\/requests\/[0-9a-f-]{36}$/i.test(pageContext.path)) {
      const requestUuid = pageContext.path.split("/").pop();
      systemPrompt +=
        `\n\nREQUEST CONTEXT: User is viewing request ${requestUuid}.\n` +
        `- "update this request with..." or new info → use update_request tool with request_id="${requestUuid}"\n` +
        `- ALWAYS confirm proposed field updates with the user before calling update_request\n` +
        `- Multi-address: primary place stays on request, secondary goes in location_description\n` +
        `- Cannot change status, priority, or place_id via update_request (those require staff action in the UI)`;
    }

    // Add map context awareness when user is on the map page
    if (pageContext?.path === "/map" && pageContext?.mapState) {
      const mapState = pageContext.mapState;
      let mapContextStr = "\n\n**MAP CONTEXT**: The user is currently viewing the Beacon Map.";

      if (mapState.center) {
        mapContextStr += `\n- Map center: ${mapState.center.lat.toFixed(5)}, ${mapState.center.lng.toFixed(5)}`;
      }
      if (mapState.zoom) {
        mapContextStr += `\n- Zoom level: ${mapState.zoom}`;
      }
      if (mapState.selectedPlace) {
        mapContextStr += `\n- Selected place: ${mapState.selectedPlace.address} (ID: ${mapState.selectedPlace.place_id})`;
        mapContextStr += "\n- The user is looking at this specific location. Prioritize information about this place when answering.";
      }
      if (mapState.navigatedLocation) {
        mapContextStr += `\n- User navigated to: ${mapState.navigatedLocation.address} (${mapState.navigatedLocation.lat.toFixed(5)}, ${mapState.navigatedLocation.lng.toFixed(5)})`;
      }
      if (mapState.drawerOpen && mapState.selectedPlace) {
        mapContextStr += `\n- A place detail drawer is currently open for: ${mapState.selectedPlace.address}. The user can see people, cats, and notes about this place. Use comprehensive_place_lookup to help with questions about it.`;
      }
      if (mapState.lastSearchQuery) {
        mapContextStr += `\n- The user recently searched for: "${mapState.lastSearchQuery}"`;
      }
      if (mapState.visiblePinCount) {
        mapContextStr += `\n- ${mapState.visiblePinCount} map pins are currently loaded in view.`;
      }

      mapContextStr += "\n\nWhen the user asks spatial questions like 'what's nearby?', 'any colonies in this area?', or 'are there feeders around here?', use the map context to understand what they're looking at. If a place is selected, use comprehensive_place_lookup to get details about that location.";

      systemPrompt += mapContextStr;
    }

    // FFS-754/808: Add pre-flight data quality context (3s hard timeout)
    if (session?.staff_id && !conversationId.startsWith('conv_')) {
      try {
        const preflightContext = await Promise.race([
          buildPreflightContext(conversationId),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000)),
        ]);
        systemPrompt += preflightContext;
      } catch {
        // Don't fail the chat if pre-flight fails
      }
    }

    // FFS-759: Onboarding mode for new staff
    if (session?.staff_id) {
      try {
        const conversationCount = await queryOne<{ count: number }>(
          `SELECT COUNT(*)::int as count FROM ops.tippy_conversations WHERE staff_id = $1`,
          [session.staff_id]
        );
        if ((conversationCount?.count ?? 0) < 5) {
          systemPrompt += `\n\nONBOARDING MODE: This staff member is new to Tippy.
- Define TNR terminology when first used (colony, eartip, alteration rate, etc.)
- Include links to relevant Beacon pages in your answers (e.g., /requests, /cats, /places)
- Offer process walkthroughs proactively
- Be more detailed in explanations`;
        }
      } catch {
        // Don't fail the chat if onboarding check fails
      }
    }

    // FFS-864: Inject cross-session memory context
    if (session?.staff_id) {
      try {
        const memoryContext = await buildMemoryContext(session.staff_id);
        if (memoryContext) systemPrompt += "\n\n" + memoryContext;
      } catch {
        // Don't fail the chat if memory retrieval fails
      }
    }

    // FFS-745: Token optimization — truncate old messages to reduce cost
    const optimizedHistory: Anthropic.MessageParam[] = history.map((msg, idx) => {
      const isOlderThan2Turns = idx < history.length - 4; // Last 2 turns = 4 messages (user+assistant)
      if (!isOlderThan2Turns) {
        return { role: msg.role as "user" | "assistant", content: msg.content };
      }

      if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.length > 500) {
        // Truncate old assistant messages to first 500 chars
        return {
          role: msg.role as "user" | "assistant",
          content: msg.content.slice(0, 500) + "... [truncated for context]",
        };
      }

      // Strip tool_result content from old turns (raw SQL results no longer needed)
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const pruned = (msg.content as Anthropic.ContentBlockParam[]).map((block) => {
          if ('type' in block && block.type === "tool_result") {
            return { ...block, content: "[tool result available in earlier context]" } as Anthropic.ContentBlockParam;
          }
          return block;
        });
        return { role: msg.role as "user" | "assistant", content: pruned };
      }

      return { role: msg.role as "user" | "assistant", content: msg.content };
    });

    // PR 5 (FFS-1163 + FFS-1164): inject strategic-mode guidance + humility
    // default when the user is asking a strategic / priority question.
    // This is conditional per-request — we don't want this guidance on
    // every chat (it would muddy the prompt for simple lookups).
    if (detectStrategicIntent(message)) {
      systemPrompt += `\n\nSTRATEGIC QUERY MODE — HUMILITY DEFAULT (PR 5, FFS-1163/1164):

The user just asked a strategic / priority / "where should we focus" question. These are HIGH-RISK because the obvious tools (strategic_city_analysis, query_region_stats sorted by alteration_rate) are vulnerable to NULL-status pollution: they will surface places that look like priorities but are really just data gaps or already being worked on.

REQUIRED for strategic queries:
1. **Call \`find_intact_cat_clusters\` first.** It returns places with CONFIRMED-INTACT cats, excludes blacklisted places, AND excludes places with active requests. The result IS the answer.
2. If \`find_intact_cat_clusters\` returns zero results, that is a real answer. Say: "Based on confirmed-intact cat records, I don't have enough data to recommend specific priorities right now. Most places with low alteration rates in [area] are either already being worked, blacklisted, or have unknown status from legacy imports rather than confirmed unaltered cats." DO NOT fabricate a priority list from rate-sorted data.
3. NEVER recommend a place that has an active request. "Already being worked" is not a "new priority". \`find_intact_cat_clusters\` enforces this; if you reach for other tools, check the request status yourself.
4. Prefer \`meta.rate_among_known\` over \`meta.rate_overall\`. A 5% naive rate with 90% NULL is not "needs urgent TNR" — it's "needs better data".
5. Default to humility. "I can't recommend confidently from this data" is more useful to staff than a confident-sounding wrong answer. Jami can act on "I don't know yet"; she cannot act on a list of places she'd then have to second-guess.

The Santa Rosa failure case this is designed to fix:
- BAD: "The areas of Santa Rosa most needing TNR are 535 Mark West Springs Rd (5% altered, 187 cats), 1688 Jennings Way (6% altered, ...) ..."
  → Both of those have ~95% NULL status. The "5% altered" is a data artifact, not a priority signal.
- GOOD: "I called find_intact_cat_clusters for Santa Rosa with min_intact=3. It returned [N] places with confirmed-intact cats and no active request. Top: [name] with [N] confirmed intact. The reason I'm using this specific tool: most low-rate places in Santa Rosa look low only because we don't have status for most of their cats — they're data gaps, not real priorities. Want me to look closer at any of these?"
- ALSO GOOD (when no results): "I checked for places in Santa Rosa with confirmed-intact cats and no active request — none meet the threshold right now. The lower-rate places you'd see in our raw stats are mostly NULL-status legacy data or already assigned to a trapper. I can't recommend a priority confidently from this, but I can dig into specific addresses if you have somewhere in mind."`;
    }

    // Build messages array
    const messages: Anthropic.MessageParam[] = [
      ...optimizedHistory,
      { role: "user" as const, content: message },
    ];

    // Detect intent and potentially force tool choice for reliable invocation
    const forcedToolChoice = detectIntentAndForceToolChoice(message, aiAccessLevel || "read_only");

    // FFS-755: Detect shift briefing request
    if (message === '__shift_briefing__' && body.stream && session?.staff_id) {
      const briefingData = await assembleBriefingData(session.staff_id);

      const briefingMessages: Anthropic.MessageParam[] = [
        { role: 'user', content: 'Generate my shift briefing for today.' }
      ];

      const briefingPrompt = systemPrompt + `\n\nSHIFT BRIEFING DATA:
The staff member just started their shift. Generate a concise daily briefing using this data.
Format it naturally — like a colleague giving a handoff, not a dashboard report.
Lead with what needs attention. Keep it under 250 words.

${JSON.stringify(briefingData, null, 2)}`;

      // Mark this conversation as a briefing
      try {
        await execute(
          `UPDATE ops.tippy_conversations
           SET session_context = COALESCE(session_context, '{}'::jsonb)
             || '{"is_briefing": true}'::jsonb
           WHERE conversation_id = $1`,
          [conversationId]
        );
      } catch {
        // Don't fail if marker can't be set
      }

      return handleStreamingChat({
        client,
        systemPrompt: briefingPrompt,
        messages: briefingMessages,
        availableTools,
        forcedToolChoice: undefined,
        conversationId,
        session,
        userName,
        aiAccessLevel,
      });
    }

    // === STREAMING PATH ===
    if (body.stream) {
      return handleStreamingChat({
        client,
        systemPrompt,
        messages,
        availableTools,
        forcedToolChoice,
        conversationId,
        session,
        userName,
        aiAccessLevel,
      });
    }

    // Call Claude API with filtered tools
    let response = await client.messages.create({
      model: TIPPY_MODEL,
      max_tokens: 4096,
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

    // Handle tool use loop (max 3 iterations, with time budget — FFS-809)
    let iterations = 0;
    const maxIterations = 3;
    const nsStartTime = Date.now();
    const NS_TIME_BUDGET_MS = 280_000; // 20s buffer before Vercel's 300s limit

    while (response.stop_reason === "tool_use" && iterations < maxIterations) {
      // Check time budget before starting another tool iteration
      const nsRemaining = NS_TIME_BUDGET_MS - (Date.now() - nsStartTime);
      if (nsRemaining < 25_000) {
        const pendingBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );
        const pendingResults = pendingBlocks.map((toolUse) => ({
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: JSON.stringify({ success: false, error: "Skipped: time budget exceeded" }),
        }));
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: [
            ...pendingResults,
            { type: "text" as const, text: "Time is limited. Summarize what you found so far. Do not call any more tools." },
          ],
        });
        break;
      }

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
        model: TIPPY_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: availableTools.length > 0 ? availableTools : undefined,
      });
    }

    // If the loop exited because we hit max iterations but Claude still wants tools,
    // we must still execute those tool calls and provide results (API requirement),
    // then make one final call WITHOUT tools to force a text summary.
    if (response.stop_reason === "tool_use" && iterations >= maxIterations) {
      // Find and execute the pending tool calls
      const pendingToolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      // Track these tools as well
      pendingToolUseBlocks.forEach((toolUse) => {
        if (!toolsUsedInThisRequest.includes(toolUse.name)) {
          toolsUsedInThisRequest.push(toolUse.name);
        }
      });

      // Execute the pending tool calls
      const pendingToolResults = await Promise.all(
        pendingToolUseBlocks.map(async (toolUse) => {
          const result = await executeToolCall(
            toolUse.name,
            toolUse.input as Record<string, unknown>,
            toolContext
          );
          recentToolResults.push(result);
          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          };
        })
      );

      // Add assistant's response with tool_use blocks
      messages.push({
        role: "assistant",
        content: response.content,
      });

      // Add tool results followed by a request to summarize (in same user message)
      messages.push({
        role: "user",
        content: [
          ...pendingToolResults,
          {
            type: "text" as const,
            text: "Please summarize what you found from all the tool results above. Do not call any more tools.",
          },
        ],
      });

      response = await client.messages.create({
        model: TIPPY_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        // No tools provided — forces text-only response
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

    return apiSuccess({
      message: assistantMessage,
      conversationId,
      // PR 4 (FFS-1165): surface tools-used so eval fixtures can assert
      // `tool_must_be_called` without scraping logs. Already tracked for
      // conversation metadata — just returning it to the caller.
      toolsUsed: toolsUsedInThisRequest,
    });
  } catch (error) {
    console.error("Tippy chat error:", error);
    const errMsg = error instanceof Error ? error.message : String(error);

    // Error-specific messaging (FFS-811)
    let friendlyMessage: string;
    if (errMsg.includes("rate_limit") || errMsg.includes("429")) {
      friendlyMessage = "I'm getting a lot of questions right now. Give me about 10 seconds and try again.";
    } else if (errMsg.includes("timeout") || errMsg.includes("ETIMEDOUT") || errMsg.includes("overloaded")) {
      friendlyMessage = "That question needed more research than I could finish in time. Try something more specific — like a single address or cat name.";
    } else {
      friendlyMessage = "Something went wrong on my end. If this keeps happening, let the tech team know.";
    }

    return apiServerError(friendlyMessage);
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

Beacon uses Chapman mark-recapture population estimates, FFR impact metrics, disease surveillance, and alteration-rate thresholds to assess colony health. The 70%+ alteration threshold is scientifically validated for population stabilization.`;
  }

  if (lowerMessage.includes("beacon")) {
    return `**Beacon's ecological analytics** (at /beacon) show:

• Colony size estimates and Chapman population modeling
• Alteration (spay/neuter) rates with coverage tracking
• Geographic clusters and heatmaps of cat activity
• Population trends and FFR impact over time

Go to /beacon for the analytics dashboard, or /beacon/map for the interactive map.`;
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
  return `I can help you navigate Beacon! Try asking about:

• How to create a request
• Finding cats by address
• What is TNR/FFR
• Ecological analytics and colony health
• Processing intake submissions

Or use the search bar at the top to find specific records.`;
}
