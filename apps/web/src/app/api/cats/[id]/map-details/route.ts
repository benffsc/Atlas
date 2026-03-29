import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID, withErrorHandling } from "@/lib/api-validation";
import { apiSuccess, apiNotFound } from "@/lib/api-response";

/**
 * Lightweight cat details for the map CatDetailDrawer.
 * Returns only what the drawer needs — no clinic_history, vitals, conditions,
 * procedures, field_sources, enhanced_clinic_history, or adoption_context.
 *
 * ~4 queries vs ~13 in the full /api/cats/[id] endpoint.
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "cat");

  // Basic cat info
  const catSql = `
    SELECT
      c.cat_id,
      COALESCE(c.name, 'Unknown') AS display_name,
      c.sex,
      c.altered_status,
      c.breed,
      COALESCE(c.primary_color, c.color) AS color,
      c.secondary_color,
      c.pattern AS coat_pattern,
      c.microchip,
      c.ownership_type,
      c.is_deceased,
      (SELECT vcs.current_status FROM sot.v_cat_current_status vcs WHERE vcs.cat_id = c.cat_id) AS current_status,
      (SELECT COUNT(*)::INT FROM ops.appointments WHERE cat_id = c.cat_id) AS total_appointments,
      (SELECT MIN(appointment_date)::TEXT FROM ops.appointments WHERE cat_id = c.cat_id) AS first_appointment_date,
      (SELECT MAX(appointment_date)::TEXT FROM ops.appointments WHERE cat_id = c.cat_id) AS last_appointment_date
    FROM sot.cats c
    WHERE c.cat_id = $1 AND c.merged_into_cat_id IS NULL
  `;

  const cat = await queryOne<Record<string, unknown>>(catSql, [id]);
  if (!cat) return apiNotFound("Cat", id);

  // Run remaining queries in parallel — only what the drawer needs
  const [tests, appointments, stakeholders, places, originPlace] = await Promise.all([
    // Tests (for health badges)
    queryRows(`
      SELECT test_id, test_type, test_date::TEXT, result::TEXT, result_detail
      FROM ops.cat_test_results
      WHERE cat_id = $1
      ORDER BY test_date DESC
      LIMIT 10
    `, [id]).catch(() => []),

    // Appointments (top 5 for the collapsed list)
    queryRows(`
      SELECT
        v.appointment_id,
        v.appointment_date::TEXT,
        CASE
          WHEN v.service_type ILIKE '%spay%' OR v.service_type ILIKE '%neuter%' THEN 'Spay/Neuter'
          WHEN COALESCE(v.is_spay, false) OR COALESCE(v.is_neuter, false) THEN 'Spay/Neuter'
          WHEN v.service_type ILIKE '%recheck%' THEN 'Recheck'
          WHEN v.service_type ILIKE '%euthanasia%' THEN 'Euthanasia'
          ELSE 'Clinic Visit'
        END AS appointment_category,
        v.service_type AS service_types,
        COALESCE(v.is_spay, false) AS is_spay,
        COALESCE(v.is_neuter, false) AS is_neuter,
        v.vet_name,
        '{}'::TEXT[] AS vaccines,
        '{}'::TEXT[] AS treatments
      FROM ops.v_appointment_detail v
      WHERE v.cat_id = $1
      ORDER BY v.appointment_date DESC
      LIMIT 10
    `, [id]).catch(() => []),

    // Stakeholders
    queryRows(`
      SELECT
        pc.person_id,
        p.display_name AS person_name,
        pi.id_value_norm AS person_email,
        pc.relationship_type,
        pc.confidence,
        NULL::TEXT AS context_notes,
        NULL::TEXT AS effective_date,
        NULL::TEXT AS appointment_date,
        NULL::TEXT AS appointment_number,
        pc.source_system,
        pc.created_at::TEXT
      FROM sot.person_cat pc
      JOIN sot.people p ON p.person_id = pc.person_id
      LEFT JOIN sot.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.confidence >= 0.5
      WHERE pc.cat_id = $1
      ORDER BY
        CASE pc.relationship_type
          WHEN 'owner' THEN 1 WHEN 'adopter' THEN 2 WHEN 'fostering' THEN 3
          WHEN 'caretaker' THEN 4 WHEN 'brought_in_by' THEN 5 ELSE 6
        END,
        pc.created_at DESC NULLS LAST
    `, [id]).catch(() => []),

    // Places
    queryRows(`
      SELECT DISTINCT p.place_id, p.display_name, p.formatted_address, cp.relationship_type
      FROM sot.cat_place cp
      JOIN sot.places p ON p.place_id = cp.place_id
      WHERE cp.cat_id = $1
      ORDER BY cp.relationship_type
      LIMIT 10
    `, [id]).catch(() => []),

    // Primary origin place
    queryOne(`
      SELECT DISTINCT ON (a.cat_id)
        p.place_id, p.display_name, p.formatted_address
      FROM ops.appointments a
      JOIN sot.places p ON p.place_id = COALESCE(a.inferred_place_id, a.place_id)
      WHERE a.cat_id = $1 AND COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
      ORDER BY a.cat_id, a.appointment_date DESC
    `, [id]).catch(() => null),
  ]);

  return apiSuccess({
    ...cat,
    tests,
    appointments,
    stakeholders,
    movements: [],
    places,
    primary_origin_place: originPlace || null,
  });
});
