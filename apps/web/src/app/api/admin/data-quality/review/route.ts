import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, query } from "@/lib/db";

interface ReviewPerson {
  person_id: string;
  display_name: string;
  data_quality: string;
  data_source: string;
  is_canonical: boolean;
  created_at: string;
  identifier_count: number;
  identifiers: string | null;
  cat_count: number;
  place_count: number;
  appointment_count: number;
}

/**
 * GET: List people with data_quality='needs_review'
 * Query params: ?source=web_app&limit=50&offset=0
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const quality = searchParams.get("quality") || "needs_review";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const offset = parseInt(searchParams.get("offset") || "0");

    const rows = await queryRows<ReviewPerson>(
      `SELECT
        p.person_id,
        p.display_name,
        p.data_quality,
        p.data_source,
        p.is_canonical,
        p.created_at::text,
        (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id)::int as identifier_count,
        (SELECT string_agg(pi.id_type || ':' || pi.id_value_norm, ', ')
         FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id) as identifiers,
        (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id)::int as cat_count,
        (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id)::int as place_count,
        (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id)::int as appointment_count
      FROM trapper.sot_people p
      WHERE p.merged_into_person_id IS NULL
        AND p.data_quality = $1
        ${source ? "AND p.data_source = $4" : ""}
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3`,
      source ? [quality, limit, offset, source] : [quality, limit, offset]
    );

    const totalRow = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM trapper.sot_people
       WHERE merged_into_person_id IS NULL AND data_quality = $1
       ${source ? "AND data_source = $2" : ""}`,
      source ? [quality, source] : [quality]
    );

    return NextResponse.json({
      records: rows,
      total: totalRow?.count || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("Data quality review GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch review records" },
      { status: 500 }
    );
  }
}

/**
 * PATCH: Resolve a needs_review record
 * Body: { person_id, action: 'promote' | 'garbage' | 'merge', merge_target_id? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { person_id, action, merge_target_id } = body;

    if (!person_id || !action) {
      return NextResponse.json(
        { error: "person_id and action required" },
        { status: 400 }
      );
    }

    if (!["promote", "garbage", "merge"].includes(action)) {
      return NextResponse.json(
        { error: "action must be promote, garbage, or merge" },
        { status: 400 }
      );
    }

    // Verify person exists and is needs_review
    const person = await queryOne<{ display_name: string; data_quality: string }>(
      `SELECT display_name, data_quality FROM trapper.sot_people
       WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [person_id]
    );

    if (!person) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    if (action === "promote") {
      await query(
        `UPDATE trapper.sot_people SET data_quality = 'normal', updated_at = NOW()
         WHERE person_id = $1`,
        [person_id]
      );

      await query(
        `INSERT INTO trapper.entity_edits (entity_type, entity_id, field_name, old_value, new_value, edited_by, edit_source)
         VALUES ('person', $1, 'data_quality', $2, 'normal', 'admin', 'data_quality_review')`,
        [person_id, person.data_quality]
      );

      return NextResponse.json({ success: true, action: "promoted", person_id });
    }

    if (action === "garbage") {
      await query(
        `UPDATE trapper.sot_people
         SET data_quality = 'garbage', is_canonical = FALSE, updated_at = NOW()
         WHERE person_id = $1`,
        [person_id]
      );

      await query(
        `INSERT INTO trapper.entity_edits (entity_type, entity_id, field_name, old_value, new_value, edited_by, edit_source)
         VALUES ('person', $1, 'data_quality', $2, 'garbage', 'admin', 'data_quality_review')`,
        [person_id, person.data_quality]
      );

      return NextResponse.json({ success: true, action: "marked_garbage", person_id });
    }

    if (action === "merge") {
      if (!merge_target_id) {
        return NextResponse.json(
          { error: "merge_target_id required for merge action" },
          { status: 400 }
        );
      }

      // Check safe to merge
      const safeCheck = await queryOne<{ safe: boolean; reason: string }>(
        `SELECT * FROM trapper.person_safe_to_merge($1, $2)`,
        [person_id, merge_target_id]
      );

      if (safeCheck && !safeCheck.safe) {
        return NextResponse.json(
          { error: `Merge not safe: ${safeCheck.reason}` },
          { status: 400 }
        );
      }

      // Perform merge
      await query(
        `SELECT trapper.merge_people($1, $2)`,
        [person_id, merge_target_id]
      );

      return NextResponse.json({
        success: true,
        action: "merged",
        person_id,
        merge_target_id,
      });
    }
  } catch (err) {
    console.error("Data quality review PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to resolve record" },
      { status: 500 }
    );
  }
}
