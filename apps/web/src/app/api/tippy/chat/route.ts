import { NextRequest } from "next/server";
// FFS-1325: V2 is now the sole handler — 15 entity-lens tools, parameterized prompt
import { handleV2, maxDuration as v2MaxDuration } from "./route-v2";

// Re-export maxDuration for Vercel function timeout (300s on Pro plan)
export const maxDuration = v2MaxDuration;

/**
 * Tippy Chat API — V2
 *
 * All requests route through route-v2.ts which provides:
 * - 15 consolidated entity-lens tools (down from 52)
 * - Parameterized system prompt builder
 * - Single unified agent loop
 *
 * V1 code removed — see git history for prior implementation.
 */
export async function POST(request: NextRequest) {
  return handleV2(request);
}
