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
  display_name: string;
  place_kind: string;
  notes?: string | null;
  location_type: "geocoded" | "approximate" | "described";
  location_description?: string | null;
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
    if (!body.display_name) {
      return NextResponse.json(
        { error: "display_name is required" },
        { status: 400 }
      );
    }

    if (!body.place_kind) {
      return NextResponse.json(
        { error: "place_kind is required" },
        { status: 400 }
      );
    }

    if (!body.location_type) {
      return NextResponse.json(
        { error: "location_type is required" },
        { status: 400 }
      );
    }

    // For geocoded locations, we need coordinates
    if (body.location_type === "geocoded") {
      if (!body.lat || !body.lng) {
        return NextResponse.json(
          { error: "lat and lng are required for geocoded locations" },
          { status: 400 }
        );
      }
    }

    // For described locations, we need a description
    if (body.location_type === "described" && !body.location_description) {
      return NextResponse.json(
        { error: "location_description is required for described locations" },
        { status: 400 }
      );
    }

    let sotAddressId: string | null = null;

    // If geocoded, find or create address in sot_addresses
    if (body.location_type === "geocoded" && body.google_place_id) {
      // Check if address already exists
      const existingAddress = await queryOne<AddressRow>(
        `SELECT address_id FROM trapper.sot_addresses WHERE google_place_id = $1`,
        [body.google_place_id]
      );

      if (existingAddress) {
        sotAddressId = existingAddress.address_id;
      } else {
        // Create new address
        const newAddress = await queryOne<AddressRow>(
          `INSERT INTO trapper.sot_addresses (
            raw_address,
            formatted_address,
            google_place_id,
            location,
            geocode_status,
            data_source
          ) VALUES (
            $1,
            $1,
            $2,
            ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,
            'ok',
            'app'
          )
          RETURNING address_id`,
          [body.formatted_address, body.google_place_id, body.lat, body.lng]
        );
        sotAddressId = newAddress?.address_id || null;
      }
    }

    // Determine is_address_backed based on location type
    const isAddressBacked = body.location_type === "geocoded" && sotAddressId !== null;

    // Create the place
    const locationGeog = body.lat && body.lng
      ? `ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)::geography`
      : "NULL";

    const result = await queryOne<PlaceRow>(
      `INSERT INTO trapper.places (
        sot_address_id,
        display_name,
        formatted_address,
        location,
        place_kind,
        is_address_backed,
        data_source,
        location_type,
        location_description,
        notes,
        has_cat_activity,
        has_trapping_activity,
        has_appointment_activity
      ) VALUES (
        $1,
        $2,
        $3,
        ${locationGeog},
        $4::trapper.place_kind,
        $5,
        'app'::trapper.data_source,
        $6::trapper.location_type,
        $7,
        $8,
        false,
        false,
        false
      )
      RETURNING place_id`,
      [
        sotAddressId,
        body.display_name,
        body.formatted_address || body.location_description || body.display_name,
        body.place_kind,
        isAddressBacked,
        body.location_type,
        body.location_description || null,
        body.notes || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create place" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      place_id: result.place_id,
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
