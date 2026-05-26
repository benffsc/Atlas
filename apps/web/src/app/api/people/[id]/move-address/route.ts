import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiBadRequest, apiSuccess, apiServerError } from "@/lib/api-response";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: personId } = await params;

  if (!personId) {
    return apiBadRequest("Person ID is required");
  }

  try {
    requireValidUUID(personId, "person");
    const body = await request.json();
    const { old_place_id, new_place_id, relationship_type = "resident" } = body;

    if (!old_place_id) {
      return apiBadRequest("old_place_id is required");
    }
    if (!new_place_id) {
      return apiBadRequest("new_place_id is required");
    }

    requireValidUUID(old_place_id, "old_place");
    requireValidUUID(new_place_id, "new_place");

    const result = await queryOne<{ move_person_to_place: string }>(
      `SELECT sot.move_person_to_place($1, $2, $3, $4, $5) AS move_person_to_place`,
      [personId, old_place_id, new_place_id, relationship_type, "atlas_ui"]
    );

    return apiSuccess({
      success: true,
      new_person_place_id: result?.move_person_to_place,
    });
  } catch (error) {
    console.error("Error moving person address:", error);
    return apiServerError("Failed to move person to new address");
  }
}
