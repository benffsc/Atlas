import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";
import { logFieldEdit } from "@/lib/audit";

interface BlacklistRow {
  id: string;
  identifier_type: string;
  identifier_norm: string;
  reason: string;
  require_name_similarity: number | null;
  auto_detected: boolean;
  created_at: string;
  created_by: string | null;
}

/**
 * GET /api/admin/blacklist?type=email&q=search
 * List all soft blacklist entries, optionally filtered.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const type = request.nextUrl.searchParams.get("type");
    const q = request.nextUrl.searchParams.get("q");

    let sql = `SELECT id, identifier_type, identifier_norm, reason,
                      require_name_similarity, auto_detected, created_at, created_by
               FROM sot.soft_blacklist WHERE 1=1`;
    const params: unknown[] = [];

    if (type) {
      params.push(type);
      sql += ` AND identifier_type = $${params.length}`;
    }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      sql += ` AND (LOWER(identifier_norm) LIKE $${params.length} OR LOWER(reason) LIKE $${params.length})`;
    }

    sql += ` ORDER BY identifier_type, identifier_norm`;

    const entries = await queryRows<BlacklistRow>(sql, params);
    return apiSuccess({ entries, total: entries.length });
  } catch (error) {
    console.error("Failed to fetch blacklist:", error);
    return apiServerError("Failed to fetch blacklist");
  }
}

/**
 * POST /api/admin/blacklist
 * Add a new blacklist entry. Admin only.
 * Body: { identifier_type, identifier_norm, reason }
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can manage blacklist");

  try {
    const body = await request.json();
    const { identifier_type, identifier_norm, reason } = body;

    if (!identifier_type || !["email", "phone"].includes(identifier_type)) {
      return apiBadRequest("identifier_type must be 'email' or 'phone'");
    }
    if (!identifier_norm || typeof identifier_norm !== "string") {
      return apiBadRequest("identifier_norm is required");
    }
    if (!reason || typeof reason !== "string") {
      return apiBadRequest("reason is required");
    }

    const created = await queryOne<BlacklistRow>(
      `INSERT INTO sot.soft_blacklist (identifier_type, identifier_norm, reason, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, identifier_type, identifier_norm, reason, require_name_similarity, auto_detected, created_at, created_by`,
      [identifier_type, identifier_norm.toLowerCase().trim(), reason, session.display_name]
    );

    // Audit trail for blacklist addition
    if (created) {
      await logFieldEdit("soft_blacklist" as any, created.id, "identifier", null, {
        identifier_type, identifier_norm: identifier_norm.toLowerCase().trim(), reason,
      }, { editedBy: session.display_name || "admin", editSource: "web_ui", reason: "blacklist_add" });
    }

    return apiSuccess(created);
  } catch (error) {
    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes("unique")) {
      return apiBadRequest("This identifier is already blacklisted");
    }
    console.error("Failed to add blacklist entry:", error);
    return apiServerError("Failed to add blacklist entry");
  }
}

/**
 * DELETE /api/admin/blacklist?id=UUID
 * Remove a blacklist entry. Admin only.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") return apiForbidden("Only admins can manage blacklist");

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return apiBadRequest("Missing 'id' query parameter");

    // Fetch entry before deleting for audit trail
    const entry = await queryOne<BlacklistRow>(
      "SELECT * FROM sot.soft_blacklist WHERE id = $1",
      [id]
    );

    const deleted = await queryOne<{ id: string }>(
      "DELETE FROM sot.soft_blacklist WHERE id = $1 RETURNING id",
      [id]
    );

    if (!deleted) return apiNotFound("Blacklist entry", id);

    // Audit trail for blacklist removal
    if (entry) {
      await logFieldEdit("soft_blacklist" as any, id, "identifier", {
        identifier_type: entry.identifier_type, identifier_norm: entry.identifier_norm, reason: entry.reason,
      }, null, { editedBy: session.display_name || "admin", editSource: "web_ui", reason: "blacklist_remove" });
    }

    return apiSuccess({ deleted: id });
  } catch (error) {
    console.error("Failed to delete blacklist entry:", error);
    return apiServerError("Failed to delete blacklist entry");
  }
}
