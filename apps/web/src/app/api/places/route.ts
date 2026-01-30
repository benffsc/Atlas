import { NextRequest, NextResponse } from "next/server";
import { queryRows, query, queryOne } from "@/lib/db";

interface PlaceListRow {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  postal_code: string | null;
  cat_count: number;
  person_count: number;
  has_cat_activity: boolean;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const q = searchParams.get("q") || null;
  const placeKind = searchParams.get("place_kind");
  const hasCats = searchParams.get("has_cats");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (q) {
    conditions.push(`(
      display_name ILIKE $${paramIndex}
      OR formatted_address ILIKE $${paramIndex}
      OR locality ILIKE $${paramIndex}
    )`);
    params.push(`%${q}%`);
    paramIndex++;
  }

  if (placeKind) {
    conditions.push(`place_kind = $${paramIndex}`);
    params.push(placeKind);
    paramIndex++;
  }

  if (hasCats === "true") {
    conditions.push("cat_count > 0");
  } else if (hasCats === "false") {
    conditions.push("cat_count = 0");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const sql = `
      SELECT
        place_id,
        display_name,
        formatted_address,
        place_kind,
        locality,
        postal_code,
        cat_count,
        person_count,
        has_cat_activity,
        created_at
      FROM trapper.v_place_list
      ${whereClause}
      ORDER BY display_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM trapper.v_place_list
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<PlaceListRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      places: dataResult,
      total: parseInt(countResult.rows[0]?.total || "0", 10),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching places:", error);
    return NextResponse.json(
      { error: "Failed to fetch places" },
      { status: 500 }
    );
  }
}

interface CreatePlaceBody {
  google_place_id?: string;
  formatted_address?: string;
  lat?: number;
  lng?: number;
  display_name?: string | null;
  place_kind: string;
  notes?: string | null;
  location_type?: "geocoded" | "approximate" | "described";
  location_description?: string | null;
  // Apartment hierarchy fields
  parent_place_id?: string;
  unit_identifier?: string;
  // Alternative: pass location object directly
  location?: { lat: number; lng: number };
}

interface AddressRow {
  address_id: string;
}

interface PlaceRow {
  place_id: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreatePlaceBody = await request.json();

    // Validation
    if (!body.place_kind) {
      return NextResponse.json(
        { error: "place_kind is required" },
        { status: 400 }
      );
    }

    // Extract lat/lng from either direct props or location object
    const lat = body.lat ?? body.location?.lat;
    const lng = body.lng ?? body.location?.lng;

    // Determine location_type - default to geocoded if we have coordinates
    const locationType = body.location_type || (lat && lng ? "geocoded" : "described");

    // For geocoded locations, we need coordinates
    if (locationType === "geocoded") {
      if (!lat || !lng) {
        return NextResponse.json(
          { error: "lat and lng are required for geocoded locations" },
          { status: 400 }
        );
      }
    }

    // For described locations, we need a description
    if (locationType === "described" && !body.location_description && !body.formatted_address) {
      return NextResponse.json(
        { error: "location_description or formatted_address is required for described locations" },
        { status: 400 }
      );
    }

    // Use centralized function for place creation/deduplication
    // This handles: address normalization, deduplication, geocoding queue
    const addressToUse = body.formatted_address || body.location_description || body.display_name;

    const result = await queryOne<PlaceRow>(
      `SELECT trapper.find_or_create_place_deduped($1, $2, $3, $4, $5) AS place_id`,
      [
        addressToUse,
        body.display_name,
        lat || null,
        lng || null,
        'web_intake'  // source_system (per CLAUDE.md)
      ]
    );

    // If place was created/found, update additional fields not handled by centralized function
    if (result?.place_id) {
      // Update place_kind, notes, parent_place_id, unit_identifier if provided
      const updates: string[] = [];
      const updateParams: unknown[] = [];
      let paramIdx = 1;

      if (body.place_kind) {
        updates.push(`place_kind = $${paramIdx}::trapper.place_kind`);
        updateParams.push(body.place_kind);
        paramIdx++;
      }
      if (body.notes) {
        updates.push(`notes = $${paramIdx}`);
        updateParams.push(body.notes);
        paramIdx++;
      }
      if (body.parent_place_id) {
        updates.push(`parent_place_id = $${paramIdx}`);
        updateParams.push(body.parent_place_id);
        paramIdx++;
      }
      if (body.unit_identifier) {
        updates.push(`unit_identifier = $${paramIdx}`);
        updateParams.push(body.unit_identifier);
        paramIdx++;
      }
      if (body.location_description) {
        updates.push(`location_description = $${paramIdx}`);
        updateParams.push(body.location_description);
        paramIdx++;
      }

      if (updates.length > 0) {
        updateParams.push(result.place_id);
        await query(
          `UPDATE trapper.places SET ${updates.join(', ')}, updated_at = NOW() WHERE place_id = $${paramIdx}`,
          updateParams
        );
      }
    }

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create place" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      place_id: result.place_id,
      display_name: body.display_name,
      formatted_address: body.formatted_address,
      success: true,
    });
  } catch (error) {
    console.error("Error creating place:", error);
    return NextResponse.json(
      { error: "Failed to create place" },
      { status: 500 }
    );
  }
}
