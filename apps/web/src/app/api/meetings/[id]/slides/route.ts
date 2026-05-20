import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiBadRequest, apiServerError } from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

const VALID_TYPES = ["title", "content", "stats", "photo", "two_column", "quote"];
const VALID_BG = ["default", "dark", "accent", "photo_bg"];

// POST /api/meetings/[id]/slides — add slide (or clone from library)
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    requireValidUUID(id, "meeting");

    // Verify meeting exists
    const meeting = await queryOne(
      `SELECT meeting_id FROM ops.trapper_meetings WHERE meeting_id = $1`,
      [id]
    );
    if (!meeting) return apiNotFound("meeting", id);

    const body = await request.json();

    // Clone from library
    if (body.from_library_id) {
      requireValidUUID(body.from_library_id, "library_slide");

      const libSlide = await queryOne<{
        slide_type: string;
        title: string | null;
        body: string | null;
        image_url: string | null;
        image_caption: string | null;
        background_style: string;
        custom_data: Record<string, unknown>;
      }>(
        `SELECT slide_type, title, body, image_url, image_caption, background_style, custom_data
         FROM ops.slide_library WHERE library_slide_id = $1 AND is_active = true`,
        [body.from_library_id]
      );
      if (!libSlide) return apiNotFound("library_slide", body.from_library_id);

      // Get next display_order
      const maxOrder = await queryOne<{ max_order: number }>(
        `SELECT COALESCE(MAX(display_order), -1)::int AS max_order
         FROM ops.meeting_slides WHERE meeting_id = $1`,
        [id]
      );

      const slide = await queryOne(
        `INSERT INTO ops.meeting_slides
           (meeting_id, slide_type, title, body, image_url, image_caption,
            background_style, custom_data, display_order, is_from_library, library_slide_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
         RETURNING slide_id, slide_type, title, body, image_url, image_caption,
                   background_style, custom_data, display_order, is_from_library, library_slide_id`,
        [
          id,
          libSlide.slide_type,
          libSlide.title,
          libSlide.body,
          libSlide.image_url,
          libSlide.image_caption,
          libSlide.background_style,
          JSON.stringify(libSlide.custom_data || {}),
          (maxOrder?.max_order ?? -1) + 1,
          body.from_library_id,
        ]
      );

      return apiSuccess({ slide }, { status: 201 });
    }

    // Create new slide
    const slide_type = body.slide_type || "content";
    if (!VALID_TYPES.includes(slide_type)) {
      return apiBadRequest(`slide_type must be one of: ${VALID_TYPES.join(", ")}`);
    }

    const bg = body.background_style || "default";
    if (!VALID_BG.includes(bg)) {
      return apiBadRequest(`background_style must be one of: ${VALID_BG.join(", ")}`);
    }

    const maxOrder = await queryOne<{ max_order: number }>(
      `SELECT COALESCE(MAX(display_order), -1)::int AS max_order
       FROM ops.meeting_slides WHERE meeting_id = $1`,
      [id]
    );

    const slide = await queryOne(
      `INSERT INTO ops.meeting_slides
         (meeting_id, slide_type, title, body, background_style, custom_data, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING slide_id, slide_type, title, body, image_url, image_caption,
                 background_style, custom_data, display_order, is_from_library`,
      [
        id,
        slide_type,
        body.title || null,
        body.body || null,
        bg,
        JSON.stringify(body.custom_data || {}),
        (maxOrder?.max_order ?? -1) + 1,
      ]
    );

    return apiSuccess({ slide }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/slides] POST error:", error);
    return apiServerError("Failed to add slide");
  }
}
