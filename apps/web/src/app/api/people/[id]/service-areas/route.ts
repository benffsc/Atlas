import { NextRequest } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

interface ServiceAreaRow {
  id: string;
  place_id: string;
  place_name: string;
  formatted_address: string | null;
  service_type: string;
  role: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  source_system: string | null;
  created_at: string;
}

/** GET /api/people/[id]/service-areas — List trapper service areas */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "person");

    const areas = await queryRows<ServiceAreaRow>(
      `SELECT
         tsp.id,
         tsp.place_id,
         COALESCE(p.display_name, p.formatted_address, 'Unknown') as place_name,
         p.formatted_address,
         tsp.service_type,
         tsp.role,
         tsp.start_date,
         tsp.end_date,
         tsp.notes,
         tsp.source_system,
         tsp.created_at
       FROM sot.trapper_service_places tsp
       JOIN sot.places p ON p.place_id = tsp.place_id
       WHERE tsp.person_id = $1
       ORDER BY
         CASE tsp.service_type
           WHEN 'primary_territory' THEN 1
           WHEN 'regular' THEN 2
           WHEN 'occasional' THEN 3
           WHEN 'home_rescue' THEN 4
           WHEN 'historical' THEN 5
         END,
         tsp.created_at DESC`,
      [id]
    );

    return apiSuccess({ areas });
  } catch (error) {
    console.error("[API] Error fetching service areas:", error);
    return apiServerError("Failed to fetch service areas");
  }
}

/** POST /api/people/[id]/service-areas — Add a service area */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "person");

    const body = await request.json();
    const { place_id, service_type, notes } = body as {
      place_id: string;
      service_type: string;
      notes?: string;
    };

    if (!place_id) return apiError("place_id is required", 400);
    requireValidUUID(place_id, "place");

    const validTypes = ["primary_territory", "regular", "occasional", "home_rescue"];
    if (!validTypes.includes(service_type)) {
      return apiError(`service_type must be one of: ${validTypes.join(", ")}`, 400);
    }

    // Verify person exists
    const person = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.people WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [id]
    );
    if (!person) return apiNotFound("Person", id);

    // Verify place exists
    const place = await queryOne<{ place_id: string }>(
      `SELECT place_id FROM sot.places WHERE place_id = $1`,
      [place_id]
    );
    if (!place) return apiNotFound("Place", place_id);

    // Check for conflicts before inserting
    const conflicts = await queryRows<{
      person_id: string;
      person_name: string;
      service_type: string;
      place_id: string;
      place_name: string;
      match_type: string;
    }>(
      `SELECT * FROM sot.check_service_area_conflicts($1, $2, $3)`,
      [id, place_id, service_type]
    );

    const result = await queryOne<{ id: string }>(
      `INSERT INTO sot.trapper_service_places (person_id, place_id, service_type, notes, source_system, evidence_type)
       VALUES ($1, $2, $3, $4, 'atlas_ui', 'staff_verified')
       ON CONFLICT (person_id, place_id) DO UPDATE SET
         service_type = EXCLUDED.service_type,
         notes = EXCLUDED.notes,
         end_date = NULL
       RETURNING id`,
      [id, place_id, service_type, notes || null]
    );

    return apiSuccess({ id: result?.id, action: "added", conflicts });
  } catch (error) {
    console.error("[API] Error adding service area:", error);
    return apiServerError("Failed to add service area");
  }
}

/** DELETE /api/people/[id]/service-areas — Remove a service area */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "person");

    const body = await request.json();
    const { area_id } = body as { area_id: string };

    if (!area_id) return apiError("area_id is required", 400);
    requireValidUUID(area_id, "service_area");

    // Soft remove — set end_date instead of hard delete
    await query(
      `UPDATE sot.trapper_service_places
       SET end_date = CURRENT_DATE, service_type = 'historical'
       WHERE id = $1 AND person_id = $2`,
      [area_id, id]
    );

    return apiSuccess({ action: "removed" });
  } catch (error) {
    console.error("[API] Error removing service area:", error);
    return apiServerError("Failed to remove service area");
  }
}
