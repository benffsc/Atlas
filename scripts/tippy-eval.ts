#!/usr/bin/env npx tsx
/**
 * Tippy Eval Harness
 *
 * Sends known prompts to Claude with Tippy's tool schemas, asserts on tool selection
 * and key input fields. Does NOT test text output (non-deterministic).
 *
 * Cost: ~$0.04 per full run (12 cases × ~$0.003 each)
 * Time: ~25 seconds
 *
 * Usage:
 *   npx tsx scripts/tippy-eval.ts              # Run all
 *   npx tsx scripts/tippy-eval.ts --quick      # Run 5 fastest cases only
 *   npx tsx scripts/tippy-eval.ts --verbose    # Show full tool call details
 */

import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.resolve(__dirname, "../apps/web/.env.local") });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY not found in apps/web/.env.local");
  process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024; // Keep cheap — we only need the first tool call

const VERBOSE = process.argv.includes("--verbose");
const QUICK = process.argv.includes("--quick");

// =============================================================================
// Tool Schemas (subset matching TIPPY_V2_TOOLS — just enough for routing eval)
// =============================================================================

const EVAL_TOOLS: Anthropic.Tool[] = [
  {
    name: "run_sql",
    description: "Execute a read-only SQL query against the Atlas database.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "SQL query" },
        reasoning: { type: "string", description: "Why this query" },
      },
      required: ["sql", "reasoning"],
    },
  },
  {
    name: "full_place_briefing",
    description: "Get a COMPLETE briefing on a place. Combines colony report, institutional knowledge, ShelterLuv outcomes, request intelligence, and corridor detection.",
    input_schema: {
      type: "object" as const,
      properties: {
        address: { type: "string", description: "Address or place name" },
        place_id: { type: "string", description: "UUID of the place" },
      },
      required: [],
    },
  },
  {
    name: "place_search",
    description: "Find places by address, street, or name. Returns matching places with cat counts and nearby activity.",
    input_schema: {
      type: "object" as const,
      properties: {
        address: { type: "string", description: "Address or place name" },
      },
      required: ["address"],
    },
  },
  {
    name: "person_lookup",
    description: "Find a person and ALL their data from all sources. Searches Atlas, ClinicHQ, ShelterLuv, VolunteerHub.",
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: { type: "string", description: "Email, phone, or name" },
        identifier_type: { type: "string", enum: ["email", "phone", "name", "auto"] },
      },
      required: ["identifier"],
    },
  },
  {
    name: "cat_lookup",
    description: "Find a cat by microchip or name with full history including journey data (origin, destination, lifecycle status).",
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: { type: "string", description: "Microchip, cat name, or ID" },
        identifier_type: { type: "string", enum: ["microchip", "name", "clinichq_id", "shelterluv_id", "auto"] },
      },
      required: ["identifier"],
    },
  },
  {
    name: "cat_search",
    description: "Search cats by appearance (color, pattern, breed).",
    input_schema: {
      type: "object" as const,
      properties: {
        color: { type: "string" },
        pattern: { type: "string" },
        sex: { type: "string" },
        place_id: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "area_stats",
    description: "Get statistics for a geographic area (city, ZIP, region).",
    input_schema: {
      type: "object" as const,
      properties: {
        area: { type: "string", description: "City name, ZIP, or region" },
      },
      required: ["area"],
    },
  },
  {
    name: "trapper_stats",
    description: "Get trapper performance stats, workload, availability.",
    input_schema: {
      type: "object" as const,
      properties: {
        query_type: { type: "string", enum: ["individual", "leaderboard", "availability", "staff"] },
        identifier: { type: "string" },
      },
      required: ["query_type"],
    },
  },
  {
    name: "request_stats",
    description: "Get request pipeline metrics, aging, status breakdown.",
    input_schema: {
      type: "object" as const,
      properties: {
        query_type: { type: "string", enum: ["pipeline", "aging", "resolution", "by_area"] },
      },
      required: ["query_type"],
    },
  },
  {
    name: "create_reminder",
    description: "Create a reminder for the staff member. Use when they say 'remind me', 'follow up on', 'don't let me forget'.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        due_at: { type: "string", description: "ISO datetime" },
        notes: { type: "string" },
        entity_type: { type: "string" },
        entity_id: { type: "string" },
      },
      required: ["title", "due_at"],
    },
  },
  {
    name: "log_event",
    description: `Dispatcher for write operations. Routes by action_type:
- "field_event": Log a field event (trapping, observation).
- "add_note": Add a note to a place, person, cat, or request.
- "add_field_contact": Create a new person record from field contact info.
- "link_corridor_place": Connect a nearby address to a request's scope.
- "draft_request": Create a draft FFR request.
- "update_request": Update an existing request.`,
    input_schema: {
      type: "object" as const,
      properties: {
        action_type: {
          type: "string",
          enum: ["field_event", "site_observation", "data_discrepancy", "flag_anomaly",
            "data_correction", "draft_request", "update_request", "save_lookup",
            "add_note", "add_field_contact", "link_corridor_place"],
        },
        location: { type: "string" },
        entity_type: { type: "string" },
        entity_id: { type: "string" },
        details: { type: "object" },
        notes: { type: "string" },
      },
      required: ["action_type"],
    },
  },
  {
    name: "find_priority_sites",
    description: "Find high-priority sites needing attention based on scoring criteria.",
    input_schema: {
      type: "object" as const,
      properties: {
        criteria: { type: "string", enum: ["unaltered_density", "aging_requests", "disease_risk", "custom"] },
        limit: { type: "number" },
      },
      required: [],
    },
  },
];

// =============================================================================
// System Prompt (minimal — just enough for routing)
// =============================================================================

const EVAL_SYSTEM = `You are Tippy, an AI assistant for Beacon (TNR management system for FFSC).
Today's date is ${new Date().toISOString().split("T")[0]}.
You have database access through tools. ALWAYS use a tool to answer data questions.

TOOL SELECTION:
- Specific address → full_place_briefing
- Street/road → place_search FIRST
- City/region → area_stats
- Person → person_lookup
- Cat by chip/name → cat_lookup
- Cat by appearance → cat_search (use when user describes physical traits like color/pattern)
- Trapper/staff → trapper_stats
- Request stats → request_stats
- Priority sites → find_priority_sites
- "Remind me..." → create_reminder (use IMMEDIATELY, do not look up person first)
- Log observation/note → log_event
- Corridor / shared colony → log_event with action_type="link_corridor_place"

WRITE OPERATIONS — you have FULL read_write access:
- create_reminder for "remind me", "follow up on", "don't let me forget". Extract the due date and create immediately.
- log_event with action_type="add_note" for "note that...", "record that..."
- log_event with action_type="add_field_contact" for NEW CONTACTS: when staff provides name + phone/address + relationship. Create the record directly.
- log_event with action_type="link_corridor_place" for connecting addresses to requests ("add X to this corridor", "X is part of the same problem")

COMMUNICATION PARSING:
When staff paste emails/texts (>5 lines with From/To headers or quoted replies):
1. Extract entities: people (name+phone+role), places, cats, dates, action items
2. For EACH new contact with phone/address → log_event with action_type="add_field_contact"
3. For observations → log_event with action_type="add_note"
4. For time-sensitive items → create_reminder
5. Start with the FIRST write action immediately. Do NOT search first.

CRITICAL: When the user gives you new information to record (contacts, observations, corridors, reminders), your FIRST tool call should be the WRITE tool, not a search/lookup. The user is telling you to create data, not asking you to look something up.

You are speaking with a staff member. You have full read_write access.`;

// =============================================================================
// Test Cases
// =============================================================================

interface TestCase {
  id: string;
  prompt: string;
  expect: {
    tool: string | string[]; // string = exact match, array = any of these is acceptable
    inputContains?: Record<string, string | RegExp>;
    inputField?: string; // just check the field exists
  };
  quick?: boolean; // include in --quick run
}

const TEST_CASES: TestCase[] = [
  // ==========================================================================
  // READS — one case per tool, testing the hardest routing decision for each
  // ==========================================================================

  // Address → full_place_briefing (not place_search)
  {
    id: "address_briefing",
    prompt: "What's happening at 717 Cherry St?",
    expect: { tool: "full_place_briefing", inputContains: { address: /cherry/i } },
    quick: true,
  },
  // Street (no number) → place_search (not full_place_briefing)
  {
    id: "street_search",
    prompt: "Any activity on Hessel Road?",
    expect: { tool: "place_search", inputContains: { address: /hessel/i } },
    quick: true,
  },
  // Person by name (harder than email — could be confused with place/cat)
  {
    id: "person_by_name",
    prompt: "Who is Diane Fairclough?",
    expect: { tool: "person_lookup", inputContains: { identifier: /diane/i } },
    quick: true,
  },
  // Cat by microchip (15-digit number — must not route to person_lookup)
  {
    id: "cat_by_microchip",
    prompt: "Look up cat 981020053776316",
    expect: { tool: "cat_lookup", inputContains: { identifier: /981020053776316/ } },
    quick: true,
  },
  // Cat by appearance (physical description — must route to cat_search, not place_search)
  {
    id: "cat_by_appearance",
    prompt: "Search for orange tabby male cats",
    expect: { tool: "cat_search", inputContains: { color: /orange/i } },
  },
  // City/region → area_stats (not place_search)
  {
    id: "area_stats",
    prompt: "How are we doing in Petaluma?",
    expect: { tool: "area_stats", inputContains: { area: /petaluma/i } },
    quick: true,
  },
  // Ambiguous stats question → request_stats (not run_sql)
  {
    id: "request_pipeline",
    prompt: "What does our request pipeline look like?",
    expect: { tool: "request_stats", inputContains: { query_type: "pipeline" } },
  },
  // Priority sites (must not fall through to run_sql)
  {
    id: "priority_sites",
    prompt: "What are the top priority sites in Santa Rosa right now?",
    expect: { tool: "find_priority_sites" },
  },

  // ==========================================================================
  // WRITES — test that write intent goes directly to write tools
  // ==========================================================================

  // Reminder (must not look up person first)
  {
    id: "create_reminder",
    prompt: "Remind me to follow up with Rick about Hessel Rd in 2 weeks",
    expect: { tool: "create_reminder", inputContains: { title: /rick|hessel/i } },
    quick: true,
  },
  // Field contact (must go to log_event, not place_search)
  {
    id: "add_field_contact",
    prompt: "New contact: Juan Martinez, 707-555-9876, he's a neighbor at 1045 Hessel Rd who feeds the cats",
    expect: { tool: "log_event", inputContains: { action_type: "add_field_contact" } },
  },
  // Corridor link (requires request_id context to work)
  {
    id: "corridor_link",
    prompt: "Link 1051 Hessel Rd to the corridor for request ID 27d68319-0000-0000-0000-000000000000. The neighbor there feeds the same cats.",
    expect: { tool: "log_event", inputContains: { action_type: "link_corridor_place" } },
  },

  // ==========================================================================
  // COMPLEX — multi-step or ambiguous prompts
  // ==========================================================================

  // Email thread parsing — tests COMMUNICATION PARSING system prompt section
  // This is the most expensive case (~9s) but tests a unique capability
  {
    id: "email_thread_parsing",
    prompt: `Here's an email from Diane:

From: diane@example.com
Subject: Hessel Rd update

Rick at 1051 Hessel says there are 5 more unfixed cats. His number is 707-555-1234.
Can we follow up in 6 weeks?`,
    expect: { tool: ["log_event", "create_reminder", "place_search", "full_place_briefing"] },
  },
];

// =============================================================================
// Runner
// =============================================================================

interface TestResult {
  id: string;
  passed: boolean;
  expected_tool: string;
  actual_tool: string | null;
  actual_input: Record<string, unknown> | null;
  error?: string;
  latency_ms: number;
}

async function runTestCase(tc: TestCase): Promise<TestResult> {
  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: EVAL_SYSTEM,
      messages: [{ role: "user", content: tc.prompt }],
      tools: EVAL_TOOLS,
      tool_choice: { type: "auto" },
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use") as
      | Anthropic.ToolUseBlock
      | undefined;

    const latency = Date.now() - start;

    const expectedLabel = Array.isArray(tc.expect.tool) ? tc.expect.tool.join("|") : tc.expect.tool;

    if (!toolBlock) {
      return {
        id: tc.id,
        passed: false,
        expected_tool: expectedLabel,
        actual_tool: null,
        actual_input: null,
        error: "No tool call made (model responded with text only)",
        latency_ms: latency,
      };
    }

    const input = toolBlock.input as Record<string, unknown>;
    const expectedTools = Array.isArray(tc.expect.tool) ? tc.expect.tool : [tc.expect.tool];
    let passed = expectedTools.includes(toolBlock.name);
    let error: string | undefined;

    // Check input fields
    if (passed && tc.expect.inputContains) {
      for (const [key, expected] of Object.entries(tc.expect.inputContains)) {
        const actual = input[key] ?? (input.details as Record<string, unknown>)?.[key];
        if (actual === undefined) {
          passed = false;
          error = `Missing input field: ${key}`;
          break;
        }
        if (expected instanceof RegExp) {
          if (!expected.test(String(actual))) {
            passed = false;
            error = `Field "${key}": "${actual}" does not match ${expected}`;
            break;
          }
        } else if (String(actual) !== expected) {
          passed = false;
          error = `Field "${key}": expected "${expected}", got "${actual}"`;
          break;
        }
      }
    }

    return {
      id: tc.id,
      passed,
      expected_tool: expectedLabel,
      actual_tool: toolBlock.name,
      actual_input: input,
      error,
      latency_ms: latency,
    };
  } catch (err) {
    const expectedLabel = Array.isArray(tc.expect.tool) ? tc.expect.tool.join("|") : tc.expect.tool;
    return {
      id: tc.id,
      passed: false,
      expected_tool: expectedLabel,
      actual_tool: null,
      actual_input: null,
      error: `API error: ${err instanceof Error ? err.message : String(err)}`,
      latency_ms: Date.now() - start,
    };
  }
}

async function main() {
  const cases = QUICK ? TEST_CASES.filter((tc) => tc.quick) : TEST_CASES;

  console.log(`\n🧪 Tippy Eval Harness — ${cases.length} test cases (${QUICK ? "quick" : "full"})\n`);
  console.log("─".repeat(70));

  const results: TestResult[] = [];

  for (const tc of cases) {
    process.stdout.write(`  ${tc.id.padEnd(25)} `);
    const result = await runTestCase(tc);
    results.push(result);

    if (result.passed) {
      console.log(`✓ ${result.actual_tool} (${result.latency_ms}ms)`);
    } else {
      console.log(`✗ FAIL`);
      console.log(`    Expected: ${result.expected_tool}`);
      console.log(`    Actual:   ${result.actual_tool || "(no tool call)"}`);
      if (result.error) console.log(`    Reason:   ${result.error}`);
    }

    if (VERBOSE && result.actual_input) {
      console.log(`    Input:    ${JSON.stringify(result.actual_input, null, 2).split("\n").join("\n              ")}`);
    }
  }

  console.log("─".repeat(70));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalLatency = results.reduce((sum, r) => sum + r.latency_ms, 0);
  const avgLatency = Math.round(totalLatency / results.length);

  console.log(`\n  Results: ${passed}/${results.length} passed, ${failed} failed`);
  console.log(`  Latency: ${totalLatency}ms total, ${avgLatency}ms avg`);
  console.log(`  Cost:    ~$${(results.length * 0.003).toFixed(3)} (estimated)\n`);

  if (failed > 0) {
    console.log("  Failed cases:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`    - ${r.id}: ${r.error}`);
    }
    console.log("");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
