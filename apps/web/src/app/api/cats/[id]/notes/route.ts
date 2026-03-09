import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError, apiBadRequest } from "@/lib/api-response";

/**
 * Cat Clinical Notes API (FFS-367)
 *
 * GET /api/cats/[id]/notes
 *
 * Returns clinical notes from ClinicHQ scrape data:
 * - Medical notes (vet observations)
 * - Quick notes (staff context)
 * - Appointment notes (per-visit notes)
 * - Caution flags
 *
 * Sources from ops.v_scrape_appointment_enrichment (matched scrape records)
 */

interface NoteRow {
  record_id: string;
  appointment_date: string | null;
  appointment_type: string | null;
  animal_quick_notes: string | null;
  animal_appointment_notes: string | null;
  internal_medical_notes: string | null;
  animal_caution: string | null;
}

interface CatNote {
  appointment_date: string | null;
  note_type: "medical" | "quick" | "appointment";
  content: string;
  appointment_type: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "cat");

    const sql = `
      SELECT DISTINCT
        ae.record_id,
        ae.appointment_date,
        ae.appointment_type,
        ae.animal_quick_notes,
        ae.animal_appointment_notes,
        ae.internal_medical_notes,
        ae.animal_caution
      FROM ops.v_scrape_appointment_enrichment ae
      WHERE ae.cat_id = $1
        AND (
          ae.animal_quick_notes IS NOT NULL
          OR ae.animal_appointment_notes IS NOT NULL
          OR ae.internal_medical_notes IS NOT NULL
        )
      ORDER BY ae.appointment_date DESC
    `;

    const rows = await queryRows<NoteRow>(sql, [id]);

    // Flatten into individual notes per type
    const notes: CatNote[] = [];
    const seenContent = new Set<string>();

    for (const row of rows) {
      if (row.internal_medical_notes?.trim()) {
        const key = `medical:${row.internal_medical_notes.trim()}`;
        if (!seenContent.has(key)) {
          seenContent.add(key);
          notes.push({
            appointment_date: row.appointment_date,
            note_type: "medical",
            content: row.internal_medical_notes.trim(),
            appointment_type: row.appointment_type,
          });
        }
      }
      if (row.animal_quick_notes?.trim()) {
        const key = `quick:${row.animal_quick_notes.trim()}`;
        if (!seenContent.has(key)) {
          seenContent.add(key);
          notes.push({
            appointment_date: row.appointment_date,
            note_type: "quick",
            content: row.animal_quick_notes.trim(),
            appointment_type: row.appointment_type,
          });
        }
      }
      if (row.animal_appointment_notes?.trim()) {
        const key = `appointment:${row.animal_appointment_notes.trim()}`;
        if (!seenContent.has(key)) {
          seenContent.add(key);
          notes.push({
            appointment_date: row.appointment_date,
            note_type: "appointment",
            content: row.animal_appointment_notes.trim(),
            appointment_type: row.appointment_type,
          });
        }
      }
    }

    // Get most recent caution flag
    const caution = rows.find(
      (r) => r.animal_caution?.trim() && r.animal_caution.trim() !== ""
    )?.animal_caution?.trim() ?? null;

    return apiSuccess({
      notes,
      caution,
      has_medical_notes: notes.some((n) => n.note_type === "medical"),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching cat notes:", error);
    return apiServerError("Failed to fetch cat notes");
  }
}
