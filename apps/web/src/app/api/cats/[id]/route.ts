import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

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
