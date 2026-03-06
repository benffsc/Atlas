import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * Request Search API — lightweight search for redirect/handoff picker
 *
 * GET /api/requests/search?q=...&exclude=...
 *
 * Searches requests by address, summary, or requester name.
 * Excludes cancelled/redirected/handed_off requests and the specified request.
 */

interface RequestSearchResult {
  request_id: string;
  summary: string | null;
  status: string;
  created_at: string;
  place_address: string | null;
  requester_name: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const exclude = searchParams.get("exclude");

  if (!q || q.length < 2) {
    return apiSuccess([]);
  }

  try {
    const results = await queryRows<RequestSearchResult>(
      `SELECT
        r.request_id,
        r.summary,
        r.status,
        r.created_at::TEXT,
        p.formatted_address AS place_address,
        per.display_name AS requester_name
      FROM ops.requests r
      LEFT JOIN sot.places p ON p.place_id = r.place_id
      LEFT JOIN sot.people per ON per.person_id = r.requester_person_id
      WHERE r.merged_into_request_id IS NULL
        AND r.status NOT IN ('cancelled', 'redirected', 'handed_off')
        AND ($2::UUID IS NULL OR r.request_id != $2)
        AND (
          p.formatted_address ILIKE '%' || $1 || '%'
          OR r.summary ILIKE '%' || $1 || '%'
          OR per.display_name ILIKE '%' || $1 || '%'
        )
      ORDER BY r.created_at DESC
      LIMIT 10`,
      [q, exclude || null]
    );

    return apiSuccess(results);
  } catch (error) {
    console.error("Error searching requests:", error);
    return apiServerError("Failed to search requests");
  }
}
