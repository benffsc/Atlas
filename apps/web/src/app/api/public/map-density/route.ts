import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { getMapBounds } from "@/lib/geo-config";

/**
 * GET /api/public/map-density
 *
 * Public endpoint — no authentication required.
 * Returns only spatial density data (lat, lng, cat_count) for the hexbin
 * density map. No personal information, addresses, IDs, or identifiers
 * are included in the response.
 *
 * Query params:
 *   - bounds: south,west,north,east bounding box (optional)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const boundsParam = searchParams.get("bounds");

  const defaultBounds = await getMapBounds();

  let boundsCondition = `
    AND lat IS NOT NULL
    AND lng IS NOT NULL
    AND lat BETWEEN ${defaultBounds.south} AND ${defaultBounds.north}
    AND lng BETWEEN ${defaultBounds.west} AND ${defaultBounds.east}
  `;

  if (boundsParam) {
    const parts = boundsParam.split(",").map(Number);
    if (parts.length === 4 && parts.every((v) => !isNaN(v))) {
      const [south, west, north, east] = parts;
      const latBuffer = (north - south) * 0.1;
      const lngBuffer = (east - west) * 0.1;
      boundsCondition = `
        AND lat IS NOT NULL
        AND lng IS NOT NULL
        AND lat BETWEEN ${south - latBuffer} AND ${north + latBuffer}
        AND lng BETWEEN ${west - lngBuffer} AND ${east + lngBuffer}
      `;
    }
  }

  try {
    const rows = await queryRows<{ lat: number; lng: number; cat_count: number }>(`
      SELECT
        lat,
        lng,
        cat_count::int AS cat_count
      FROM ops.v_map_atlas_pins_with_gm
      WHERE cat_count > 0
        ${boundsCondition}
      ORDER BY cat_count DESC
      LIMIT 12000
    `);

    const response = NextResponse.json({ points: rows });
    response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return response;
  } catch (err) {
    console.error("public map-density error:", err);
    return NextResponse.json({ points: [] }, { status: 500 });
  }
}
