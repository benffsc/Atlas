import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { AirtableSyncEngine } from "@/lib/airtable-sync-engine";

/** POST /api/admin/airtable-syncs/[id]/trigger — Manual trigger */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "sync_config");

    const engine = new AirtableSyncEngine();
    const result = await engine.runSync(id, "manual");

    return apiSuccess({
      message: `Synced ${result.recordsSynced} records, ${result.recordsErrored} errors`,
      ...result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return apiError(msg, 404);
    }
    if (msg.includes("AIRTABLE_PAT")) {
      return apiError(msg, 503);
    }
    console.error("[ADMIN] Error triggering sync:", error);
    return apiServerError("Failed to trigger sync");
  }
}
