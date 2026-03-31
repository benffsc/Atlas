import { NextRequest } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";
import { logFieldEdit } from "@/lib/audit";

/**
 * PATCH /api/people/[id]/identifiers
 *
 * FFS-1028: Update a person's contact identifiers (phone/email) from the request page.
 * Writes to sot.person_identifiers with confidence 1.0 (staff-verified).
 * Normalization happens in SQL via sot.norm_email() / sot.norm_phone_us().
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");

    const body = await request.json();
    const { email, phone } = body as { email?: string | null; phone?: string | null };

    if (email === undefined && phone === undefined) {
      return apiBadRequest("Must provide email or phone to update");
    }

    // Verify person exists
    const person = await queryOne<{ person_id: string; display_name: string }>(
      `SELECT person_id, display_name FROM sot.people WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [id]
    );
    if (!person) {
      return apiNotFound("Person", id);
    }

    const results: Array<{ field: string; status: string; warning?: string }> = [];

    // Update email
    if (email !== undefined) {
      if (email === null || email.trim() === "") {
        // Remove high-confidence email
        await execute(
          `DELETE FROM sot.person_identifiers
           WHERE person_id = $1 AND id_type = 'email' AND source_system = 'atlas_ui'`,
          [id]
        );
        results.push({ field: "email", status: "removed" });
      } else {
        const normEmail = email.trim().toLowerCase();

        // Check if this email exists on another person
        const conflict = await queryOne<{ person_id: string; display_name: string }>(
          `SELECT p.person_id, p.display_name
           FROM sot.person_identifiers pi
           JOIN sot.people p ON p.person_id = pi.person_id
           WHERE pi.id_type = 'email' AND pi.id_value_norm = $1
             AND pi.person_id != $2 AND pi.confidence >= 0.5
             AND p.merged_into_person_id IS NULL`,
          [normEmail, id]
        );

        // Upsert the identifier
        await execute(
          `INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
           VALUES ($1, 'email', $2, $3, 1.0, 'atlas_ui')
           ON CONFLICT (id_type, id_value_norm)
           DO UPDATE SET id_value_raw = EXCLUDED.id_value_raw, confidence = 1.0, source_system = 'atlas_ui'`,
          [id, email.trim(), normEmail]
        );

        results.push({
          field: "email",
          status: "updated",
          ...(conflict ? { warning: `This email is also on ${conflict.display_name}` } : {}),
        });

        await logFieldEdit("person", id, "email", null, normEmail, {
          editedBy: "web_user",
          editSource: "web_ui",
          reason: "Contact info update from request page",
        });
      }
    }

    // Update phone
    if (phone !== undefined) {
      if (phone === null || phone.trim() === "") {
        await execute(
          `DELETE FROM sot.person_identifiers
           WHERE person_id = $1 AND id_type = 'phone' AND source_system = 'atlas_ui'`,
          [id]
        );
        results.push({ field: "phone", status: "removed" });
      } else {
        // Normalize phone: strip non-digits, drop leading 1
        const digits = phone.replace(/\D/g, "");
        const normPhone = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

        if (normPhone.length !== 10) {
          return apiBadRequest("Phone must be 10 digits (US format)");
        }

        // Check for conflict
        const conflict = await queryOne<{ person_id: string; display_name: string }>(
          `SELECT p.person_id, p.display_name
           FROM sot.person_identifiers pi
           JOIN sot.people p ON p.person_id = pi.person_id
           WHERE pi.id_type = 'phone' AND pi.id_value_norm = $1
             AND pi.person_id != $2 AND pi.confidence >= 0.5
             AND p.merged_into_person_id IS NULL`,
          [normPhone, id]
        );

        await execute(
          `INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
           VALUES ($1, 'phone', $2, $3, 1.0, 'atlas_ui')
           ON CONFLICT (id_type, id_value_norm)
           DO UPDATE SET id_value_raw = EXCLUDED.id_value_raw, confidence = 1.0, source_system = 'atlas_ui'`,
          [id, phone.trim(), normPhone]
        );

        results.push({
          field: "phone",
          status: "updated",
          ...(conflict ? { warning: `This phone is also on ${conflict.display_name}` } : {}),
        });

        await logFieldEdit("person", id, "phone", null, normPhone, {
          editedBy: "web_user",
          editSource: "web_ui",
          reason: "Contact info update from request page",
        });
      }
    }

    return apiSuccess({ results });
  } catch (err) {
    console.error("PATCH identifiers error:", err);
    return apiServerError(err instanceof Error ? err.message : "Failed to update identifiers");
  }
}
