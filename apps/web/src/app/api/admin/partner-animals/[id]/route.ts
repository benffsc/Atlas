import { NextRequest } from "next/server";
import { queryOne, execute } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiBadRequest, apiServerError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    requireValidUUID(id, "partner_animal");
    const body = await request.json();

    const allowedFields = [
      "name", "sex", "breed", "colors", "dob", "microchip", "altered",
      "procedure_needed", "priority", "priority_meaning", "status",
      "foster_name", "foster_phone", "foster_email", "foster_address", "foster_person_id",
      "sub_location", "intake_origin", "intake_location",
      "contact_notes", "scheduled_date", "completed_date", "completed_notes",
    ];

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(body[field]);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return apiBadRequest("No valid fields to update");
    }

    // Auto-set altered + completed_date when marking completed
    if (body.status === "completed" || body.status === "already_done") {
      if (!updates.some(u => u.startsWith("altered"))) {
        updates.push(`altered = TRUE`);
      }
      if (!body.completed_date && !updates.some(u => u.startsWith("completed_date"))) {
        updates.push(`completed_date = CURRENT_DATE`);
      }
    }

    updates.push("updated_at = NOW()");
    values.push(id);

    const result = await queryOne<{ id: string }>(
      `UPDATE ops.partner_animals
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING id`,
      values
    );

    if (!result) {
      return apiNotFound("Partner animal", id);
    }

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("[PARTNER-ANIMALS] Update error:", error);
    return apiServerError("Failed to update partner animal");
  }
}
