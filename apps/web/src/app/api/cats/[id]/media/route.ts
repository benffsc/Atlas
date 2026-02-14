import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface MediaRow {
  media_id: string;
  media_type: string;
  original_filename: string;
  storage_path: string;
  caption: string | null;
  cat_description: string | null;
  uploaded_by: string;
  uploaded_at: string;
  source_type: string;
  source_request_id: string | null;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/cats/[id]/media - List all media for a cat
// Includes both direct uploads and photos linked from requests
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    // Use the v_cat_media view which combines direct and linked photos
    const media = await queryRows<MediaRow>(
      `SELECT
        media_id,
        media_type,
        original_filename,
        storage_path,
        caption,
        cat_description,
        uploaded_by,
        uploaded_at,
        source_type,
        source_request_id
       FROM sot.v_cat_media
       WHERE cat_id = $1
       ORDER BY uploaded_at DESC`,
      [id]
    );

    return NextResponse.json({ media });
  } catch (error) {
    // View might not exist yet - fallback to direct query
    console.warn("v_cat_media view not available, using fallback query:", error);

    try {
      const media = await queryRows<MediaRow>(
        `SELECT
          media_id,
          media_type::TEXT,
          original_filename,
          storage_path,
          caption,
          cat_description,
          uploaded_by,
          uploaded_at,
          'direct' AS source_type,
          request_id AS source_request_id
         FROM ops.request_media
         WHERE NOT is_archived
           AND cat_id = $1
         ORDER BY uploaded_at DESC`,
        [id]
      );

      return NextResponse.json({ media });
    } catch (fallbackError) {
      console.error("Error fetching cat media:", fallbackError);
      return NextResponse.json(
        { error: "Failed to fetch media" },
        { status: 500 }
      );
    }
  }
}
