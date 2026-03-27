import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiBadRequest, apiNotFound } from "@/lib/api-response";
import { logFieldEdit } from "@/lib/audit";

// POST /api/colonies/[id]/places - Link a place to colony
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    requireValidUUID(colonyId, "colony");
    const body = await request.json();
    const {
      place_id,
      relationship_type = "colony_site",
      is_primary = false,
      added_by,
    } = body;

    if (!place_id) {
      return apiBadRequest("place_id is required");
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

    // Verify place exists
    const place = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM sot.places WHERE place_id = $1`,
      [place_id]
    );

    if (!place) {
      return apiNotFound("place", place_id);
    }

    // If this is being set as primary, unset other primaries first
    if (is_primary) {
      await queryOne(
        `UPDATE sot.colony_places SET is_primary = FALSE WHERE colony_id = $1`,
        [colonyId]
      );
    }

    // Insert or update the link
    await queryOne(
      `INSERT INTO sot.colony_places (colony_id, place_id, relationship_type, is_primary, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (colony_id, place_id) DO UPDATE SET
         relationship_type = EXCLUDED.relationship_type,
         is_primary = EXCLUDED.is_primary`,
      [colonyId, place_id, relationship_type, is_primary, added_by.trim()]
    );

    return apiSuccess({ linked: true });
  } catch (error) {
    console.error("Error linking place to colony:", error);
    return apiServerError("Failed to link place");
  }
}

// DELETE /api/colonies/[id]/places?placeId=xxx - Unlink a place
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("placeId");

  if (!placeId) {
    return apiBadRequest("placeId query parameter is required");
  }

  try {
    requireValidUUID(colonyId, "colony");
    const result = await queryOne<{ colony_id: string }>(
      `UPDATE sot.colony_places
       SET deactivated_at = NOW(), is_active = FALSE
       WHERE colony_id = $1 AND place_id = $2 AND is_active = TRUE
       RETURNING colony_id`,
      [colonyId, placeId]
    );

    if (!result) {
      return apiNotFound("place link", placeId);
    }

    await logFieldEdit("colony", colonyId, "colony_places", placeId, null, {
      editedBy: "web_user", editSource: "web_ui", reason: "place_unlinked",
    });

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("Error unlinking place:", error);
    return apiServerError("Failed to unlink place");
  }
}
