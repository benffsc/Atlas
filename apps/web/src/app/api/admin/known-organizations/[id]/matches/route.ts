import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface MatchLogEntry {
  log_id: string;
  org_id: string;
  matched_value: string;
  match_type: string;
  matched_pattern: string | null;
  confidence: number;
  source_system: string;
  source_record_id: string | null;
  decision: string;
  person_id: string | null;
  notes: string | null;
  created_at: string;
}

interface MatchStats {
  total_matches: number;
  matches_24h: number;
  matches_7d: number;
  linked_count: number;
  flagged_count: number;
  review_count: number;
  skipped_count: number;
}

// GET - Get match log for an organization
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const decision = searchParams.get("decision"); // linked, flagged, review, skipped

    // Check org exists
    const org = await queryOne<{ canonical_name: string }>(
      `SELECT canonical_name FROM sot.known_organizations WHERE org_id = $1`,
      [id]
    );

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Build query
    let whereClause = "org_id = $1";
    const queryParams: (string | number)[] = [id];
    let paramIndex = 2;

    if (decision) {
      whereClause += ` AND decision = $${paramIndex}`;
      queryParams.push(decision);
      paramIndex++;
    }

    queryParams.push(limit, offset);

    const matches = await queryRows<MatchLogEntry>(
      `
      SELECT
        log_id,
        org_id,
        matched_value,
        match_type,
        matched_pattern,
        confidence,
        source_system,
        source_record_id,
        decision,
        person_id,
        notes,
        created_at
      FROM trapper.organization_match_log
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex - 1} OFFSET $${paramIndex}
      `,
      queryParams
    );

    // Get stats
    const stats = await queryOne<MatchStats>(
      `
      SELECT
        COUNT(*)::int AS total_matches,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS matches_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS matches_7d,
        COUNT(*) FILTER (WHERE decision = 'linked')::int AS linked_count,
        COUNT(*) FILTER (WHERE decision = 'flagged')::int AS flagged_count,
        COUNT(*) FILTER (WHERE decision = 'review')::int AS review_count,
        COUNT(*) FILTER (WHERE decision = 'skipped')::int AS skipped_count
      FROM trapper.organization_match_log
      WHERE org_id = $1
      `,
      [id]
    );

    // Get match type breakdown
    const byType = await queryRows<{ match_type: string; count: number }>(
      `
      SELECT match_type, COUNT(*)::int AS count
      FROM trapper.organization_match_log
      WHERE org_id = $1
      GROUP BY match_type
      ORDER BY count DESC
      `,
      [id]
    );

    return NextResponse.json({
      org_id: id,
      org_name: org.canonical_name,
      matches,
      stats: stats || {
        total_matches: 0,
        matches_24h: 0,
        matches_7d: 0,
        linked_count: 0,
        flagged_count: 0,
        review_count: 0,
        skipped_count: 0,
      },
      by_type: byType,
      pagination: {
        limit,
        offset,
        has_more: matches.length === limit,
      },
    });
  } catch (error) {
    console.error("Error fetching match log:", error);
    return NextResponse.json(
      { error: "Failed to fetch match log" },
      { status: 500 }
    );
  }
}
