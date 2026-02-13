import { NextRequest, NextResponse } from "next/server";
import { execute, queryOne } from "@/lib/db";

interface MediaRow {
  media_id: string;
  request_id: string | null;
  place_id: string | null;
  direct_cat_id: string | null;
  person_id: string | null;
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: mediaId } = await params;

  try {
    const media = await queryOne<MediaRow>(
      `SELECT media_id, request_id, place_id, direct_cat_id, person_id
       FROM ops.request_media WHERE media_id = $1 AND is_archived = FALSE`,
      [mediaId]
    );

    if (!media) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }

    // Clear existing hero for each linked entity
    if (media.direct_cat_id) {
      await execute(
        `UPDATE ops.request_media SET is_hero = FALSE WHERE direct_cat_id = $1 AND is_hero = TRUE`,
        [media.direct_cat_id]
      );
    }
    if (media.place_id) {
      await execute(
        `UPDATE ops.request_media SET is_hero = FALSE WHERE place_id = $1 AND is_hero = TRUE`,
        [media.place_id]
      );
    }
    if (media.request_id) {
      await execute(
        `UPDATE ops.request_media SET is_hero = FALSE WHERE request_id = $1 AND is_hero = TRUE`,
        [media.request_id]
      );
    }
    if (media.person_id) {
      await execute(
        `UPDATE ops.request_media SET is_hero = FALSE WHERE person_id = $1 AND is_hero = TRUE`,
        [media.person_id]
      );
    }

    // Set this one as hero
    await execute(
      `UPDATE ops.request_media SET is_hero = TRUE WHERE media_id = $1`,
      [mediaId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error setting hero image:", error);
    return NextResponse.json({ error: "Failed to set hero image" }, { status: 500 });
  }
}
