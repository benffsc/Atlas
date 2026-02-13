import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

type ConfidenceLevel = "confirmed" | "likely" | "uncertain";

interface IdentifyResult {
  media_id: string;
  linked_cat_id: string;
  confidence: ConfidenceLevel;
}

// PATCH /api/media/[id]/identify - Link a photo (or group) to a cat
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: mediaId } = await params;

  try {
    const body = await request.json();
    const {
      cat_id,
      confidence = "confirmed",
      apply_to_group = false,
    } = body;

    // Validate confidence level
    const validConfidence: ConfidenceLevel[] = ["confirmed", "likely", "uncertain"];
    if (!validConfidence.includes(confidence)) {
      return NextResponse.json(
        { error: "Invalid confidence. Must be 'confirmed', 'likely', or 'uncertain'" },
        { status: 400 }
      );
    }

    if (!cat_id) {
      return NextResponse.json(
        { error: "cat_id is required" },
        { status: 400 }
      );
    }

    // Verify cat exists
    const catExists = await queryOne<{ cat_id: string; display_name: string }>(
      "SELECT cat_id, display_name FROM sot.cats WHERE cat_id = $1",
      [cat_id]
    );

    if (!catExists) {
      return NextResponse.json(
        { error: "Cat not found" },
        { status: 404 }
      );
    }

    // Get the media record
    const media = await queryOne<{
      media_id: string;
      photo_group_id: string | null;
      request_id: string;
    }>(
      `SELECT media_id, photo_group_id, request_id
       FROM ops.request_media
       WHERE media_id = $1 AND NOT COALESCE(is_archived, FALSE)`,
      [mediaId]
    );

    if (!media) {
      return NextResponse.json(
        { error: "Media not found" },
        { status: 404 }
      );
    }

    let updatedCount = 0;
    const updatedMediaIds: string[] = [];

    if (apply_to_group && media.photo_group_id) {
      // Use the database function to identify the entire group
      const result = await queryOne<{ identify_photo_group: number }>(
        `SELECT ops.identify_photo_group($1, $2, $3) AS identify_photo_group`,
        [media.photo_group_id, cat_id, confidence]
      );

      updatedCount = result?.identify_photo_group || 0;

      // Get the media IDs that were updated
      const groupMedia = await queryRows<{ media_id: string }>(
        `SELECT media_id FROM ops.request_media
         WHERE photo_group_id = $1 AND NOT COALESCE(is_archived, FALSE)`,
        [media.photo_group_id]
      );

      updatedMediaIds.push(...groupMedia.map((m) => m.media_id));
    } else {
      // Update just this single media
      await queryOne(
        `UPDATE ops.request_media
         SET linked_cat_id = $1,
             cat_identification_confidence = $2
         WHERE media_id = $3`,
        [cat_id, confidence, mediaId]
      );

      updatedCount = 1;
      updatedMediaIds.push(mediaId);
    }

    return NextResponse.json({
      success: true,
      updated_count: updatedCount,
      updated_media_ids: updatedMediaIds,
      cat: {
        cat_id: catExists.cat_id,
        display_name: catExists.display_name,
      },
      confidence,
      applied_to_group: apply_to_group && media.photo_group_id !== null,
    });
  } catch (error) {
    console.error("Error identifying media:", error);
    return NextResponse.json(
      { error: "Failed to identify media" },
      { status: 500 }
    );
  }
}

// DELETE /api/media/[id]/identify - Unlink a photo from a cat
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: mediaId } = await params;

  try {
    const searchParams = request.nextUrl.searchParams;
    const applyToGroup = searchParams.get("apply_to_group") === "true";

    // Get the media record
    const media = await queryOne<{
      media_id: string;
      photo_group_id: string | null;
      linked_cat_id: string | null;
    }>(
      `SELECT media_id, photo_group_id, linked_cat_id
       FROM ops.request_media
       WHERE media_id = $1 AND NOT COALESCE(is_archived, FALSE)`,
      [mediaId]
    );

    if (!media) {
      return NextResponse.json(
        { error: "Media not found" },
        { status: 404 }
      );
    }

    let updatedCount = 0;

    if (applyToGroup && media.photo_group_id) {
      // Unlink entire group
      const result = await queryOne<{ count: number }>(
        `WITH updated AS (
           UPDATE ops.request_media
           SET linked_cat_id = NULL,
               cat_identification_confidence = 'unidentified'
           WHERE photo_group_id = $1 AND NOT COALESCE(is_archived, FALSE)
           RETURNING 1
         )
         SELECT COUNT(*)::int AS count FROM updated`,
        [media.photo_group_id]
      );

      updatedCount = result?.count || 0;
    } else {
      // Unlink just this media
      await queryOne(
        `UPDATE ops.request_media
         SET linked_cat_id = NULL,
             cat_identification_confidence = 'unidentified'
         WHERE media_id = $1`,
        [mediaId]
      );

      updatedCount = 1;
    }

    return NextResponse.json({
      success: true,
      updated_count: updatedCount,
      applied_to_group: applyToGroup && media.photo_group_id !== null,
    });
  } catch (error) {
    console.error("Error unlinking media:", error);
    return NextResponse.json(
      { error: "Failed to unlink media" },
      { status: 500 }
    );
  }
}

// GET /api/media/[id]/identify - Get identification status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: mediaId } = await params;

  try {
    const media = await queryOne<{
      media_id: string;
      linked_cat_id: string | null;
      cat_identification_confidence: string;
      photo_group_id: string | null;
      cat_description: string | null;
    }>(
      `SELECT
        media_id,
        linked_cat_id,
        cat_identification_confidence,
        photo_group_id,
        cat_description
       FROM ops.request_media
       WHERE media_id = $1`,
      [mediaId]
    );

    if (!media) {
      return NextResponse.json(
        { error: "Media not found" },
        { status: 404 }
      );
    }

    // If linked to a cat, get cat details
    let cat = null;
    if (media.linked_cat_id) {
      cat = await queryOne<{ cat_id: string; display_name: string; microchip: string | null }>(
        `SELECT c.cat_id, c.display_name,
                (SELECT id_value FROM sot.cat_identifiers
                 WHERE cat_id = c.cat_id AND id_type = 'microchip' LIMIT 1) AS microchip
         FROM sot.cats c
         WHERE c.cat_id = $1`,
        [media.linked_cat_id]
      );
    }

    // If part of a group, get group info
    let group = null;
    if (media.photo_group_id) {
      group = await queryOne<{
        collection_id: string;
        group_name: string;
        photo_count: number;
      }>(
        `SELECT
          collection_id,
          group_name,
          COALESCE(photo_count, 0)::int AS photo_count
         FROM ops.v_request_photo_groups
         WHERE collection_id = $1`,
        [media.photo_group_id]
      );
    }

    return NextResponse.json({
      media_id: media.media_id,
      is_identified: media.linked_cat_id !== null,
      confidence: media.cat_identification_confidence,
      cat_description: media.cat_description,
      cat,
      group,
    });
  } catch (error) {
    console.error("Error getting identification status:", error);
    return NextResponse.json(
      { error: "Failed to get identification status" },
      { status: 500 }
    );
  }
}
