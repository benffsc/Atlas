import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/people/[id]/media - List direct media for a person
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const media = await queryRows(
      `SELECT
        m.media_id, m.media_type::TEXT AS media_type, m.original_filename,
        m.storage_path, m.thumbnail_path, m.caption, m.notes,
        m.cat_description, m.cat_id,
        m.uploaded_by, m.uploaded_at,
        COALESCE(m.is_hero, FALSE) AS is_hero
       FROM ops.request_media m
       WHERE m.person_id = $1 AND NOT m.is_archived
       ORDER BY is_hero DESC, m.uploaded_at DESC`,
      [id]
    );

    return apiSuccess({ media });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching person media:", error);
    return apiServerError("Failed to fetch media");
  }
}
