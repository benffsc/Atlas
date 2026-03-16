import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiBadRequest, apiNotFound } from "@/lib/api-response";
import { logFieldEdit } from "@/lib/audit";

// POST /api/colonies/[id]/requests - Link a request to colony
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    const body = await request.json();
    const { request_id, added_by } = body;

    if (!request_id) {
      return apiBadRequest("request_id is required");
    }

    if (!added_by?.trim()) {
      return apiBadRequest("added_by is required");
    }

    // Verify colony exists (and is not soft-deleted)
    const colony = await queryOne<{ colony_id: string }>(
      `SELECT colony_id FROM sot.colonies WHERE colony_id = $1 AND deleted_at IS NULL`,
      [colonyId]
    );

    if (!colony) {
      return apiNotFound("colony", colonyId);
    }

    // Verify request exists
    const req = await queryOne<{ request_id: string }>(
      `SELECT request_id FROM ops.requests WHERE request_id = $1`,
      [request_id]
    );

    if (!req) {
      return apiNotFound("request", request_id);
    }

    // Insert the link (re-activate if previously soft-deleted, ignore if active)
    await queryOne(
      `INSERT INTO sot.colony_requests (colony_id, request_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (colony_id, request_id) DO UPDATE
         SET deleted_at = NULL, deleted_by = NULL
         WHERE sot.colony_requests.deleted_at IS NOT NULL`,
      [colonyId, request_id, added_by.trim()]
    );

    return apiSuccess({ linked: true });
  } catch (error) {
    console.error("Error linking request to colony:", error);
    return apiServerError("Failed to link request");
  }
}

// DELETE /api/colonies/[id]/requests?requestId=xxx - Unlink a request
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("requestId");

  if (!requestId) {
    return apiBadRequest("requestId query parameter is required");
  }

  try {
    const result = await queryOne<{ colony_id: string }>(
      `UPDATE sot.colony_requests
       SET deleted_at = NOW(), deleted_by = 'web_user'
       WHERE colony_id = $1 AND request_id = $2 AND deleted_at IS NULL
       RETURNING colony_id`,
      [colonyId, requestId]
    );

    if (!result) {
      return apiNotFound("request link", requestId);
    }

    await logFieldEdit("colony", colonyId, "colony_requests", requestId, null, {
      editedBy: "web_user", editSource: "web_ui", reason: "request_unlinked",
    });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("Error unlinking request:", error);
    return apiServerError("Failed to unlink request");
  }
}
