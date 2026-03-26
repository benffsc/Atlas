/**
 * Tippy VCR — Record/Replay for @real-api tests
 *
 * Records real API responses as "cassette" files and replays them
 * deterministically in CI. Eliminates API cost and transient failures
 * for regression testing.
 *
 * Modes (via VCR_MODE env var):
 *   - "off" (default): Normal behavior, no recording/replay
 *   - "record": Makes real API calls and saves responses as cassettes
 *   - "replay": Reads cassettes and skips API calls entirely
 *
 * Usage:
 *   const vcr = createVCR("tippy-domain-coverage");
 *   const result = await vcr.askAndReplay(page, "q-voicemail-01", "How should I triage this?");
 *
 * FFS-803: VCR record/replay for Tippy eval pipeline
 */

import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import { createTippyLogger } from "./tippy-result-logger";

export interface CassetteEntry {
  question: string;
  responseStatus: number;
  responseBody: { message: string; conversationId?: string };
  recordedAt: string;
  model: string;
  responseTimeMs: number;
}

export type VCRMode = "record" | "replay" | "off";

const CASSETTE_DIR = path.join(__dirname, "..", "cassettes");

/**
 * Create a VCR instance scoped to a test file.
 * Wraps the existing TippyLogger with record/replay capabilities.
 */
export function createVCR(testFile: string) {
  const mode = (process.env.VCR_MODE as VCRMode) || "off";
  const logger = createTippyLogger(testFile);

  return {
    /**
     * Ask Tippy a question with VCR record/replay support.
     *
     * - replay: Read cassette, return instantly (no API call)
     * - record: Make real API call via logger, save cassette
     * - off: Make real API call via logger (no cassette interaction)
     */
    async askAndReplay(
      page: Page,
      questionId: string,
      questionText: string,
      options?: {
        testName?: string;
        conversationId?: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      }
    ): Promise<{
      ok: boolean;
      responseText: string;
      conversationId?: string;
      responseTimeMs: number;
    }> {
      const cassettePath = path.join(CASSETTE_DIR, `${questionId}.cassette.json`);

      if (mode === "replay") {
        if (!fs.existsSync(cassettePath)) {
          throw new Error(
            `VCR replay: cassette not found for "${questionId}" at ${cassettePath}. ` +
              `Run with VCR_MODE=record first.`
          );
        }
        const cassette: CassetteEntry = JSON.parse(
          fs.readFileSync(cassettePath, "utf-8")
        );
        return {
          ok: cassette.responseStatus === 200,
          responseText: cassette.responseBody.message,
          conversationId: cassette.responseBody.conversationId,
          responseTimeMs: 0,
        };
      }

      // Record or passthrough: make real API call via logger (has retry)
      const result = await logger.askAndLog(page, questionText, {
        testName: options?.testName || questionId,
        conversationId: options?.conversationId,
        history: options?.history,
      });

      if (mode === "record" && result.ok && result.responseText) {
        fs.mkdirSync(CASSETTE_DIR, { recursive: true });
        const cassette: CassetteEntry = {
          question: questionText,
          responseStatus: 200,
          responseBody: {
            message: result.responseText,
            conversationId: result.conversationId,
          },
          recordedAt: new Date().toISOString(),
          model: process.env.TIPPY_TEST_MODEL || "claude-sonnet-4-20250514",
          responseTimeMs: result.responseTimeMs,
        };
        fs.writeFileSync(cassettePath, JSON.stringify(cassette, null, 2));
      }

      return result;
    },

    /** Current VCR mode */
    get mode(): VCRMode {
      return mode;
    },
  };
}
