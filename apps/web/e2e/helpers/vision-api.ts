/**
 * Vision-Based UI Verification using Claude
 *
 * Uses Claude's vision capabilities to semantically verify UI correctness.
 * Unlike pixel comparison, this understands WHAT should be on screen.
 *
 * Usage:
 *   // Tag tests with @vision-api to skip by default (costs money)
 *   test('@vision-api request page renders correctly', async ({ page }) => {
 *     const result = await verifyPageWithVision(page, {
 *       pageType: 'request-detail',
 *       expectations: ['Status badge visible', 'Colony stats in sidebar'],
 *       knownGaps: ['May have 0 linked cats'],
 *     });
 *     expect(result.passed).toBe(true);
 *   });
 *
 * Models & Approximate Costs (per verification, ~1 screenshot):
 *   - haiku:  ~$0.003 (fastest, good for structure checks)
 *   - sonnet: ~$0.010 (balanced, recommended for most tests)
 *   - opus:   ~$0.020 (most accurate, for nuanced assessments)
 *
 * Run: INCLUDE_VISION_API=1 npm run test:e2e:vision
 */

import Anthropic from "@anthropic-ai/sdk";
import { Page } from "@playwright/test";

// ============================================================================
// TYPES
// ============================================================================

export interface VisionVerificationResult {
  passed: boolean;
  confidence: number; // 0-1
  findings: {
    expectation: string;
    met: boolean;
    details: string;
  }[];
  issues: string[];
  knownGapsDetected: string[];
  summary: string;
  rawResponse?: string;
}

export interface VisionVerificationOptions {
  /** Type of page being tested */
  pageType:
    | "request-detail"
    | "person-detail"
    | "place-detail"
    | "cat-detail"
    | "intake-queue"
    | "list-view"
    | "custom";

  /** What should be visible/correct */
  expectations: string[];

  /** Known issues that should NOT be flagged as errors */
  knownGaps?: string[];

  /** Additional context about the page state */
  context?: string;

  /** Model to use (haiku is cheapest, opus is most accurate) */
  model?: "haiku" | "sonnet" | "opus";

  /** Custom prompt (overrides default) */
  customPrompt?: string;
}

// ============================================================================
// PAGE TYPE PROMPTS
// ============================================================================

const PAGE_TYPE_CONTEXTS: Record<string, string> = {
  "request-detail": `
This is a TNR (Trap-Neuter-Return) request detail page. It should have:
- Header with request title, status badge, and priority badge
- Two-column layout (main content + sidebar)
- TabBar at bottom with tabs: Linked Cats, Photos, Activity, Admin
- Sidebar with colony stats, quick stats, and location info
- Action buttons (Edit, History, etc.)
`,

  "person-detail": `
This is a person detail page showing a contact/client. It should have:
- Header with person name and role badges (if trapper/volunteer)
- Contact information (email, phone)
- Two-column layout with sidebar stats
- TabBar with tabs: Details, History, Admin
- Linked entities (cats, places)
`,

  "place-detail": `
This is a place/location detail page. It should have:
- Header with address and place type badge
- Map showing location
- Colony estimates (if applicable)
- TabBar with tabs: Details, Requests, Ecology, Media
- Linked people and cats sections
`,

  "cat-detail": `
This is a cat detail page. It should have:
- Header with cat name and photo (if available)
- Medical info (altered status, microchip)
- Linked people and places
- Clinic history
`,

  "intake-queue": `
This is the intake queue page showing web form submissions. It should have:
- List of submission cards on the left
- Detail panel on the right when a submission is selected
- Status indicators and filtering options
- Action buttons for processing submissions
`,

  "list-view": `
This is a list/table view page. It should have:
- Filter controls
- Data table or card grid
- Pagination if applicable
- Search functionality
`,

  custom: "",
};

// ============================================================================
// CORE VERIFICATION FUNCTION
// ============================================================================

/**
 * Verify a page's visual correctness using Claude Vision
 */
export async function verifyPageWithVision(
  page: Page,
  options: VisionVerificationOptions
): Promise<VisionVerificationResult> {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      passed: false,
      confidence: 0,
      findings: [],
      issues: ["ANTHROPIC_API_KEY not set - cannot run vision verification"],
      knownGapsDetected: [],
      summary: "Vision verification skipped - no API key",
    };
  }

  // Take screenshot
  const screenshot = await page.screenshot({ type: "png", fullPage: true });
  const base64Image = screenshot.toString("base64");

  // Build prompt
  const prompt = buildVerificationPrompt(options);

  // Select model - using latest versions for best accuracy
  // Pricing per MTok: Haiku $1/$5, Sonnet $3/$15, Opus $5/$25
  const modelMap = {
    haiku: "claude-haiku-4-5-20251001", // Fastest, cheapest (~$0.003/verification)
    sonnet: "claude-sonnet-4-6",         // Best balance (~$0.01/verification)
    opus: "claude-opus-4-6",             // Most accurate (~$0.02/verification)
  };
  const model = modelMap[options.model || "haiku"];

  // Call Claude Vision API
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64Image,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    });

    // Parse response
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    return parseVerificationResponse(content.text, options);
  } catch (error) {
    return {
      passed: false,
      confidence: 0,
      findings: [],
      issues: [`Vision API error: ${(error as Error).message}`],
      knownGapsDetected: [],
      summary: "Vision verification failed due to API error",
    };
  }
}

// ============================================================================
// PROMPT BUILDING
// ============================================================================

function buildVerificationPrompt(options: VisionVerificationOptions): string {
  if (options.customPrompt) {
    return options.customPrompt;
  }

  const pageContext =
    PAGE_TYPE_CONTEXTS[options.pageType] || PAGE_TYPE_CONTEXTS.custom;

  return `
You are a UI testing assistant for Atlas, a TNR (Trap-Neuter-Return) cat management system.

Analyze this screenshot and verify the following expectations are met.

## Page Context
${pageContext}
${options.context ? `\nAdditional context: ${options.context}` : ""}

## Expectations to Verify
${options.expectations.map((e, i) => `${i + 1}. ${e}`).join("\n")}

## Known Acceptable Issues (DO NOT flag these as problems)
${
  options.knownGaps?.length
    ? options.knownGaps.map((g) => `- ${g}`).join("\n")
    : "- None specified"
}

## Response Format
Respond with a JSON object (no markdown code blocks):
{
  "passed": boolean,
  "confidence": number between 0 and 1,
  "findings": [
    {
      "expectation": "the expectation text",
      "met": boolean,
      "details": "explanation of what you see"
    }
  ],
  "issues": ["any problems found that are NOT in known gaps"],
  "knownGapsDetected": ["any known gaps you observed"],
  "summary": "1-2 sentence overall assessment"
}

Be strict about expectations but lenient about known gaps.
If an expectation is partially met, explain what's missing.
`.trim();
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

function parseVerificationResponse(
  responseText: string,
  options: VisionVerificationOptions
): VisionVerificationResult {
  try {
    // Try to extract JSON from response (may be wrapped in markdown)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    return {
      passed: parsed.passed ?? false,
      confidence: parsed.confidence ?? 0,
      findings: parsed.findings ?? [],
      issues: parsed.issues ?? [],
      knownGapsDetected: parsed.knownGapsDetected ?? [],
      summary: parsed.summary ?? "No summary provided",
      rawResponse: responseText,
    };
  } catch {
    // If JSON parsing fails, try to extract meaning from text
    const passed =
      responseText.toLowerCase().includes("passed") ||
      responseText.toLowerCase().includes("all expectations met");

    return {
      passed,
      confidence: 0.5,
      findings: options.expectations.map((e) => ({
        expectation: e,
        met: passed,
        details: "Could not parse structured response",
      })),
      issues: passed ? [] : ["Could not parse verification response"],
      knownGapsDetected: [],
      summary: responseText.slice(0, 200),
      rawResponse: responseText,
    };
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick verification for a specific element
 */
export async function verifyElementWithVision(
  page: Page,
  elementDescription: string,
  expectedState?: string
): Promise<{ found: boolean; details: string }> {
  const result = await verifyPageWithVision(page, {
    pageType: "custom",
    expectations: [
      `${elementDescription}${expectedState ? ` should be ${expectedState}` : " should be visible"}`,
    ],
    model: "haiku",
  });

  return {
    found: result.findings[0]?.met ?? false,
    details: result.findings[0]?.details ?? result.summary,
  };
}

/**
 * Verify TabBar is present with correct tabs
 */
export async function verifyTabBarWithVision(
  page: Page,
  expectedTabs: string[]
): Promise<VisionVerificationResult> {
  return verifyPageWithVision(page, {
    pageType: "custom",
    expectations: [
      "TabBar navigation component is visible",
      ...expectedTabs.map((tab) => `Tab labeled "${tab}" is present`),
    ],
    context: "Looking at the TabBar component which has styled buttons for navigation",
    model: "haiku",
  });
}

/**
 * Verify data table displays correctly
 */
export async function verifyDataTableWithVision(
  page: Page,
  options: {
    columns: string[];
    expectedRowCount?: number;
    emptyStateAllowed?: boolean;
  }
): Promise<VisionVerificationResult> {
  const expectations = [
    "Data table or list is visible",
    ...options.columns.map((col) => `Column/field "${col}" is visible`),
  ];

  if (options.expectedRowCount !== undefined) {
    expectations.push(
      `Table has approximately ${options.expectedRowCount} rows`
    );
  }

  return verifyPageWithVision(page, {
    pageType: "list-view",
    expectations,
    knownGaps: options.emptyStateAllowed
      ? ["Table may be empty with 'no data' message"]
      : undefined,
    model: "haiku",
  });
}

// ============================================================================
// MOCK FOR CI/TESTING
// ============================================================================

/**
 * Mock the vision API for tests that shouldn't incur API costs
 */
export function mockVisionVerification(
  result: Partial<VisionVerificationResult> = {}
): VisionVerificationResult {
  return {
    passed: true,
    confidence: 1,
    findings: [],
    issues: [],
    knownGapsDetected: [],
    summary: "Mocked verification - all expectations assumed met",
    ...result,
  };
}

/**
 * Check if vision tests should run (based on env var)
 */
export function shouldRunVisionTests(): boolean {
  return process.env.INCLUDE_VISION_API === "1";
}
