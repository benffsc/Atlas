import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, query } from "@/lib/db";

interface CatDetailRow {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  altered_by_clinic: boolean | null; // TRUE if we performed the spay/neuter
  breed: string | null;
  color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  data_source: string | null; // clinichq, petlink, or legacy_import
  ownership_type: string | null; // Community Cat (Feral), Community Cat (Friendly), Owned, Foster
  quality_tier: string | null;
  quality_reason: string | null;
  notes: string | null;
  identifiers: object[];
  owners: object[];
  places: object[];
  created_at: string;
  updated_at: string;
  first_visit_date: string | null;
  total_visits: number;
}

interface ClinicVisit {
  visit_date: string;
  appt_number: string;
  client_name: string;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
}

interface CatVital {
  vital_id: string;
  recorded_at: string;
  temperature_f: number | null;
  weight_lbs: number | null;
  is_pregnant: boolean;
  is_lactating: boolean;
  is_in_heat: boolean;
}

interface CatCondition {
  condition_id: string;
  condition_type: string;
  severity: string | null;
  diagnosed_at: string;
  resolved_at: string | null;
  is_chronic: boolean;
}

interface CatTestResult {
  test_id: string;
  test_type: string;
  test_date: string;
  result: string;
  result_detail: string | null;
}

interface CatProcedure {
  procedure_id: string;
  procedure_type: string;
  procedure_date: string;
  status: string;
  performed_by: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  complications: string[] | null;
  post_op_notes: string | null;
}

interface CatVisitSummary {
  appointment_id: string;
  visit_date: string;
  visit_category: string; // spay_neuter, wellness, recheck, other
  service_types: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  vet_name: string | null;
  vaccines: string[];
  treatments: string[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        cat_id,
        display_name,
        sex,
        altered_status,
        altered_by_clinic,
        breed,
        color,
        coat_pattern,
        microchip,
        data_source,
        ownership_type,
        quality_tier,
        quality_reason,
        notes,
        identifiers,
        owners,
        places,
        created_at,
        updated_at
      FROM trapper.v_cat_detail
      WHERE cat_id = $1
    `;

    const cat = await queryOne<CatDetailRow>(sql, [id]);

    if (!cat) {
      return NextResponse.json(
        { error: "Cat not found" },
        { status: 404 }
      );
    }

    // Fetch first visit date from ClinicHQ
    const visitStatsSql = `
      SELECT
        MIN(visit_date)::TEXT as first_visit_date,
        COUNT(*)::INT as total_visits
      FROM trapper.clinichq_visits cv
      WHERE cv.microchip = (
        SELECT ci.id_value
        FROM trapper.cat_identifiers ci
        WHERE ci.cat_id = $1 AND ci.id_type = 'microchip'
        LIMIT 1
      )
    `;
    const visitStats = await queryOne<{ first_visit_date: string | null; total_visits: number }>(visitStatsSql, [id]);
    if (visitStats) {
      cat.first_visit_date = visitStats.first_visit_date;
      cat.total_visits = visitStats.total_visits;
    }

    // Fetch clinic history (who brought this cat to clinic)
    const clinicHistorySql = `
      SELECT
        visit_date::TEXT,
        appt_number,
        client_name,
        client_address,
        client_email,
        client_phone,
        ownership_type
      FROM trapper.v_cat_clinic_history
      WHERE cat_id = $1
      ORDER BY visit_date DESC
    `;

    // Fetch vitals (latest 10)
    const vitalsSql = `
      SELECT
        vital_id,
        recorded_at::TEXT,
        temperature_f,
        weight_lbs,
        is_pregnant,
        is_lactating,
        is_in_heat
      FROM trapper.cat_vitals
      WHERE cat_id = $1
      ORDER BY recorded_at DESC
      LIMIT 10
    `;

    // Fetch conditions
    const conditionsSql = `
      SELECT
        condition_id,
        condition_type,
        severity::TEXT,
        diagnosed_at::TEXT,
        resolved_at::TEXT,
        is_chronic
      FROM trapper.cat_conditions
      WHERE cat_id = $1
      ORDER BY diagnosed_at DESC
    `;

    // Fetch test results
    const testsSql = `
      SELECT
        test_id,
        test_type,
        test_date::TEXT,
        result::TEXT,
        result_detail
      FROM trapper.cat_test_results
      WHERE cat_id = $1
      ORDER BY test_date DESC
    `;

    // Fetch procedures
    const proceduresSql = `
      SELECT
        procedure_id,
        procedure_type,
        procedure_date::TEXT,
        status::TEXT,
        performed_by,
        is_spay,
        is_neuter,
        complications,
        post_op_notes
      FROM trapper.cat_procedures
      WHERE cat_id = $1
      ORDER BY procedure_date DESC
    `;

    // Fetch consolidated visits with categories
    const visitsSql = `
      SELECT
        v.appointment_id,
        v.appointment_date::TEXT as visit_date,
        CASE
            WHEN v.service_type ILIKE '%spay%' OR v.service_type ILIKE '%neuter%' THEN 'Spay/Neuter'
            WHEN v.service_type ILIKE '%examination%brief%' OR v.service_type ILIKE '%exam%feral%'
                 OR v.service_type ILIKE '%exam fee%' THEN 'Wellness'
            WHEN v.service_type ILIKE '%recheck%' THEN 'Recheck'
            WHEN v.service_type ILIKE '%euthanasia%' THEN 'Euthanasia'
            ELSE 'Visit'
        END as visit_category,
        v.service_type as service_types,
        COALESCE(v.is_spay, false) as is_spay,
        COALESCE(v.is_neuter, false) as is_neuter,
        v.vet_name,
        -- Extract vaccines from service_type
        ARRAY_REMOVE(ARRAY[
            CASE WHEN v.service_type ILIKE '%rabies%3%year%' THEN 'Rabies (3yr)' END,
            CASE WHEN v.service_type ILIKE '%rabies%1%year%' THEN 'Rabies (1yr)' END,
            CASE WHEN v.service_type ILIKE '%fvrcp%' THEN 'FVRCP' END
        ], NULL) as vaccines,
        -- Extract treatments from service_type
        ARRAY_REMOVE(ARRAY[
            CASE WHEN v.service_type ILIKE '%revolution%' THEN 'Revolution (flea/parasite)' END,
            CASE WHEN v.service_type ILIKE '%advantage%' THEN 'Advantage (flea)' END,
            CASE WHEN v.service_type ILIKE '%activyl%' THEN 'Activyl (flea)' END,
            CASE WHEN v.service_type ILIKE '%convenia%' THEN 'Convenia (antibiotic)' END,
            CASE WHEN v.service_type ILIKE '%praziquantel%' OR v.service_type ILIKE '%droncit%' THEN 'Dewormer' END
        ], NULL) as treatments
      FROM trapper.v_consolidated_visits v
      WHERE v.cat_id = $1
      ORDER BY v.appointment_date DESC
    `;

    const [clinicHistory, vitals, conditions, tests, procedures, visits] = await Promise.all([
      queryRows<ClinicVisit>(clinicHistorySql, [id]),
      queryRows<CatVital>(vitalsSql, [id]),
      queryRows<CatCondition>(conditionsSql, [id]),
      queryRows<CatTestResult>(testsSql, [id]),
      queryRows<CatProcedure>(proceduresSql, [id]),
      queryRows<CatVisitSummary>(visitsSql, [id]),
    ]);

    return NextResponse.json({
      ...cat,
      clinic_history: clinicHistory,
      vitals,
      conditions,
      tests,
      procedures,
      visits,
    });
  } catch (error) {
    console.error("Error fetching cat detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch cat detail" },
      { status: 500 }
    );
  }
}

// PATCH - Update cat info with audit tracking
interface UpdateCatBody {
  name?: string;
  sex?: string;
  is_eartipped?: boolean;
  color_pattern?: string;
  notes?: string;
  // Audit info
  changed_by?: string;
  change_reason?: string;
  change_notes?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: UpdateCatBody = await request.json();
    const changed_by = body.changed_by || "web_user";
    const change_reason = body.change_reason || "manual_update";
    const change_notes = body.change_notes || null;

    // Fields that can be updated
    const editableFields = ["name", "sex", "is_eartipped", "color_pattern", "notes"];

    // Get current cat data for audit comparison
    const currentSql = `
      SELECT name, sex, is_eartipped, color_pattern, notes
      FROM trapper.sot_cats WHERE cat_id = $1
    `;
    const current = await queryOne<{
      name: string | null;
      sex: string | null;
      is_eartipped: boolean | null;
      color_pattern: string | null;
      notes: string | null;
    }>(currentSql, [id]);

    if (!current) {
      return NextResponse.json({ error: "Cat not found" }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    const auditInserts: string[] = [];

    // Check each field for changes
    if (body.name !== undefined && body.name !== current.name) {
      auditInserts.push(`
        INSERT INTO trapper.cat_changes (cat_id, field_name, old_value, new_value, change_reason, change_notes, changed_by)
        VALUES ('${id}', 'name', ${current.name ? `'${current.name.replace(/'/g, "''")}'` : 'NULL'}, '${(body.name || '').replace(/'/g, "''")}', '${change_reason}', ${change_notes ? `'${change_notes.replace(/'/g, "''")}'` : 'NULL'}, '${changed_by}')
      `);
      updates.push(`name = $${paramIndex}`);
      values.push(body.name);
      paramIndex++;
    }

    if (body.sex !== undefined && body.sex !== current.sex) {
      auditInserts.push(`
        INSERT INTO trapper.cat_changes (cat_id, field_name, old_value, new_value, change_reason, change_notes, changed_by)
        VALUES ('${id}', 'sex', ${current.sex ? `'${current.sex}'` : 'NULL'}, '${body.sex}', '${change_reason}', ${change_notes ? `'${change_notes.replace(/'/g, "''")}'` : 'NULL'}, '${changed_by}')
      `);
      updates.push(`sex = $${paramIndex}::trapper.cat_sex`);
      values.push(body.sex);
      paramIndex++;
    }

    if (body.is_eartipped !== undefined && body.is_eartipped !== current.is_eartipped) {
      auditInserts.push(`
        INSERT INTO trapper.cat_changes (cat_id, field_name, old_value, new_value, change_reason, change_notes, changed_by)
        VALUES ('${id}', 'is_eartipped', '${current.is_eartipped}', '${body.is_eartipped}', '${change_reason}', ${change_notes ? `'${change_notes.replace(/'/g, "''")}'` : 'NULL'}, '${changed_by}')
      `);
      updates.push(`is_eartipped = $${paramIndex}`);
      values.push(body.is_eartipped);
      paramIndex++;
    }

    if (body.color_pattern !== undefined && body.color_pattern !== current.color_pattern) {
      auditInserts.push(`
        INSERT INTO trapper.cat_changes (cat_id, field_name, old_value, new_value, change_reason, change_notes, changed_by)
        VALUES ('${id}', 'color_pattern', ${current.color_pattern ? `'${current.color_pattern.replace(/'/g, "''")}'` : 'NULL'}, '${(body.color_pattern || '').replace(/'/g, "''")}', '${change_reason}', ${change_notes ? `'${change_notes.replace(/'/g, "''")}'` : 'NULL'}, '${changed_by}')
      `);
      updates.push(`color_pattern = $${paramIndex}`);
      values.push(body.color_pattern);
      paramIndex++;
    }

    if (body.notes !== undefined && body.notes !== current.notes) {
      updates.push(`notes = $${paramIndex}`);
      values.push(body.notes);
      paramIndex++;
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: true, message: "No changes detected" });
    }

    // Execute audit inserts
    for (const auditSql of auditInserts) {
      try {
        await query(auditSql, []);
      } catch (err) {
        console.error("Audit log error:", err);
        // Continue even if audit fails
      }
    }

    // Add updated_at and place_id for WHERE
    updates.push(`updated_at = NOW()`);
    values.push(id);

    const sql = `
      UPDATE trapper.sot_cats
      SET ${updates.join(", ")}
      WHERE cat_id = $${paramIndex}
      RETURNING cat_id, name, sex, is_eartipped, color_pattern
    `;

    const result = await queryOne<{
      cat_id: string;
      name: string;
      sex: string | null;
      is_eartipped: boolean;
      color_pattern: string | null;
    }>(sql, values);

    if (!result) {
      return NextResponse.json({ error: "Cat not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      cat: result,
    });
  } catch (error) {
    console.error("Error updating cat:", error);
    return NextResponse.json(
      { error: "Failed to update cat" },
      { status: 500 }
    );
  }
}
