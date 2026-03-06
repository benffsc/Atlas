import { NextResponse } from "next/server";
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
}

export async function GET() {
  try {
    const pins = await queryRows<DashboardMapPin>(`
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
        r.created_at::text
      FROM ops.requests r
      JOIN sot.places p ON p.place_id = r.place_id
      WHERE r.merged_into_request_id IS NULL
        AND p.merged_into_place_id IS NULL
        AND r.status NOT IN ('completed', 'cancelled')
        AND p.location IS NOT NULL
      ORDER BY r.created_at DESC
      LIMIT 200
    `, []);

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
