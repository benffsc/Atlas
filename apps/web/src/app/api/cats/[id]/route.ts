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
  secondary_color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  needs_microchip: boolean; // TRUE if cat was created without microchip (MIG_891)
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
  first_appointment_date: string | null;
  total_appointments: number;
  is_deceased: boolean | null;
  deceased_date: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  // Atlas Cat ID System (MIG_976)
  atlas_cat_id: string | null;
  atlas_cat_id_is_chipped: boolean | null;
}

interface ClinicAppointment {
  appointment_date: string;
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
  // Disease badge info for UI display
  disease_key: string | null;
  disease_display_name: string | null;
  disease_short_code: string | null;
  disease_badge_color: string | null;
  disease_severity: number | null;
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

interface CatAppointmentSummary {
  appointment_id: string;
  appointment_date: string;
  appointment_category: string; // spay_neuter, wellness, recheck, other
  service_types: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  vet_name: string | null;
  vaccines: string[];
  treatments: string[];
}

interface OriginPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  inferred_source: string | null;
}

interface PartnerOrg {
  org_id: string;
  org_name: string;
  org_name_short: string;
  first_seen: string;
  appointment_count: number;
}

// Multi-source field transparency (MIG_620)
interface FieldSourceValue {
  value: string;
  source: string;
  observed_at: string;
  is_current: boolean;
  confidence: number | null;
}

interface CatFieldSources {
  field_sources: Record<string, FieldSourceValue[]> | null;
  has_conflicts: boolean;
  source_count: number;
}

interface EnhancedClinicAppointment {
  appointment_id: string;
  appointment_date: string;
  appt_number: string;
  client_name: string | null;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
  origin_address: string | null;
  partner_org_short: string | null;
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
    // V2: Fixed column names to match actual view columns
    const sql = `
      SELECT
        v.cat_id,
        v.display_name,
        v.sex,
        v.altered_status,
        FALSE AS altered_by_clinic,
        v.breed,
        COALESCE(v.color, v.primary_color) AS color,
        c.secondary_color,
        v.pattern AS coat_pattern,
        v.microchip,
        FALSE AS needs_microchip,
        v.data_source,
        v.ownership_type,
        c.data_quality AS quality_tier,
        NULL::TEXT AS quality_reason,
        NULL::TEXT AS notes,
        v.identifiers,
        v.owners,
        v.places,
        v.created_at,
        v.updated_at,
        v.is_deceased,
        v.deceased_at::TEXT AS deceased_date,
        c.verified_at,
        c.verified_by,
        s.display_name AS verified_by_name,
        NULL::TEXT AS atlas_cat_id,
        FALSE AS atlas_cat_id_is_chipped
      FROM sot.v_cat_detail v
      JOIN sot.cats c ON c.cat_id = v.cat_id
      LEFT JOIN ops.staff s ON c.verified_by = s.staff_id::text
      WHERE v.cat_id = $1
    `;

    // Fallback query that doesn't depend on views
    // V2: Uses correct column names (name not display_name, etc.)
    const fallbackSql = `
      SELECT
        c.cat_id,
        c.name AS display_name,
        c.sex,
        c.altered_status,
        FALSE AS altered_by_clinic,
        c.breed,
        COALESCE(c.primary_color, c.color) AS color,
        c.secondary_color,
        c.pattern AS coat_pattern,
        c.microchip,
        FALSE AS needs_microchip,
        c.data_source,
        c.ownership_type,
        c.data_quality AS quality_tier,
        NULL::TEXT AS quality_reason,
        NULL::TEXT AS notes,
        '[]'::jsonb AS identifiers,
        '[]'::jsonb AS owners,
        '[]'::jsonb AS places,
        c.created_at,
        c.updated_at,
        c.is_deceased,
        c.deceased_at::TEXT AS deceased_date,
        c.verified_at,
        c.verified_by,
        s.display_name AS verified_by_name,
        NULL::TEXT AS atlas_cat_id,
        FALSE AS atlas_cat_id_is_chipped
      FROM sot.cats c
      LEFT JOIN ops.staff s ON c.verified_by = s.staff_id::text
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

    // Fetch first visit date from sot_appointments (canonical source)
    const visitStatsSql = `
      SELECT
        MIN(appointment_date)::TEXT as first_appointment_date,
        COUNT(*)::INT as total_appointments
      FROM ops.appointments
      WHERE cat_id = $1
    `;
    const visitStats = await queryOne<{ first_appointment_date: string | null; total_appointments: number }>(visitStatsSql, [id]);
    if (visitStats) {
      cat.first_appointment_date = visitStats.first_appointment_date;
      cat.total_appointments = visitStats.total_appointments;
    }

    // Fetch clinic history (who brought this cat to clinic)
    const clinicHistorySql = `
      SELECT
        appointment_date::TEXT,
        appt_number,
        client_name,
        client_address,
        client_email,
        client_phone,
        ownership_type
      FROM sot.v_cat_clinic_history
      WHERE cat_id = $1
      ORDER BY appointment_date DESC
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
      FROM ops.cat_vitals
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
      FROM ops.cat_conditions
      WHERE cat_id = $1
      ORDER BY diagnosed_at DESC
    `;

    // Fetch test results with disease badge info for display
    // V2: Uses ops.cat_test_results (not sot.cat_test_results)
    // Joins to ops.disease_types to get badge_color, short_code for UI display
    const testsSql = `
      SELECT
        ctr.test_id,
        ctr.test_type,
        ctr.test_date::TEXT,
        ctr.result::TEXT,
        ctr.result_detail,
        -- Disease badge info for UI display
        dt.disease_key,
        dt.display_label as disease_display_name,
        dt.short_code as disease_short_code,
        dt.badge_color as disease_badge_color,
        dt.severity_order as disease_severity
      FROM ops.cat_test_results ctr
      LEFT JOIN ops.disease_types dt ON (
        -- Direct match
        dt.disease_key = ctr.test_type
        -- Handle combo tests: felv_fiv_combo maps to both felv and fiv
        OR (ctr.test_type = 'felv_fiv_combo' AND dt.disease_key IN ('felv', 'fiv')
            AND ctr.result ILIKE '%' || dt.disease_key || '%positive%')
      )
      WHERE ctr.cat_id = $1
      ORDER BY ctr.test_date DESC
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
      FROM ops.cat_procedures
      WHERE cat_id = $1
      ORDER BY procedure_date DESC
    `;

    // Fetch appointments with categories
    // V2: service_type is often empty, so we infer category from is_spay/is_neuter flags
    const appointmentsSql = `
      SELECT
        v.appointment_id,
        v.appointment_date::TEXT as appointment_date,
        v.appointment_number as clinic_day_number,
        CASE
            WHEN v.service_type ILIKE '%spay%' OR v.service_type ILIKE '%neuter%' THEN 'Spay/Neuter'
            WHEN COALESCE(v.is_spay, false) OR COALESCE(v.is_neuter, false) THEN 'Spay/Neuter'
            WHEN v.service_type ILIKE '%examination%brief%' OR v.service_type ILIKE '%exam%feral%'
                 OR v.service_type ILIKE '%exam fee%' THEN 'Wellness'
            WHEN v.service_type ILIKE '%recheck%' THEN 'Recheck'
            WHEN v.service_type ILIKE '%euthanasia%' THEN 'Euthanasia'
            WHEN v.service_type ILIKE '%tnr%' THEN 'TNR'
            WHEN v.service_type IS NULL OR v.service_type = '' THEN 'Clinic Visit'
            ELSE 'Clinic Visit'
        END as appointment_category,
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
      FROM ops.v_appointment_detail v
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
      FROM sot.cat_mortality_events
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
      FROM sot.cat_birth_events be
      LEFT JOIN sot.cats mc ON mc.cat_id = be.mother_cat_id
      LEFT JOIN sot.places p ON p.place_id = be.place_id
      WHERE be.cat_id = $1
    `;

    // Fetch sibling info if part of a litter
    const siblingsSql = `
      SELECT
        c.cat_id,
        c.display_name,
        c.sex,
        c.microchip
      FROM sot.cat_birth_events be
      JOIN sot.cat_birth_events be2 ON be2.litter_id = be.litter_id AND be2.cat_id != be.cat_id
      JOIN sot.cats c ON c.cat_id = be2.cat_id
      WHERE be.cat_id = $1
      LIMIT 10
    `;

    // Fetch enhanced stakeholder relationships (MIG_544)
    // V2: Uses sot.person_cat (not sot.person_cat_relationships)
    const stakeholdersSql = `
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
          WHEN 'owner' THEN 1
          WHEN 'adopter' THEN 2
          WHEN 'fostering' THEN 3
          WHEN 'caretaker' THEN 4
          WHEN 'brought_in_by' THEN 5
          ELSE 6
        END,
        pc.created_at DESC NULLS LAST
    `;

    // Fetch movement timeline (MIG_546)
    const movementsSql = `
      SELECT
        me.movement_id,
        me.from_place_id,
        fp.display_name AS from_place_name,
        fp.formatted_address AS from_address,
        me.to_place_id,
        tp.display_name AS to_place_name,
        tp.formatted_address AS to_address,
        me.event_date::TEXT,
        me.days_since_previous,
        ROUND(me.distance_meters) AS distance_meters,
        me.movement_type,
        me.source_type,
        me.notes
      FROM sot.cat_movement_events me
      LEFT JOIN sot.places fp ON fp.place_id = me.from_place_id
      JOIN sot.places tp ON tp.place_id = me.to_place_id
      WHERE me.cat_id = $1
      ORDER BY me.event_date DESC
      LIMIT 20
    `;

    // Fetch primary origin place (from most recent appointment with place)
    const originPlaceSql = `
      SELECT DISTINCT ON (a.cat_id)
        p.place_id,
        p.display_name,
        p.formatted_address,
        a.inferred_place_source
      FROM ops.appointments a
      JOIN sot.places p ON p.place_id = COALESCE(a.inferred_place_id, a.place_id)
      WHERE a.cat_id = $1
        AND COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
      ORDER BY a.cat_id, a.appointment_date DESC
    `;

    // Fetch partner organizations this cat has been associated with
    // V2: Uses 'name' and 'short_name' columns (not org_name, org_name_short)
    const partnerOrgsSql = `
      SELECT
        po.org_id,
        po.name AS org_name,
        po.short_name AS org_name_short,
        MIN(a.appointment_date)::TEXT as first_seen,
        COUNT(*)::INT as appointment_count
      FROM ops.appointments a
      JOIN ops.partner_organizations po ON po.org_id = a.partner_org_id
      WHERE a.cat_id = $1
      GROUP BY po.org_id, po.name, po.short_name
      ORDER BY first_seen
    `;

    // Enhanced clinic history with origin addresses and partner orgs
    // V2: Uses sot.person_place and po.short_name
    const enhancedClinicHistorySql = `
      SELECT
        a.appointment_id,
        a.appointment_date::TEXT as appointment_date,
        a.appointment_number as appt_number,
        COALESCE(p.display_name, coa.display_name) as client_name,
        COALESCE(pl.formatted_address, a.owner_address) as client_address,
        a.owner_email as client_email,
        a.owner_phone as client_phone,
        NULL::TEXT as ownership_type,
        pl2.formatted_address as origin_address,
        po.short_name as partner_org_short
      FROM ops.appointments a
      LEFT JOIN sot.people p ON p.person_id = a.person_id
      LEFT JOIN ops.clinic_accounts coa ON coa.account_id = a.owner_account_id
      LEFT JOIN sot.person_place ppr ON ppr.person_id = a.person_id
      LEFT JOIN sot.places pl ON pl.place_id = ppr.place_id
      LEFT JOIN sot.places pl2 ON pl2.place_id = COALESCE(a.inferred_place_id, a.place_id)
      LEFT JOIN ops.partner_organizations po ON po.org_id = a.partner_org_id
      WHERE a.cat_id = $1
      ORDER BY a.appointment_date DESC
    `;

    // Multi-source field transparency (MIG_620)
    // Shows which sources reported different values for key fields
    const fieldSourcesSql = `
      SELECT
        field_sources,
        has_conflicts,
        source_count
      FROM sot.v_cat_field_sources_summary
      WHERE cat_id = $1
    `;

    // Helper function for graceful query execution (returns empty array on error)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function safeQueryRows<T>(sql: string, params: unknown[]): Promise<T[]> {
      try {
        return await queryRows<any>(sql, params) as T[];
      } catch (err) {
        console.warn("Query failed (returning empty array):", err instanceof Error ? err.message : err);
        return [];
      }
    }

    const [clinicHistory, vitals, conditions, tests, procedures, appointments, mortalityRows, birthRows, siblingRows, stakeholders, movements, originPlaceRows, partnerOrgs, enhancedClinicHistory, fieldSourcesRows] = await Promise.all([
      safeQueryRows<ClinicAppointment>(clinicHistorySql, [id]),
      safeQueryRows<CatVital>(vitalsSql, [id]),
      safeQueryRows<CatCondition>(conditionsSql, [id]),
      safeQueryRows<CatTestResult>(testsSql, [id]),
      safeQueryRows<CatProcedure>(proceduresSql, [id]),
      safeQueryRows<CatAppointmentSummary>(appointmentsSql, [id]),
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
      safeQueryRows<{
        person_id: string;
        person_name: string;
        person_email: string | null;
        relationship_type: string;
        confidence: string;
        context_notes: string | null;
        effective_date: string | null;
        appointment_date: string | null;
        appointment_number: string | null;
        source_system: string;
        created_at: string;
      }>(stakeholdersSql, [id]),
      safeQueryRows<{
        movement_id: string;
        from_place_id: string | null;
        from_place_name: string | null;
        from_address: string | null;
        to_place_id: string;
        to_place_name: string;
        to_address: string;
        event_date: string;
        days_since_previous: number | null;
        distance_meters: number | null;
        movement_type: string;
        source_type: string;
        notes: string | null;
      }>(movementsSql, [id]),
      safeQueryRows<OriginPlace>(originPlaceSql, [id]),
      safeQueryRows<PartnerOrg>(partnerOrgsSql, [id]),
      safeQueryRows<EnhancedClinicAppointment>(enhancedClinicHistorySql, [id]),
      safeQueryRows<CatFieldSources>(fieldSourcesSql, [id]),
    ]);

    // Extract field sources from result
    const fieldSourcesData = fieldSourcesRows[0] || null;

    return NextResponse.json({
      ...cat,
      clinic_history: clinicHistory,
      vitals,
      conditions,
      tests,
      procedures,
      appointments,
      mortality_event: mortalityRows[0] || null,
      birth_event: birthRows[0] || null,
      siblings: siblingRows,
      // Enhanced relationship data (MIG_544, MIG_547)
      stakeholders,
      // Movement timeline (MIG_546)
      movements,
      // Origin and partner org data (MIG_581, MIG_582)
      primary_origin_place: originPlaceRows[0] || null,
      partner_orgs: partnerOrgs,
      enhanced_clinic_history: enhancedClinicHistory,
      // Multi-source field transparency (MIG_620)
      field_sources: fieldSourcesData?.field_sources || null,
      has_field_conflicts: fieldSourcesData?.has_conflicts || false,
      field_source_count: fieldSourcesData?.source_count || 0,
    });
  } catch (error) {
    console.error("Error fetching cat detail:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch cat detail",
        details: errorMessage,
        cat_id: id
      },
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
  breed?: string;
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

    // Get current cat data for audit comparison
    const currentSql = `
      SELECT display_name, sex, altered_status, primary_color, breed, notes
      FROM sot.cats WHERE cat_id = $1
    `;
    const current = await queryOne<{
      display_name: string | null;
      sex: string | null;
      altered_status: string | null;
      primary_color: string | null;
      breed: string | null;
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
    if (body.name !== undefined && body.name !== current.display_name) {
      auditChanges.push({ field: "display_name", oldVal: current.display_name, newVal: body.name || null });
      updates.push(`display_name = $${paramIndex}`);
      values.push(body.name);
      paramIndex++;
    }

    // Sex: normalize to lowercase, no enum cast (column is plain text)
    if (body.sex !== undefined) {
      const normalizedSex = body.sex ? body.sex.toLowerCase() : null;
      const currentNorm = current.sex ? current.sex.toLowerCase() : null;
      if (normalizedSex !== currentNorm) {
        auditChanges.push({ field: "sex", oldVal: current.sex, newVal: normalizedSex });
        updates.push(`sex = $${paramIndex}`);
        values.push(normalizedSex);
        paramIndex++;
      }
    }

    // is_eartipped (boolean from UI) → altered_status (text in DB)
    if (body.is_eartipped !== undefined) {
      const currentIsAltered = current.altered_status
        ? ["yes", "spayed", "neutered"].includes(current.altered_status.toLowerCase())
        : false;
      if (body.is_eartipped !== currentIsAltered) {
        const newStatus = body.is_eartipped ? "Yes" : "No";
        auditChanges.push({ field: "altered_status", oldVal: current.altered_status, newVal: newStatus });
        updates.push(`altered_status = $${paramIndex}`);
        values.push(newStatus);
        paramIndex++;
      }
    }

    if (body.color_pattern !== undefined && body.color_pattern !== current.primary_color) {
      auditChanges.push({ field: "primary_color", oldVal: current.primary_color, newVal: body.color_pattern || null });
      updates.push(`primary_color = $${paramIndex}`);
      values.push(body.color_pattern);
      paramIndex++;
    }

    if (body.breed !== undefined && body.breed !== current.breed) {
      auditChanges.push({ field: "breed", oldVal: current.breed, newVal: body.breed || null });
      updates.push(`breed = $${paramIndex}`);
      values.push(body.breed);
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
      UPDATE sot.cats
      SET ${updates.join(", ")}
      WHERE cat_id = $${paramIndex}
      RETURNING cat_id, display_name, sex, altered_status, primary_color, breed
    `;

    const result = await queryOne<{
      cat_id: string;
      display_name: string;
      sex: string | null;
      altered_status: string | null;
      primary_color: string | null;
      breed: string | null;
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
