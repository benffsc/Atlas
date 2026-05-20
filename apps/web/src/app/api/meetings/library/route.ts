import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

// GET /api/meetings/library — list library slides by category
export async function GET() {
  try {
    const slides = await queryRows<{
      library_slide_id: string;
      name: string;
      category: string;
      slide_type: string;
      title: string | null;
      body: string | null;
      image_url: string | null;
      background_style: string;
      custom_data: Record<string, unknown>;
    }>(
      `SELECT library_slide_id, name, category, slide_type, title, body,
              image_url, background_style, custom_data
       FROM ops.slide_library
       WHERE is_active = true
       ORDER BY category, name`,
      []
    );

    // Group by category
    const byCategory: Record<string, typeof slides> = {};
    for (const s of slides) {
      if (!byCategory[s.category]) byCategory[s.category] = [];
      byCategory[s.category].push(s);
    }

    return apiSuccess({ slides, byCategory });
  } catch (error) {
    console.error("[meetings/library] GET error:", error);
    return apiServerError("Failed to list library slides");
  }
}
