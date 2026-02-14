import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// GET /api/people/[id]/media - List direct media for a person
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid UUID" }, { status: 400 });
  }

  try {
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

    return NextResponse.json({ media });
  } catch (error) {
    console.error("Error fetching person media:", error);
    return NextResponse.json(
      { error: "Failed to fetch media" },
      { status: 500 }
    );
  }
}
