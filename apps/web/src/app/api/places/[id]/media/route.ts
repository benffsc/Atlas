import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface MediaRow {
  media_id: string;
  media_type: string;
  original_filename: string;
  storage_path: string;
  caption: string | null;
  cat_description: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/places/[id]/media - List all media for a place
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    requireValidUUID(id, "place");
    // Include both direct place photos AND photos from requests linked to this place
    const media = await queryRows<MediaRow>(
      `SELECT
        media_id,
        media_type::TEXT,
        original_filename,
        storage_path,
        caption,
        cat_description,
        uploaded_by,
        uploaded_at
       FROM ops.request_media
       WHERE (place_id = $1
              OR (request_id IN (SELECT request_id FROM ops.requests WHERE place_id = $1)
                  AND place_id IS NULL))
         AND NOT COALESCE(is_archived, FALSE)
       ORDER BY uploaded_at DESC`,
      [id]
    );

    return apiSuccess({ media });
  } catch (error) {
    console.error("Error fetching place media:", error);
    return apiServerError("Failed to fetch media");
  }
}
