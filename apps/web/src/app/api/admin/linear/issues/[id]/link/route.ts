/**
 * Linear Issue ↔ Atlas Request Linking API
 *
 * POST   - Link issue to Atlas request
 * DELETE - Unlink issue from Atlas request
 */

import { NextRequest } from "next/server";
import { queryOne, query } from "@/lib/db";
import {
  apiSuccess,
  apiBadRequest,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

// ============================================================================
// POST - Link Issue to Atlas Request
// ============================================================================

interface LinkBody {
  atlas_request_id: string;
  linked_by?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: LinkBody = await request.json();

    if (!body.atlas_request_id) {
      return apiBadRequest("atlas_request_id is required");
    }

    requireValidUUID(body.atlas_request_id, "request");

    // Find the Linear issue
    const issue = await queryOne<{ linear_id: string; identifier: string; atlas_request_id: string | null }>(
      `SELECT linear_id, identifier, atlas_request_id
       FROM ops.linear_issues
       WHERE linear_id = $1 OR identifier = $1
       LIMIT 1`,
      [id]
    );

    if (!issue) {
      return apiNotFound("Issue", id);
    }

    if (issue.atlas_request_id) {
      return apiBadRequest(`Issue ${issue.identifier} is already linked to request ${issue.atlas_request_id}`);
    }

    // Verify Atlas request exists
    const atlasRequest = await queryOne<{ request_id: string; status: string }>(
      `SELECT request_id, status FROM ops.requests WHERE request_id = $1`,
      [body.atlas_request_id]
    );

    if (!atlasRequest) {
      return apiNotFound("Request", body.atlas_request_id);
    }

    // Create the link
    await query(
      `UPDATE ops.linear_issues
       SET atlas_request_id = $2,
           atlas_linked_at = NOW(),
           atlas_linked_by = $3
       WHERE linear_id = $1`,
      [issue.linear_id, body.atlas_request_id, body.linked_by || "web_user"]
    );

    // Log to journal
    await query(
      `INSERT INTO ops.journal_entries (
         primary_request_id, entry_kind, body, meta, created_at
       ) VALUES (
         $1, 'linear_linked', $2, $3, NOW()
       )`,
      [
        body.atlas_request_id,
        `Linked to Linear issue ${issue.identifier}`,
        JSON.stringify({
          linear_id: issue.linear_id,
          linear_identifier: issue.identifier,
          linked_by: body.linked_by || "web_user",
        }),
      ]
    );

    return apiSuccess({
      linked: true,
      linear_id: issue.linear_id,
      linear_identifier: issue.identifier,
      atlas_request_id: body.atlas_request_id,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error linking Linear issue:", error);
    return apiServerError("Failed to link issue");
  }
}

// ============================================================================
// DELETE - Unlink Issue from Atlas Request
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Find the Linear issue
    const issue = await queryOne<{
      linear_id: string;
      identifier: string;
      atlas_request_id: string | null;
    }>(
      `SELECT linear_id, identifier, atlas_request_id
       FROM ops.linear_issues
       WHERE linear_id = $1 OR identifier = $1
       LIMIT 1`,
      [id]
    );

    if (!issue) {
      return apiNotFound("Issue", id);
    }

    if (!issue.atlas_request_id) {
      return apiBadRequest(`Issue ${issue.identifier} is not linked to any Atlas request`);
    }

    const previousRequestId = issue.atlas_request_id;

    // Remove the link
    await query(
      `UPDATE ops.linear_issues
       SET atlas_request_id = NULL,
           atlas_linked_at = NULL,
           atlas_linked_by = NULL
       WHERE linear_id = $1`,
      [issue.linear_id]
    );

    // Log to journal
    await query(
      `INSERT INTO ops.journal_entries (
         primary_request_id, entry_kind, body, meta, created_at
       ) VALUES (
         $1, 'linear_unlinked', $2, $3, NOW()
       )`,
      [
        previousRequestId,
        `Unlinked from Linear issue ${issue.identifier}`,
        JSON.stringify({
          linear_id: issue.linear_id,
          linear_identifier: issue.identifier,
        }),
      ]
    );

    return apiSuccess({
      unlinked: true,
      linear_id: issue.linear_id,
      linear_identifier: issue.identifier,
      previous_atlas_request_id: previousRequestId,
    });
  } catch (error) {
    console.error("Error unlinking Linear issue:", error);
    return apiServerError("Failed to unlink issue");
  }
}
