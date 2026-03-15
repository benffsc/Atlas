import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { NextRequest } from "next/server";

/**
 * Trigger Status Health Check
 *
 * Checks if a specific database trigger is enabled and its event type.
 *
 * GET /api/health/trigger-status?trigger=trigger_name
 */
export async function GET(request: NextRequest) {
  try {
    const triggerName = request.nextUrl.searchParams.get("trigger");
    if (!triggerName) {
      return apiSuccess({ enabled: false, fires_on: [], error: "No trigger name provided" });
    }

    const result = await queryOne<{
      trigger_name: string;
      event_manipulation: string;
      action_timing: string;
      enabled_text: string;
    }>(`
      SELECT
        trigger_name,
        event_manipulation,
        action_timing,
        CASE
          WHEN tgenabled = 'O' THEN 'ENABLED'
          WHEN tgenabled = 'D' THEN 'DISABLED'
          ELSE 'UNKNOWN'
        END AS enabled_text
      FROM information_schema.triggers ist
      LEFT JOIN pg_trigger t ON t.tgname = ist.trigger_name
      WHERE ist.trigger_name = $1
      LIMIT 1
    `, [triggerName]).catch(() => null);

    if (!result) {
      return apiSuccess({
        enabled: false,
        fires_on: [],
        trigger_name: triggerName,
        exists: false,
      });
    }

    // Get all event types for this trigger
    const events = await queryOne<{ events: string[] }>(`
      SELECT ARRAY_AGG(DISTINCT event_manipulation) AS events
      FROM information_schema.triggers
      WHERE trigger_name = $1
    `, [triggerName]).catch(() => ({ events: [] }));

    return apiSuccess({
      enabled: result.enabled_text !== "DISABLED",
      fires_on: events?.events ?? [result.event_manipulation],
      trigger_name: triggerName,
      action_timing: result.action_timing,
      exists: true,
    });
  } catch (error) {
    console.error("Trigger status check error:", error);
    return apiServerError("Failed to check trigger status");
  }
}
