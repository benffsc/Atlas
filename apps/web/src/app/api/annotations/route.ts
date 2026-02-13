import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface AnnotationRow {
  annotation_id: string;
  lat: number;
  lng: number;
  label: string;
  note: string | null;
  photo_url: string | null;
  annotation_type: string;
  created_by: string;
  expires_at: string | null;
  created_at: string;
}

// GET /api/annotations - List active, non-expired annotations
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const types = searchParams.get("types");
    const limit = Math.min(parseInt(searchParams.get("limit") || "500", 10), 1000);

    const conditions = [
      "is_active = TRUE",
      "(expires_at IS NULL OR expires_at > NOW())"
    ];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (types) {
      const typeList = types.split(",").map(t => t.trim()).filter(Boolean);
      conditions.push(`annotation_type = ANY($${paramIndex}::text[])`);
      params.push(typeList);
      paramIndex++;
    }

    params.push(limit);

    const annotations = await queryRows<AnnotationRow>(
      `SELECT
        annotation_id,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng,
        label, note, photo_url, annotation_type,
        created_by, expires_at::text, created_at::text
      FROM ops.map_annotations
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}`,
      params
    );

    return NextResponse.json({ annotations });
  } catch (error) {
    console.error("Error fetching annotations:", error);
    return NextResponse.json(
      { error: "Failed to fetch annotations" },
      { status: 500 }
    );
  }
}

// POST /api/annotations - Create a new annotation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validation
    if (typeof body.lat !== "number" || typeof body.lng !== "number" ||
        body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
      return NextResponse.json(
        { error: "Valid lat and lng are required" },
        { status: 400 }
      );
    }

    if (!body.label || typeof body.label !== "string" || body.label.trim().length === 0) {
      return NextResponse.json(
        { error: "label is required (max 100 chars)" },
        { status: 400 }
      );
    }

    const validTypes = ["general", "colony_sighting", "trap_location", "hazard", "feeding_site", "other"];
    const annotationType = body.annotation_type || "general";
    if (!validTypes.includes(annotationType)) {
      return NextResponse.json(
        { error: `Invalid annotation_type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const result = await queryOne<{ annotation_id: string }>(
      `INSERT INTO ops.map_annotations (
        location, label, note, photo_url, annotation_type, created_by, expires_at
      ) VALUES (
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3, $4, $5, $6, $7, $8
      )
      RETURNING annotation_id`,
      [
        body.lat,
        body.lng,
        body.label.trim().substring(0, 100),
        body.note?.substring(0, 2000) || null,
        body.photo_url || null,
        annotationType,
        body.created_by || "staff",
        body.expires_at || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create annotation" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      annotation_id: result.annotation_id,
      success: true,
    });
  } catch (error) {
    console.error("Error creating annotation:", error);
    return NextResponse.json(
      { error: "Failed to create annotation" },
      { status: 500 }
    );
  }
}
