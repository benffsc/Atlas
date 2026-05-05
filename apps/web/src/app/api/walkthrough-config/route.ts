import { query, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

export const revalidate = 60;

export interface WalkthroughSlide {
  id: string;
  type: "title" | "step" | "thankyou";
  step?: number;
  label?: string;
  color?: string;
  headline?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  iframe?: string;
  image?: string;
  org?: string;
  tiers?: { amount: string; outcome: string }[];
}

const DEFAULT_SLIDES: WalkthroughSlide[] = [
  {
    id: "title",
    type: "title",
    headline: "Beacon",
    subtitle: "See how we find, fix, and return community cats — and track every one.",
    org: "Forgotten Felines of Sonoma County",
  },
  {
    id: "find",
    type: "step",
    step: 1,
    label: "Find",
    color: "#f59e0b",
    title: "A community member reports cats on their street",
    body: "Every request starts with a person reaching out. We capture the location, the situation, and how to help — then find it on the map.",
    iframe: "/intake/queue/new",
  },
  {
    id: "fix",
    type: "step",
    step: 2,
    label: "Fix",
    color: "#22c55e",
    title: "We bring them to our clinic",
    body: "FFSC is the only dedicated spay/neuter clinic for community cats in Sonoma County. Every cat gets a medical record, microchip, and ear tip.",
    iframe: "/admin/clinic-days",
  },
  {
    id: "return",
    type: "step",
    step: 3,
    label: "Return",
    color: "#3b82f6",
    title: "They go home — and we track the whole neighborhood",
    body: "Each site isn't isolated. Beacon connects every colony to the places around it, building a regional picture of progress.",
    iframe: "/map?center=38.44,-122.72&zoom=12",
  },
  {
    id: "analyze",
    type: "step",
    step: 4,
    label: "Analyze",
    color: "#8b5cf6",
    title: "Beacon shows us where to focus next",
    body: "Population estimates, alteration rates, seasonal trends — data-driven decisions for every zone in the county.",
    iframe: "/beacon",
  },
  {
    id: "thankyou",
    type: "thankyou",
    title: "With your support, we can reach every colony",
    body: "Every dollar goes directly to helping community cats.",
    tiers: [
      { amount: "$50", outcome: "Spay/neuter one cat" },
      { amount: "$250", outcome: "Cover a full clinic day for a colony" },
      { amount: "$1,000", outcome: "Stabilize an entire neighborhood" },
    ],
  },
];

/**
 * GET /api/walkthrough-config
 * Returns walkthrough slides from ops.app_config, or defaults if none saved.
 */
export async function GET() {
  try {
    const row = await queryOne<{ value: WalkthroughSlide[] }>(
      `SELECT value FROM ops.app_config WHERE key = 'walkthrough.slides'`
    );
    return apiSuccess({ slides: row?.value ?? DEFAULT_SLIDES });
  } catch (error) {
    console.error("Error fetching walkthrough config:", error);
    return apiSuccess({ slides: DEFAULT_SLIDES });
  }
}

/**
 * PUT /api/walkthrough-config
 * Saves walkthrough slides to ops.app_config.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const slides = body.slides;
    if (!Array.isArray(slides)) {
      return apiBadRequest("slides must be an array");
    }
    await query(
      `INSERT INTO ops.app_config (key, value, updated_at)
       VALUES ('walkthrough.slides', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(slides)]
    );
    return apiSuccess({ slides });
  } catch (error) {
    console.error("Error saving walkthrough config:", error);
    return apiServerError("Failed to save walkthrough config");
  }
}
