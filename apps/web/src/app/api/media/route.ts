import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

const MEDIA_COLS = `
  m.media_id, m.media_type::TEXT AS media_type, m.original_filename,
  m.storage_path, m.thumbnail_path, m.caption, m.notes,
  m.cat_description, m.linked_cat_id,
  m.uploaded_by, m.uploaded_at`;

const WINDOW_CONDITION = `
  AND (r.resolved_at IS NULL
    OR m.uploaded_at
       BETWEEN COALESCE(r.source_created_at, r.created_at) - INTERVAL '2 months'
       AND COALESCE(r.resolved_at, NOW()) + INTERVAL '2 months')`;

function buildMediaCrossRefQuery(
  entityType: "request" | "person" | "cat" | "place",
  entityId: string,
): { sql: string; params: unknown[] } {
  const unions: string[] = [];
  const params: unknown[] = [entityId];

  if (entityType === "request") {
    // Direct media on this request
    unions.push(`
      SELECT ${MEDIA_COLS}, NULL::TEXT AS cross_ref_source
      FROM trapper.request_media m
      WHERE m.request_id = $1 AND NOT m.is_archived
    `);
    // Requester person's direct media
    unions.push(`
      SELECT ${MEDIA_COLS}, 'person'::TEXT AS cross_ref_source
      FROM trapper.request_media m
      JOIN trapper.sot_requests r ON r.request_id = $1
      WHERE m.person_id = r.requester_person_id
        AND r.requester_person_id IS NOT NULL
        AND NOT m.is_archived
        ${WINDOW_CONDITION}
    `);
    // Linked cats' direct media
    unions.push(`
      SELECT ${MEDIA_COLS}, 'cat'::TEXT AS cross_ref_source
      FROM trapper.request_media m
      JOIN trapper.request_cat_links rcl ON rcl.cat_id = m.direct_cat_id
      JOIN trapper.sot_requests r ON r.request_id = $1
      WHERE rcl.request_id = $1
        AND NOT m.is_archived
        ${WINDOW_CONDITION}
    `);
    // Place's direct media
    unions.push(`
      SELECT ${MEDIA_COLS}, 'place'::TEXT AS cross_ref_source
      FROM trapper.request_media m
      JOIN trapper.sot_requests r ON r.request_id = $1
      WHERE m.place_id = r.place_id
        AND r.place_id IS NOT NULL
        AND m.request_id IS DISTINCT FROM $1
        AND NOT m.is_archived
        ${WINDOW_CONDITION}
    `);
  } else if (entityType === "person") {
    // Direct person media
    unions.push(`
      SELECT ${MEDIA_COLS}, NULL::TEXT AS cross_ref_source
      FROM trapper.request_media m
      WHERE m.person_id = $1 AND NOT m.is_archived
    `);
    // Media from requests where person is requester
    unions.push(`
      SELECT ${MEDIA_COLS}, 'request'::TEXT AS cross_ref_source
      FROM trapper.request_media m
      JOIN trapper.sot_requests r ON r.request_id = m.request_id
      WHERE r.requester_person_id = $1
        AND m.person_id IS DISTINCT FROM $1
        AND NOT m.is_archived
        ${WINDOW_CONDITION}
    `);
  } else if (entityType === "cat") {
    // Direct cat media (direct_cat_id OR linked_cat_id)
    unions.push(`
      SELECT ${MEDIA_COLS}, NULL::TEXT AS cross_ref_source
      FROM trapper.request_media m
      WHERE (m.direct_cat_id = $1 OR m.linked_cat_id = $1) AND NOT m.is_archived
    `);
    // Media from linked requests
    unions.push(`
      SELECT ${MEDIA_COLS}, 'request'::TEXT AS cross_ref_source
      FROM trapper.request_media m
      JOIN trapper.request_cat_links rcl ON rcl.request_id = m.request_id
      JOIN trapper.sot_requests r ON r.request_id = rcl.request_id
      WHERE rcl.cat_id = $1
        AND m.direct_cat_id IS DISTINCT FROM $1
        AND m.linked_cat_id IS DISTINCT FROM $1
        AND NOT m.is_archived
        ${WINDOW_CONDITION}
    `);
  } else {
    // place
    // Direct place media
    unions.push(`
      SELECT ${MEDIA_COLS}, NULL::TEXT AS cross_ref_source
      FROM trapper.request_media m
      WHERE m.place_id = $1 AND NOT m.is_archived
    `);
    // Media from requests at this place
    unions.push(`
      SELECT ${MEDIA_COLS}, 'request'::TEXT AS cross_ref_source
      FROM trapper.request_media m
      JOIN trapper.sot_requests r ON r.request_id = m.request_id
      WHERE r.place_id = $1
        AND m.place_id IS DISTINCT FROM $1
        AND NOT m.is_archived
        ${WINDOW_CONDITION}
    `);
  }

  const unionSql = unions.join("\nUNION ALL\n");

  const sql = `
    WITH all_media AS (${unionSql}),
    deduped AS (
      SELECT DISTINCT ON (media_id) *
      FROM all_media
      ORDER BY media_id, cross_ref_source NULLS FIRST
    )
    SELECT * FROM deduped
    ORDER BY uploaded_at DESC
  `;

  return { sql, params };
}

// GET /api/media - Unified media endpoint with cross-entity referencing
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const requestId = searchParams.get("request_id");
  const personId = searchParams.get("person_id");
  const catId = searchParams.get("cat_id");
  const placeId = searchParams.get("place_id");
  const includeRelated = searchParams.get("include_related") === "true";

  const entityIds = [requestId, personId, catId, placeId].filter(Boolean);
  if (entityIds.length !== 1) {
    return NextResponse.json(
      { error: "Provide exactly one entity ID (request_id, person_id, cat_id, or place_id)" },
      { status: 400 },
    );
  }

  const entityId = entityIds[0]!;
  if (!isValidUUID(entityId)) {
    return NextResponse.json({ error: "Invalid UUID" }, { status: 400 });
  }

  const entityType = requestId ? "request" : personId ? "person" : catId ? "cat" : "place";

  try {
    if (includeRelated) {
      const { sql, params } = buildMediaCrossRefQuery(
        entityType as "request" | "person" | "cat" | "place",
        entityId,
      );
      const media = await queryRows(sql, params);
      return NextResponse.json({ media });
    }

    // Simple fallback — direct media only
    const media = await queryRows(
      `SELECT ${MEDIA_COLS}, NULL::TEXT AS cross_ref_source
       FROM trapper.request_media m
       WHERE NOT m.is_archived
         AND (
           ($1 = 'request' AND m.request_id = $2)
           OR ($1 = 'place' AND m.place_id = $2)
           OR ($1 = 'cat' AND (m.direct_cat_id = $2 OR m.linked_cat_id = $2))
           OR ($1 = 'person' AND m.person_id = $2)
         )
       ORDER BY uploaded_at DESC`,
      [entityType, entityId],
    );
    return NextResponse.json({ media });
  } catch (error) {
    console.error("Error fetching media:", error);
    return NextResponse.json({ error: "Failed to fetch media" }, { status: 500 });
  }
}
