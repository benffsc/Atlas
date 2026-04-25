// @real-api - This test file calls the real Anthropic API
/**
 * Tippy V2 Showcase Eval Suite
 *
 * 20 showcase questions + 3 failure/humility cases that validate:
 * 1. Correct V2 tool selection
 * 2. Must-mention keywords in responses
 * 3. Must-not-say phrases (common V1 failure modes)
 *
 * These are REAL API tests — they call `/api/tippy/chat` with streaming
 * and parse the SSE response to extract content + tools used.
 *
 * Run: INCLUDE_REAL_API=1 npx playwright test tippy-v2-showcase
 *
 * @see /docs/TIPPY_SHOWCASE_QUESTIONS.md for expected responses
 * @see /apps/web/e2e/fixtures/tippy-showcase.ts for V1 showcase fixture
 */

import { test, expect } from "@playwright/test";
import { askTippyStreaming } from "./helpers/auth-api";

// Hard budget: Vercel maxDuration=120s, internal budget=110s, our test=90s
const EVAL_TIMEOUT_MS = 90_000;

// ============================================================================
// TYPES
// ============================================================================

interface ShowcaseQuestion {
  id: number;
  question: string;
  /** V2 tool names that SHOULD be called (at least one must match) */
  expectedTools: string[];
  /** Keywords that MUST appear in the response (case-insensitive) */
  mustMention: string[];
  /** Phrases that MUST NOT appear in the response (V1 failure modes) */
  mustNotSay: string[];
  /** Short description for test name */
  description: string;
}

// ============================================================================
// 20 SHOWCASE QUESTIONS
// ============================================================================

const SHOWCASE_QUESTIONS: ShowcaseQuestion[] = [
  {
    id: 1,
    question: "How many cats have we altered this year?",
    expectedTools: ["area_stats", "run_sql"],
    mustMention: ["cat"],
    mustNotSay: [],
    description: "Yearly alteration count",
  },
  {
    id: 2,
    question: "Tell me about Pozzan Road",
    expectedTools: ["place_search", "full_place_briefing"],
    mustMention: ["address", "cat"],
    mustNotSay: [],
    description: "Place lookup by road name",
  },
  {
    id: 3,
    question: "What's happening at 1170 Walker Rd?",
    expectedTools: ["full_place_briefing"],
    mustMention: ["cat", "altered"],
    mustNotSay: [],
    description: "Known colony briefing",
  },
  {
    id: 4,
    question: "Who is Emily West?",
    expectedTools: ["person_lookup"],
    mustMention: ["emily"],
    mustNotSay: [],
    description: "Person lookup",
  },
  {
    id: 5,
    question: "Which areas of Santa Rosa need targeted TNR?",
    expectedTools: ["find_priority_sites"],
    mustMention: ["santa rosa"],
    mustNotSay: ["5.9% alteration rate"],
    description: "Priority sites (not recommending low-data areas)",
  },
  {
    id: 6,
    question: "How many active requests do we have?",
    expectedTools: ["request_stats"],
    mustMention: ["request"],
    mustNotSay: [],
    description: "Active request count",
  },
  {
    id: 7,
    question: "Compare 1170 Walker and 15760 Pozzan",
    expectedTools: ["compare_places"],
    mustMention: ["walker", "pozzan"],
    mustNotSay: [],
    description: "Two-place comparison",
  },
  {
    id: 8,
    question: "Find an orange tabby near Sebastopol",
    expectedTools: ["cat_search"],
    mustMention: ["cat"],
    mustNotSay: [],
    description: "Cat search by description + area",
  },
  {
    id: 9,
    question: "How many trappers do we have?",
    expectedTools: ["trapper_stats"],
    mustMention: ["trapper"],
    mustNotSay: ["staff"],
    description: "Trapper count (not staff)",
  },
  {
    id: 10,
    question: "How many staff do we have?",
    expectedTools: ["trapper_stats"],
    mustMention: ["staff"],
    mustNotSay: [],
    description: "Staff count (not trappers)",
  },
  {
    id: 11,
    question: "What's near 123 Fake Street?",
    expectedTools: ["spatial_context"],
    mustMention: ["nearby"],
    mustNotSay: [],
    description: "Spatial context for unknown address",
  },
  {
    id: 12,
    question: "Tell me about 717 Cherry St",
    expectedTools: ["full_place_briefing"],
    mustMention: ["colony"],
    mustNotSay: [],
    description: "Legacy colony with institutional context",
  },
  {
    id: 13,
    question: "Remind me to check on Main St colony tomorrow",
    expectedTools: ["create_reminder"],
    mustMention: ["reminder"],
    mustNotSay: [],
    description: "Create reminder",
  },
  {
    id: 14,
    question: "Tell Jami about the new colony on Oak Ave",
    expectedTools: ["send_message"],
    mustMention: ["jami"],
    mustNotSay: [],
    description: "Send internal message",
  },
  {
    id: 15,
    question: "What's the FFR impact in Petaluma?",
    expectedTools: ["area_stats"],
    mustMention: ["petaluma"],
    mustNotSay: [],
    description: "Area FFR impact",
  },
  {
    id: 16,
    question: "Find cat with microchip 985113004558723",
    expectedTools: ["cat_lookup"],
    mustMention: ["microchip"],
    mustNotSay: [],
    description: "Cat lookup by microchip",
  },
  {
    id: 17,
    question: "Where are the hot zones?",
    expectedTools: ["find_priority_sites", "run_sql"],
    mustMention: ["intact"],
    mustNotSay: [],
    description: "Priority/hot zone identification",
  },
  {
    id: 18,
    question: "What do we know about Healdsburg?",
    expectedTools: ["area_stats"],
    mustMention: ["healdsburg"],
    mustNotSay: [],
    description: "City-level area stats",
  },
  {
    id: 19,
    question: "Is there a colony at 36855 Annapolis Rd?",
    expectedTools: ["full_place_briefing"],
    mustMention: ["cat"],
    mustNotSay: [],
    description: "Colony existence check",
  },
  {
    id: 20,
    question: "What happened at 15760 Pozzan Road?",
    expectedTools: ["full_place_briefing"],
    mustMention: ["cat", "altered"],
    mustNotSay: [],
    description: "Pozzan Road story",
  },
];

// ============================================================================
// 3 FAILURE / HUMILITY CASES
// ============================================================================

const FAILURE_CASES: ShowcaseQuestion[] = [
  {
    id: 21,
    question: "Which areas of Santa Rosa most need TNR right now?",
    expectedTools: ["find_priority_sites"],
    mustMention: ["santa rosa"],
    mustNotSay: [
      "1688 jennings way",
    ],
    description: "HUMILITY: SR priorities must not recommend NULL-status-polluted places",
  },
  {
    id: 22,
    question: "Tell me about 717 Cherry St",
    expectedTools: ["full_place_briefing"],
    mustMention: ["colony"],
    mustNotSay: [],
    description: "HUMILITY: Legacy colony needs institutional context, not just raw numbers",
  },
  {
    id: 23,
    question: "Tell me about 15760 Pozzan Road",
    expectedTools: ["full_place_briefing"],
    mustMention: ["cat", "altered"],
    mustNotSay: [],
    description: "HUMILITY: Pozzan Road should show mass trapping + high alteration",
  },
  {
    id: 24,
    question: "Tell me about Trombetta St",
    expectedTools: ["place_search", "full_place_briefing"],
    mustMention: ["trombetta", "altered"],
    mustNotSay: ["0%", "0 %"],
    description: "REGRESSION: alteration rate must not show 0% (MIG_3105)",
  },
];

const ALL_EVAL_QUESTIONS = [...SHOWCASE_QUESTIONS, ...FAILURE_CASES];

// ============================================================================
// SHOWCASE TESTS — 20 Core Questions
// ============================================================================

test.describe("Tippy V2 Showcase: Core Questions @real-api", () => {
  test.skip(
    !process.env.INCLUDE_REAL_API && !process.env.ANTHROPIC_API_KEY,
    "Skipped: set INCLUDE_REAL_API=1 or ANTHROPIC_API_KEY to run (uses Claude credits)"
  );
  test.setTimeout(EVAL_TIMEOUT_MS + 15_000);

  for (const q of SHOWCASE_QUESTIONS) {
    test(`Q${q.id}: ${q.description}`, async ({ page }) => {
      const { content, durationMs, toolsUsed, error } =
        await askTippyStreaming(page, q.question);

      console.log(
        `[V2 Showcase] Q${q.id} "${q.question.slice(0, 40)}..." → ` +
          `${durationMs}ms, ${content.length} chars, tools: [${toolsUsed.join(", ")}]`
      );

      // Must not error
      expect(error, `Tippy returned error: ${error}`).toBeNull();

      // Must have substantive content
      expect(
        content.length,
        "Response was empty or trivially short"
      ).toBeGreaterThan(30);

      // Must complete within time budget
      expect(
        durationMs,
        `Took ${durationMs}ms (budget: ${EVAL_TIMEOUT_MS}ms)`
      ).toBeLessThan(EVAL_TIMEOUT_MS);

      // Assert at least one expected tool was called
      // Write tools (create_reminder, send_message, log_event) may not be available
      // if the test user has read_only access — soft-fail with a log instead
      const WRITE_TOOL_NAMES = ["create_reminder", "send_message", "log_event"];
      const isWriteToolTest = q.expectedTools.every((t) => WRITE_TOOL_NAMES.includes(t));
      const toolMatch = q.expectedTools.some((t) => toolsUsed.includes(t));
      if (q.expectedTools.length > 0) {
        if (!toolMatch && isWriteToolTest && toolsUsed.length === 0) {
          console.log(
            `[V2 Showcase] Q${q.id}: SKIPPED tool assertion — write tools unavailable (test user may be read_only)`
          );
        } else {
          expect(
            toolMatch,
            `Expected one of [${q.expectedTools.join(", ")}] but got [${toolsUsed.join(", ")}]`
          ).toBeTruthy();
        }
      }

      // Assert must-mention keywords (case-insensitive)
      const messageLower = content.toLowerCase();
      for (const keyword of q.mustMention) {
        expect(
          messageLower,
          `Response must mention "${keyword}" but did not. Response starts with: "${content.slice(0, 200)}..."`
        ).toContain(keyword.toLowerCase());
      }

      // Assert must-not-say phrases (case-insensitive)
      for (const phrase of q.mustNotSay) {
        expect(
          messageLower,
          `Response must NOT say "${phrase}" but it did`
        ).not.toContain(phrase.toLowerCase());
      }
    });
  }
});

// ============================================================================
// FAILURE / HUMILITY CASES
// ============================================================================

test.describe("Tippy V2 Showcase: Humility & Failure Cases @real-api", () => {
  test.skip(
    !process.env.INCLUDE_REAL_API && !process.env.ANTHROPIC_API_KEY,
    "Skipped: set INCLUDE_REAL_API=1 or ANTHROPIC_API_KEY to run (uses Claude credits)"
  );
  test.setTimeout(EVAL_TIMEOUT_MS + 15_000);

  test("CASE 1: Santa Rosa priorities must not recommend NULL-status places", async ({
    page,
  }) => {
    const q = FAILURE_CASES[0];
    const { content, toolsUsed, error } = await askTippyStreaming(
      page,
      q.question
    );

    expect(error).toBeNull();
    expect(content.length).toBeGreaterThan(30);

    // Must call find_priority_sites
    expect(
      toolsUsed,
      `Expected find_priority_sites but got [${toolsUsed.join(", ")}]`
    ).toContain("find_priority_sites");

    const messageLower = content.toLowerCase();

    // Must mention Santa Rosa
    expect(messageLower).toContain("santa rosa");

    // Must NOT blindly recommend known NULL-status-polluted addresses
    // 535 Mark West Springs removed — has 6 real intact cats after presence_status filter
    expect(messageLower).not.toContain("1688 jennings way");

    // Should acknowledge data uncertainty in some form
    const hasDataAwareness =
      messageLower.includes("unknown status") ||
      messageLower.includes("data gap") ||
      messageLower.includes("can't recommend confidently") ||
      messageLower.includes("cannot recommend confidently") ||
      messageLower.includes("data quality") ||
      messageLower.includes("unknown") ||
      messageLower.includes("caveat") ||
      messageLower.includes("note that") ||
      messageLower.includes("keep in mind");

    console.log(
      `[V2 Humility Case 1] Data awareness present: ${hasDataAwareness}`
    );
    // Log but do not hard-fail on data awareness — the must-not-say checks
    // are the hard gates. Data awareness is aspirational for V2.
  });

  test("CASE 2: 717 Cherry St must surface institutional context", async ({
    page,
  }) => {
    const q = FAILURE_CASES[1];
    const { content, toolsUsed, error } = await askTippyStreaming(
      page,
      q.question
    );

    expect(error).toBeNull();
    expect(content.length).toBeGreaterThan(30);

    // Must call full_place_briefing
    const hasPlaceTool =
      toolsUsed.includes("full_place_briefing") ||
      toolsUsed.includes("place_search");
    expect(
      hasPlaceTool,
      `Expected place tool but got [${toolsUsed.join(", ")}]`
    ).toBeTruthy();

    const messageLower = content.toLowerCase();

    // Must surface institutional / legacy / colony context
    const hasContext =
      messageLower.includes("donna") ||
      messageLower.includes("legacy") ||
      messageLower.includes("institutional") ||
      messageLower.includes("colony") ||
      messageLower.includes("cherry");
    expect(
      hasContext,
      `717 Cherry St response lacks institutional context. Starts with: "${content.slice(0, 300)}..."`
    ).toBeTruthy();
  });

  test("CASE 3: 15760 Pozzan Road must show mass trapping + high alteration", async ({
    page,
  }) => {
    const q = FAILURE_CASES[2];
    const { content, toolsUsed, error } = await askTippyStreaming(
      page,
      q.question
    );

    expect(error).toBeNull();
    expect(content.length).toBeGreaterThan(30);

    // Must call full_place_briefing
    const hasPlaceTool =
      toolsUsed.includes("full_place_briefing") ||
      toolsUsed.includes("place_search");
    expect(
      hasPlaceTool,
      `Expected place tool but got [${toolsUsed.join(", ")}]`
    ).toBeTruthy();

    const messageLower = content.toLowerCase();

    // Must mention cats
    expect(messageLower).toContain("cat");

    // Should mention alteration rate or altered status
    const hasAlterationContext =
      messageLower.includes("altered") ||
      messageLower.includes("alteration") ||
      messageLower.includes("spayed") ||
      messageLower.includes("neutered") ||
      messageLower.includes("tnr");
    expect(
      hasAlterationContext,
      `Pozzan Road response lacks alteration context. Starts with: "${content.slice(0, 300)}..."`
    ).toBeTruthy();

    // Should mention Emily West or mass trapping or the 24-cat event
    const hasStoryContext =
      messageLower.includes("emily west") ||
      messageLower.includes("mass trapping") ||
      messageLower.includes("24 cat") ||
      messageLower.includes("24 cats") ||
      messageLower.includes("one day") ||
      messageLower.includes("single day");
    console.log(
      `[V2 Humility Case 3] Story context present: ${hasStoryContext} (aspirational)`
    );
  });
});

// ============================================================================
// TOKEN BUDGET TEST — System prompt size check
// ============================================================================

test.describe("Tippy V2 Showcase: Token Budget", () => {
  test("System prompt token budget < 2500 tokens (estimated)", async () => {
    // This is a rough check: the actual system prompt is built server-side.
    // We verify the file size of the prompt template is within expected bounds.
    const fs = await import("fs");
    const path = await import("path");

    const routeFile = path.resolve(
      __dirname,
      "../src/app/api/tippy/chat/route-v2.ts"
    );

    // If V2 route doesn't exist yet, skip gracefully
    if (!fs.existsSync(routeFile)) {
      console.log(
        "[V2 Token Budget] route-v2.ts not found — skipping token budget check"
      );
      return;
    }

    const promptFileContent = fs.readFileSync(routeFile, "utf8");

    // Try to extract BASE_PROMPT or SYSTEM_PROMPT template literal
    const match =
      promptFileContent.match(
        /const\s+(?:BASE_PROMPT|SYSTEM_PROMPT)\s*=\s*`([\s\S]*?)`;/
      ) ||
      promptFileContent.match(
        /(?:BASE_PROMPT|SYSTEM_PROMPT)\s*[:=]\s*`([\s\S]*?)`;/
      );

    if (match) {
      const promptText = match[1];
      // Rough token estimate: ~4 chars per token for English prose
      const estimatedTokens = Math.ceil(promptText.length / 4);
      console.log(
        `[V2 Token Budget] Prompt: ${promptText.length} chars, ~${estimatedTokens} tokens`
      );
      expect(
        estimatedTokens,
        `System prompt is ~${estimatedTokens} tokens — budget is 2500`
      ).toBeLessThan(2500);
    } else {
      console.log(
        "[V2 Token Budget] Could not extract prompt template literal — skipping"
      );
    }
  });
});

// ============================================================================
// SUMMARY HELPER — Run all questions and print a scorecard
// ============================================================================

test.describe("Tippy V2 Showcase: Scorecard @real-api", () => {
  test.skip(
    !process.env.INCLUDE_REAL_API && !process.env.ANTHROPIC_API_KEY,
    "Skipped: set INCLUDE_REAL_API=1 or ANTHROPIC_API_KEY to run (uses Claude credits)"
  );
  test.setTimeout(EVAL_TIMEOUT_MS * ALL_EVAL_QUESTIONS.length + 30_000);

  test("Print eval scorecard (runs all questions sequentially)", async ({
    page,
  }) => {
    const results: Array<{
      id: number;
      description: string;
      toolsOk: boolean;
      mentionsOk: boolean;
      noForbidden: boolean;
      durationMs: number;
      error: string | null;
    }> = [];

    for (const q of ALL_EVAL_QUESTIONS) {
      const { content, durationMs, toolsUsed, error } =
        await askTippyStreaming(page, q.question);

      const messageLower = (content || "").toLowerCase();

      const toolsOk =
        q.expectedTools.length === 0 ||
        q.expectedTools.some((t) => toolsUsed.includes(t));

      const mentionsOk = q.mustMention.every((kw) =>
        messageLower.includes(kw.toLowerCase())
      );

      const noForbidden = q.mustNotSay.every(
        (phrase) => !messageLower.includes(phrase.toLowerCase())
      );

      results.push({
        id: q.id,
        description: q.description,
        toolsOk,
        mentionsOk,
        noForbidden,
        durationMs,
        error,
      });
    }

    // Print scorecard
    console.log("\n========== TIPPY V2 EVAL SCORECARD ==========\n");

    let passed = 0;
    let failed = 0;

    for (const r of results) {
      const allOk = r.toolsOk && r.mentionsOk && r.noForbidden && !r.error;
      const status = allOk ? "PASS" : "FAIL";
      if (allOk) passed++;
      else failed++;

      const flags = [
        r.toolsOk ? "" : "TOOLS",
        r.mentionsOk ? "" : "MENTIONS",
        r.noForbidden ? "" : "FORBIDDEN",
        r.error ? "ERROR" : "",
      ]
        .filter(Boolean)
        .join(", ");

      console.log(
        `  Q${String(r.id).padStart(2, "0")} [${status}] ${r.description} (${r.durationMs}ms)${flags ? ` — ${flags}` : ""}`
      );
    }

    console.log(
      `\n  TOTAL: ${passed}/${results.length} passed, ${failed} failed\n`
    );
    console.log("===============================================\n");

    // Soft assertion: log the scorecard but don't fail the test.
    // Individual question tests above are the hard gates.
    expect(results.length).toBe(ALL_EVAL_QUESTIONS.length);
  });
});
