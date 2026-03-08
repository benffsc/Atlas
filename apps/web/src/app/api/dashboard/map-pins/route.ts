import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { apiServerError } from "@/lib/api-response";

export const revalidate = 120; // Cache 2 minutes

export interface DashboardMapPin {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  place_name: string | null;
  place_address: string | null;
  lat: number;
  lng: number;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  created_at: string;
  layer: string;
}

const SONOMA_BOUNDS = {
  south: 37.8,
  north: 39.4,
  west: -123.6,
  east: -122.3,
};

async function fetchRequestPins(layer: string, search: string, county: string): Promise<DashboardMapPin[]> {
  let statusFilter: string;
  switch (layer) {
    case "all":
      statusFilter = "AND TRUE";
      break;
    case "completed":
      statusFilter = "AND r.status IN ('completed', 'cancelled')";
      break;
    case "active":
    default:
      statusFilter = "AND r.status NOT IN ('completed', 'cancelled')";
      break;
  }

  const searchFilter = search
    ? "AND (p.display_name ILIKE $1 OR p.formatted_address ILIKE $1 OR r.summary ILIKE $1)"
    : "AND TRUE";
  const params = search ? [`%${search}%`] : [];

  const boundsFilter = county === "sonoma"
    ? `AND ST_Y(p.location::geometry) BETWEEN ${SONOMA_BOUNDS.south} AND ${SONOMA_BOUNDS.north} AND ST_X(p.location::geometry) BETWEEN ${SONOMA_BOUNDS.west} AND ${SONOMA_BOUNDS.east}`
    : "";

  return queryRows<DashboardMapPin>(`
    SELECT
      r.request_id,
      r.status,
      r.priority,
      r.summary,
      p.display_name AS place_name,
      p.formatted_address AS place_address,
      ST_Y(p.location::geometry) AS lat,
      ST_X(p.location::geometry) AS lng,
      r.estimated_cat_count,
      r.has_kittens,
      r.created_at::text,
      'request' AS layer
    FROM ops.requests r
    JOIN sot.places p ON p.place_id = r.place_id
    WHERE r.merged_into_request_id IS NULL
      AND p.merged_into_place_id IS NULL
      ${statusFilter}
      ${searchFilter}
      AND p.location IS NOT NULL
      ${boundsFilter}
    ORDER BY r.created_at DESC
    LIMIT 500
  `, params);
}

async function fetchIntakePins(search: string, county: string): Promise<DashboardMapPin[]> {
  const searchFilter = search
    ? "AND (i.submitter_name ILIKE $1 OR i.cats_address ILIKE $1 OR i.geo_formatted_address ILIKE $1)"
    : "AND TRUE";
  const params = search ? [`%${search}%`] : [];

  const boundsFilter = county === "sonoma"
    ? `AND i.geo_latitude BETWEEN ${SONOMA_BOUNDS.south} AND ${SONOMA_BOUNDS.north} AND i.geo_longitude BETWEEN ${SONOMA_BOUNDS.west} AND ${SONOMA_BOUNDS.east}`
    : "";

  return queryRows<DashboardMapPin>(`
    SELECT
      i.submission_id AS request_id,
      COALESCE(i.submission_status, 'new') AS status,
      COALESCE(i.priority_override, 'normal') AS priority,
      i.submitter_name AS summary,
      i.cats_address AS place_name,
      i.geo_formatted_address AS place_address,
      i.geo_latitude AS lat,
      i.geo_longitude AS lng,
      i.cat_count_estimate AS estimated_cat_count,
      COALESCE(i.has_kittens, false) AS has_kittens,
      i.submitted_at::text AS created_at,
      'intake' AS layer
    FROM ops.intake_submissions i
    WHERE i.submission_status IN ('new', 'needs_review')
      AND i.geo_latitude IS NOT NULL
      AND i.geo_longitude IS NOT NULL
      ${searchFilter}
      ${boundsFilter}
    ORDER BY i.submitted_at DESC
    LIMIT 200
  `, params);
}

export async function GET(request: NextRequest) {
  try {
    const layer = request.nextUrl.searchParams.get("layer") || "active";
    const search = request.nextUrl.searchParams.get("q")?.trim() || "";
    const county = request.nextUrl.searchParams.get("county") || "sonoma";

    let pins: DashboardMapPin[];

    if (layer === "intake") {
      pins = await fetchIntakePins(search, county);
    } else {
      pins = await fetchRequestPins(layer, search, county);
    }

    return NextResponse.json({ pins }, {
      headers: {
        "Cache-Control": "private, max-age=120, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard map pins:", error);
    return apiServerError("Failed to fetch map pins");
  }
}
