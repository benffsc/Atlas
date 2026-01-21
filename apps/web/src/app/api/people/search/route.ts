import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * People Search API
 *
 * GET /api/people/search?q=query&limit=10
 *
 * Searches people by name, email, or phone
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const limit = parseInt(searchParams.get("limit") || "20");

  if (query.length < 2) {
    return NextResponse.json({ people: [] });
  }

  const client = await pool.connect();
  try {
    const searchPattern = `%${query}%`;

    const result = await client.query(`
      SELECT DISTINCT ON (p.person_id)
        p.person_id,
        p.display_name,
        p.entity_type,
        (
          SELECT COUNT(*)
          FROM trapper.person_cat_relationships pcr
          WHERE pcr.person_id = p.person_id
            AND pcr.relationship_type NOT LIKE 'former_%'
        ) as cat_count,
        (
          SELECT string_agg(DISTINCT pi.id_value_raw, ', ')
          FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id
            AND pi.id_type = 'email'
        ) as emails,
        (
          SELECT string_agg(DISTINCT pi.id_value_raw, ', ')
          FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id
            AND pi.id_type = 'phone'
        ) as phones
      FROM trapper.sot_people p
      LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
      WHERE p.merged_into_person_id IS NULL
        AND p.is_canonical = TRUE
        AND (
          p.display_name ILIKE $1
          OR pi.id_value_norm ILIKE $1
          OR pi.id_value_raw ILIKE $1
        )
      ORDER BY p.person_id, p.display_name
      LIMIT $2
    `, [searchPattern, limit]);

    return NextResponse.json({
      people: result.rows,
      query,
    });
  } finally {
    client.release();
  }
}
