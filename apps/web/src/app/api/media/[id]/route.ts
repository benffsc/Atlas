import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/media/[id]
 * Get media details by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const media = await queryOne<{
      media_id: string;
      storage_path: string;
      media_type: string;
      is_hero: boolean;
      request_id: string | null;
      place_id: string | null;
      direct_cat_id: string | null;
      linked_cat_id: string | null;
      person_id: string | null;
      uploaded_at: string;
      uploaded_by: string | null;
    }>(
      `SELECT
        media_id, storage_path, media_type, is_hero,
        request_id, place_id, direct_cat_id, linked_cat_id, person_id,
        uploaded_at, uploaded_by
      FROM ops.request_media
      WHERE media_id = $1 AND is_archived = FALSE`,
      [id]
    );

    if (!media) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }

    return NextResponse.json(media);
  } catch (error) {
    console.error("Get media error:", error);
    return NextResponse.json(
      { error: "Failed to get media" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/media/[id]
 * Archive (soft-delete) a media item
 *
 * Requires authentication. Sets is_archived = TRUE rather than hard deleting.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Check if media exists
    const media = await queryOne<{ media_id: string }>(
      `SELECT media_id FROM ops.request_media
       WHERE media_id = $1 AND is_archived = FALSE`,
      [id]
    );

    if (!media) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }

    // Soft delete by archiving
    const result = await queryOne<{ media_id: string }>(
      `UPDATE ops.request_media
       SET is_archived = TRUE,
           archived_at = NOW(),
           archived_by = $2,
           archive_reason = 'User requested removal'
       WHERE media_id = $1
       RETURNING media_id`,
      [id, session.staff_id || "system"]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to archive media" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      media_id: id,
      message: "Media archived successfully",
    });
  } catch (error) {
    console.error("Delete media error:", error);
    return NextResponse.json(
      { error: "Failed to delete media" },
      { status: 500 }
    );
  }
}
