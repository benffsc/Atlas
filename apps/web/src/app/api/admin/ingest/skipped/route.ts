import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, execute } from "@/lib/db";
import { apiSuccess, apiError, apiBadRequest } from "@/lib/api-response";
import { isValidUUID } from "@/lib/validation";

/**
 * MIG_3049 / FFS-862 / FFS-1150 Initiative 2
 *
 * Admin API for the ops.ingest_skipped review queue.
 *
 * GET  — list unresolved skipped rows (filter by reason / source_system)
 * PATCH — resolve a row (linked / force_created / dismissed)
 */

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiError("Admin access required", 403);
  }

  const { searchParams } = new URL(request.url);
  const reason = searchParams.get("reason");
  const sourceSystem = searchParams.get("source_system");
  const status = searchParams.get("status") || "unresolved"; // unresolved | resolved | all
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let i = 1;

    if (status === "unresolved") {
      conditions.push(`resolved_at IS NULL`);
    } else if (status === "resolved") {
      conditions.push(`resolved_at IS NOT NULL`);
    }

    if (reason) {
      conditions.push(`skip_reason = $${i++}`);
      params.push(reason);
    }

    if (sourceSystem) {
      conditions.push(`source_system = $${i++}`);
      params.push(sourceSystem);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit, offset);

    const rows = await queryRows(
      `SELECT
         skipped_id::text,
         source_system,
         source_table,
         source_record_id,
         source_date,
         file_upload_id::text,
         batch_id::text,
         payload,
         skip_reason,
         notes,
         resolved_at,
         resolved_by::text,
         resolution,
         resolution_notes,
         created_at
       FROM ops.ingest_skipped
       ${where}
       ORDER BY created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );

    const summary = await queryRows(
      `SELECT * FROM ops.v_ingest_skipped_unresolved`
    );

    return apiSuccess({ rows, summary, limit, offset });
  } catch (err) {
    console.error("[ingest/skipped GET] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to load skipped rows",
      500
    );
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return apiError("Admin access required", 403);
  }

  let body: {
    skipped_id?: string;
    resolution?: "linked" | "force_created" | "dismissed";
    resolution_notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  const { skipped_id, resolution, resolution_notes } = body;

  if (!skipped_id || !isValidUUID(skipped_id)) {
    return apiBadRequest("Valid skipped_id (UUID) is required");
  }

  const allowed = new Set(["linked", "force_created", "dismissed"]);
  if (!resolution || !allowed.has(resolution)) {
    return apiBadRequest(
      "resolution must be one of: linked, force_created, dismissed"
    );
  }

  try {
    await execute(
      `UPDATE ops.ingest_skipped
         SET resolved_at = NOW(),
             resolved_by = $1,
             resolution = $2,
             resolution_notes = $3
       WHERE skipped_id = $4
         AND resolved_at IS NULL`,
      [session.staff_id || null, resolution, resolution_notes || null, skipped_id]
    );

    return apiSuccess({ skipped_id, resolution });
  } catch (err) {
    console.error("[ingest/skipped PATCH] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to resolve",
      500
    );
  }
}
