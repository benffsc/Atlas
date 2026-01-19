import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, query } from "@/lib/db";
import { logFieldEdits, detectChanges } from "@/lib/audit";

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
  is_deceased: boolean | null;
  deceased_date: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
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
    // Primary query using v_cat_detail view
    const sql = `
      SELECT
        v.cat_id,
        v.display_name,
        v.sex,
        v.altered_status,
        v.altered_by_clinic,
        v.breed,
        v.color,
        v.coat_pattern,
        v.microchip,
        v.data_source,
        v.ownership_type,
        v.quality_tier,
        v.quality_reason,
        v.notes,
        v.identifiers,
        v.owners,
        v.places,
        v.created_at,
        v.updated_at,
        c.is_deceased,
        c.deceased_date::TEXT,
        c.verified_at,
        c.verified_by,
        s.display_name AS verified_by_name
      FROM trapper.v_cat_detail v
      JOIN trapper.sot_cats c ON c.cat_id = v.cat_id
      LEFT JOIN trapper.staff s ON c.verified_by = s.staff_id::text
      WHERE v.cat_id = $1
    `;

    // Fallback query that doesn't depend on views
    const fallbackSql = `
      SELECT
        c.cat_id,
        c.display_name,
        c.sex,
        c.altered_status,
        c.altered_by_clinic,
        c.breed,
        c.primary_color AS color,
        NULL::TEXT AS coat_pattern,
        (SELECT ci.id_value FROM trapper.cat_identifiers ci
         WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1) AS microchip,
        c.data_source,
        c.ownership_type,
        NULL::TEXT AS quality_tier,
        NULL::TEXT AS quality_reason,
        c.notes,
        '[]'::jsonb AS identifiers,
        '[]'::jsonb AS owners,
        '[]'::jsonb AS places,
        c.created_at,
        c.updated_at,
        c.is_deceased,
        c.deceased_date::TEXT,
        c.verified_at,
        c.verified_by,
        s.display_name AS verified_by_name
      FROM trapper.sot_cats c
      LEFT JOIN trapper.staff s ON c.verified_by = s.staff_id::text
      WHERE c.cat_id = $1
    `;

    let cat: CatDetailRow | null = null;
    let usedFallback = false;

    // Try primary query first, fallback if view doesn't exist
    try {
      cat = await queryOne<CatDetailRow>(sql, [id]);
    } catch (viewError) {
      console.warn("v_cat_detail view query failed, using fallback:", viewError instanceof Error ? viewError.message : viewError);
      usedFallback = true;
      cat = await queryOne<CatDetailRow>(fallbackSql, [id]);
    }

    if (!cat) {
      return NextResponse.json(
        { error: "Cat not found" },
        { status: 404 }
      );
    }

    // Log if we used fallback for debugging
    if (usedFallback) {
      console.log(`Cat ${id} fetched using fallback query (v_cat_detail view unavailable)`);
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

    // Fetch mortality event if cat is deceased
    const mortalitySql = `
      SELECT
        mortality_event_id,
        death_date::TEXT,
        death_cause::TEXT,
        death_age_category::TEXT,
        source_system,
        notes,
        created_at::TEXT
      FROM trapper.cat_mortality_events
      WHERE cat_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    // Fetch birth event
    const birthSql = `
      SELECT
        be.birth_event_id,
        be.litter_id,
        be.mother_cat_id,
        mc.display_name AS mother_name,
        be.birth_date::TEXT,
        be.birth_date_precision::TEXT,
        be.birth_year,
        be.birth_month,
        be.birth_season,
        be.place_id,
        p.display_name AS place_name,
        be.kitten_count_in_litter,
        be.survived_to_weaning,
        be.litter_survived_count,
        be.source_system,
        be.notes,
        be.created_at::TEXT
      FROM trapper.cat_birth_events be
      LEFT JOIN trapper.sot_cats mc ON mc.cat_id = be.mother_cat_id
      LEFT JOIN trapper.places p ON p.place_id = be.place_id
      WHERE be.cat_id = $1
    `;

    // Fetch sibling info if part of a litter
    const siblingsSql = `
      SELECT
        c.cat_id,
        c.display_name,
        c.sex,
        c.microchip
      FROM trapper.cat_birth_events be
      JOIN trapper.cat_birth_events be2 ON be2.litter_id = be.litter_id AND be2.cat_id != be.cat_id
      JOIN trapper.sot_cats c ON c.cat_id = be2.cat_id
      WHERE be.cat_id = $1
      LIMIT 10
    `;

    // Helper function for graceful query execution (returns empty array on error)
    async function safeQueryRows<T>(sql: string, params: unknown[]): Promise<T[]> {
      try {
        return await queryRows<T>(sql, params);
      } catch (err) {
        console.warn("Query failed (returning empty array):", err instanceof Error ? err.message : err);
        return [];
      }
    }

    const [clinicHistory, vitals, conditions, tests, procedures, visits, mortalityRows, birthRows, siblingRows] = await Promise.all([
      safeQueryRows<ClinicVisit>(clinicHistorySql, [id]),
      safeQueryRows<CatVital>(vitalsSql, [id]),
      safeQueryRows<CatCondition>(conditionsSql, [id]),
      safeQueryRows<CatTestResult>(testsSql, [id]),
      safeQueryRows<CatProcedure>(proceduresSql, [id]),
      safeQueryRows<CatVisitSummary>(visitsSql, [id]),
      safeQueryRows<{
        mortality_event_id: string;
        death_date: string | null;
        death_cause: string;
        death_age_category: string;
        source_system: string;
        notes: string | null;
        created_at: string;
      }>(mortalitySql, [id]),
      safeQueryRows<{
        birth_event_id: string;
        litter_id: string;
        mother_cat_id: string | null;
        mother_name: string | null;
        birth_date: string | null;
        birth_date_precision: string;
        birth_year: number | null;
        birth_month: number | null;
        birth_season: string | null;
        place_id: string | null;
        place_name: string | null;
        kitten_count_in_litter: number | null;
        survived_to_weaning: boolean | null;
        litter_survived_count: number | null;
        source_system: string;
        notes: string | null;
        created_at: string;
      }>(birthSql, [id]),
      safeQueryRows<{
        cat_id: string;
        display_name: string;
        sex: string | null;
        microchip: string | null;
      }>(siblingsSql, [id]),
    ]);

    return NextResponse.json({
      ...cat,
      clinic_history: clinicHistory,
      vitals,
      conditions,
      tests,
      procedures,
      visits,
      mortality_event: mortalityRows[0] || null,
      birth_event: birthRows[0] || null,
      siblings: siblingRows,
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
    const auditChanges: Array<{ field: string; oldVal: string | null; newVal: string | null }> = [];

    // Check each field for changes
    if (body.name !== undefined && body.name !== current.name) {
      auditChanges.push({ field: "name", oldVal: current.name, newVal: body.name || null });
      updates.push(`name = $${paramIndex}`);
      values.push(body.name);
      paramIndex++;
    }

    if (body.sex !== undefined && body.sex !== current.sex) {
      auditChanges.push({ field: "sex", oldVal: current.sex, newVal: body.sex });
      updates.push(`sex = $${paramIndex}::trapper.cat_sex`);
      values.push(body.sex);
      paramIndex++;
    }

    if (body.is_eartipped !== undefined && body.is_eartipped !== current.is_eartipped) {
      auditChanges.push({
        field: "is_eartipped",
        oldVal: current.is_eartipped?.toString() ?? null,
        newVal: body.is_eartipped?.toString() ?? null
      });
      updates.push(`is_eartipped = $${paramIndex}`);
      values.push(body.is_eartipped);
      paramIndex++;
    }

    if (body.color_pattern !== undefined && body.color_pattern !== current.color_pattern) {
      auditChanges.push({ field: "color_pattern", oldVal: current.color_pattern, newVal: body.color_pattern || null });
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

    // Log changes to centralized entity_edits table
    if (auditChanges.length > 0) {
      await logFieldEdits(
        "cat",
        id,
        auditChanges.map((c) => ({
          field: c.field,
          oldValue: c.oldVal,
          newValue: c.newVal,
        })),
        {
          editedBy: changed_by,
          reason: change_reason,
          editSource: "web_ui",
        }
      );
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
