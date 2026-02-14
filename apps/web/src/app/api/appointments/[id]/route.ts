import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, query } from "@/lib/db";

interface ProcedureRow {
  procedure_id: string;
  procedure_type: string;
  status: string;
  performed_by: string | null;
  complications: string[] | null;
  post_op_notes: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Appointment ID required" }, { status: 400 });
  }

  try {
    // Main appointment query using enriched view + raw payload for surgery/post-op detail
    const appointment = await queryOne<Record<string, unknown>>(
      `SELECT
        v.appointment_id,
        v.appointment_date::TEXT,
        v.appointment_number,
        v.clinic_day_number,
        v.service_type,
        COALESCE(v.is_spay, FALSE) as is_spay,
        COALESCE(v.is_neuter, FALSE) as is_neuter,
        v.vet_name,
        v.technician,
        v.temperature,
        v.medical_notes,
        COALESCE(v.is_pregnant, FALSE) as is_pregnant,
        COALESCE(v.is_lactating, FALSE) as is_lactating,
        COALESCE(v.is_in_heat, FALSE) as is_in_heat,
        -- Cat info (from enriched view)
        v.cat_id,
        v.cat_name,
        v.cat_sex,
        v.cat_breed,
        v.cat_color,
        v.cat_secondary_color,
        v.cat_microchip,
        c.altered_status as cat_altered_status,
        cat_photo.storage_path as cat_photo_url,
        -- Enriched columns (MIG_870)
        COALESCE(v.cat_weight_lbs, (SELECT cv.weight_lbs
         FROM ops.cat_vitals cv
         WHERE cv.cat_id = v.cat_id
           AND cv.recorded_at::date = v.appointment_date
         ORDER BY cv.recorded_at DESC
         LIMIT 1)) as weight_lbs,
        v.cat_age_years,
        v.cat_age_months,
        v.has_uri, v.has_dental_disease, v.has_ear_issue, v.has_eye_issue,
        v.has_skin_issue, v.has_mouth_issue, v.has_fleas, v.has_ticks,
        v.has_tapeworms, v.has_ear_mites, v.has_ringworm,
        v.felv_fiv_result, v.body_composition_score, v.no_surgery_reason,
        -- Enriched misc flags (MIG_899)
        COALESCE(v.has_polydactyl, FALSE) as has_polydactyl,
        COALESCE(v.has_bradycardia, FALSE) as has_bradycardia,
        COALESCE(v.has_too_young_for_rabies, FALSE) as has_too_young_for_rabies,
        COALESCE(v.has_cryptorchid, FALSE) as has_cryptorchid,
        COALESCE(v.has_hernia, FALSE) as has_hernia,
        COALESCE(v.has_pyometra, FALSE) as has_pyometra,
        v.total_invoiced, v.subsidy_value,
        v.client_name AS enriched_client_name,
        v.client_address AS enriched_client_address,
        v.ownership_type,
        -- Client info (with fallbacks)
        v.person_id,
        COALESCE(v.client_name, v.person_name) as client_name,
        v.contact_email as client_email,
        v.contact_phone as client_phone,
        COALESCE(v.client_address, v.place_address) as client_address,
        -- Raw payload for surgery/post-op details
        (SELECT sr.payload
         FROM ops.staged_records sr
         WHERE sr.source_system = 'clinichq'
           AND sr.source_table = 'appointment_info'
           AND sr.payload->>'Number' = v.appointment_number
           AND sr.payload->>'Date' IS NOT NULL
           AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = v.appointment_date
         ORDER BY sr.created_at DESC
         LIMIT 1) as raw_payload
      FROM ops.v_appointment_detail v
      LEFT JOIN sot.cats c ON c.cat_id = v.cat_id
      LEFT JOIN LATERAL (
        SELECT rm.storage_path
        FROM ops.request_media rm
        WHERE rm.cat_id = v.cat_id
          AND NOT rm.is_archived
        ORDER BY COALESCE(rm.is_hero, FALSE) DESC, rm.uploaded_at DESC
        LIMIT 1
      ) cat_photo ON true
      WHERE v.appointment_id = $1`,
      [id]
    );

    if (!appointment) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    // Fetch linked procedures
    const procedures = await queryRows<ProcedureRow>(
      `SELECT
        procedure_id,
        procedure_type,
        status::TEXT,
        performed_by,
        complications,
        post_op_notes
      FROM ops.cat_procedures
      WHERE appointment_id = $1
      ORDER BY procedure_type`,
      [id]
    );

    // Parse raw payload into structured raw_details
    const rawPayload = appointment.raw_payload as Record<string, string> | null;
    let rawDetails = null;
    if (rawPayload) {
      rawDetails = {
        // Test results
        felv_fiv_snap: rawPayload["FeLV/FIV (SNAP test, in-house)"] || null,
        felv_test: rawPayload["Felv Test"] || null,
        // Body condition
        body_composition_score: rawPayload["Body Composition Score"] || null,
        overweight: rawPayload["Overweight"] || null,
        underweight: rawPayload["Underweight"] || null,
        // Age from cat_info (we'll try appointment payload too)
        weight: rawPayload["Weight"] || null,
        // Health observations
        uri: rawPayload["URI"] || rawPayload["Upper Respiratory Issue"] || null,
        dental_disease: rawPayload["Dental Disease"] || null,
        ear_issue: rawPayload["Ear Issue"] || null,
        ear_infections: rawPayload["Ear infections"] || null,
        eye_issue: rawPayload["Eye Issue"] || null,
        skin_issue: rawPayload["Skin Issue"] || null,
        mouth_issue: rawPayload["Mouth Issue"] || null,
        diarrhea: rawPayload["Diarrhea"] || rawPayload["Diarrhea_1"] || rawPayload["Diarrhea_2"] || null,
        nauseous: rawPayload["Nauseous"] || null,
        mats: rawPayload["Mats"] || null,
        // Parasites
        fleas: rawPayload["Fleas"] || rawPayload["Fleas_1"] || rawPayload["Fleas_2"] || rawPayload["Fleas/Ticks"] || null,
        ticks: rawPayload["Ticks"] || rawPayload["Ticks_1"] || rawPayload["Ticks_2"] || null,
        tapeworms: rawPayload["Tapeworms"] || rawPayload["Tapeworms_1"] || rawPayload["Tapeworms_2"] || null,
        ear_mites: rawPayload["Ear mites"] || null,
        lice: rawPayload["Lice"] || null,
        heartworm_positive: rawPayload["Heartworm Positive"] || null,
        ringworm_test: rawPayload["Wood's Lamp Ringworm Test"] || null,
        skin_scrape_test: rawPayload["Skin Scrape Test"] || null,
        // Surgery details
        no_surgery_reason: rawPayload["No Surgery Reason"] || null,
        cryptorchid: rawPayload["Cryptorchid"] || null,
        pre_scrotal: rawPayload["Pre-Scrotal Neuter"] || null,
        hernia: rawPayload["Hernia"] || null,
        pyometra: rawPayload["Pyometra"] || null,
        staples: rawPayload["Staples"] || null,
        // Post-op
        bruising_expected: rawPayload["Bruising Expected"] || null,
        swelling_expected: rawPayload["Swelling Expected"] || null,
        cold_compress: rawPayload["Cold Compress Recommended"] || null,
        warm_compress_dry: rawPayload["Warm Compress (dry) Recommended"] || null,
        warm_compress_wet: rawPayload["Warm Compress (wet) Recommended"] || null,
        clipper_abrasion: rawPayload["Clipper Abrasion (burn)"] || null,
        recheck_needed: rawPayload["Recheck Needed"] || null,
        // Vitals from raw
        bmbt_test: rawPayload["BMBT Test (Passed)"] || null,
        bradycardia: rawPayload["Bradycardia Intra-Op"] || null,
        too_young_for_rabies: rawPayload["Too young for rabies"] || null,
        polydactyl: rawPayload["Polydactyl"] || null,
        death_type: rawPayload["Death Type"] || null,
        // Financial (if useful)
        invoiced: rawPayload["Invoiced"] || null,
        total_invoiced: rawPayload["Total Invoiced"] || null,
      };
    }

    // Derive appointment category from service_type
    const serviceType = (appointment.service_type as string) || "";
    let appointmentCategory = "Other";
    if (/spay|neuter/i.test(serviceType)) appointmentCategory = "Spay/Neuter";
    else if (/examination|exam.*feral|exam fee/i.test(serviceType)) appointmentCategory = "Wellness";
    else if (/recheck/i.test(serviceType)) appointmentCategory = "Recheck";
    else if (/euthanasia/i.test(serviceType)) appointmentCategory = "Euthanasia";

    // Parse vaccines and treatments from service_type
    const vaccines: string[] = [];
    const treatments: string[] = [];
    if (/rabies.*3.*year/i.test(serviceType)) vaccines.push("Rabies (3yr)");
    if (/rabies.*1.*year/i.test(serviceType)) vaccines.push("Rabies (1yr)");
    if (/fvrcp/i.test(serviceType)) vaccines.push("FVRCP");
    if (/revolution/i.test(serviceType)) treatments.push("Revolution (flea/parasite)");
    if (/advantage/i.test(serviceType)) treatments.push("Advantage (flea)");
    if (/activyl/i.test(serviceType)) treatments.push("Activyl (flea)");
    if (/convenia/i.test(serviceType)) treatments.push("Convenia (antibiotic)");
    if (/praziquantel|droncit/i.test(serviceType)) treatments.push("Dewormer");

    return NextResponse.json({
      appointment_id: appointment.appointment_id,
      appointment_date: appointment.appointment_date,
      appointment_number: appointment.appointment_number,
      clinic_day_number: appointment.clinic_day_number,
      appointment_category: appointmentCategory,
      service_type: appointment.service_type,
      vet_name: appointment.vet_name,
      technician: appointment.technician,
      temperature: appointment.temperature,
      medical_notes: appointment.medical_notes,
      is_spay: appointment.is_spay,
      is_neuter: appointment.is_neuter,
      is_pregnant: appointment.is_pregnant,
      is_lactating: appointment.is_lactating,
      is_in_heat: appointment.is_in_heat,
      // Enriched vitals
      weight_lbs: appointment.weight_lbs,
      cat_age_years: appointment.cat_age_years,
      cat_age_months: appointment.cat_age_months,
      body_composition_score: appointment.body_composition_score,
      // Health screening
      has_uri: appointment.has_uri,
      has_dental_disease: appointment.has_dental_disease,
      has_ear_issue: appointment.has_ear_issue,
      has_eye_issue: appointment.has_eye_issue,
      has_skin_issue: appointment.has_skin_issue,
      has_mouth_issue: appointment.has_mouth_issue,
      has_fleas: appointment.has_fleas,
      has_ticks: appointment.has_ticks,
      has_tapeworms: appointment.has_tapeworms,
      has_ear_mites: appointment.has_ear_mites,
      has_ringworm: appointment.has_ringworm,
      felv_fiv_result: appointment.felv_fiv_result,
      no_surgery_reason: appointment.no_surgery_reason,
      // Enriched misc flags (MIG_899)
      has_polydactyl: appointment.has_polydactyl,
      has_bradycardia: appointment.has_bradycardia,
      has_too_young_for_rabies: appointment.has_too_young_for_rabies,
      has_cryptorchid: appointment.has_cryptorchid,
      has_hernia: appointment.has_hernia,
      has_pyometra: appointment.has_pyometra,
      // Financial
      total_invoiced: appointment.total_invoiced,
      subsidy_value: appointment.subsidy_value,
      // Client snapshot
      ownership_type: appointment.ownership_type,
      // Cat info
      cat_id: appointment.cat_id,
      cat_name: appointment.cat_name,
      cat_sex: appointment.cat_sex,
      cat_breed: appointment.cat_breed,
      cat_color: appointment.cat_color,
      cat_secondary_color: appointment.cat_secondary_color,
      cat_microchip: appointment.cat_microchip,
      cat_altered_status: appointment.cat_altered_status,
      cat_photo_url: appointment.cat_photo_url,
      // Client info
      person_id: appointment.person_id,
      client_name: appointment.client_name,
      client_email: appointment.client_email,
      client_phone: appointment.client_phone,
      client_address: appointment.client_address,
      // Parsed from service_type
      vaccines,
      treatments,
      procedures,
      raw_details: rawDetails,
    });
  } catch (error) {
    console.error("Error fetching appointment detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch appointment details" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Appointment ID required" }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Currently only clinic_day_number is editable
    if (body.clinic_day_number === undefined) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const clinicDayNumber = body.clinic_day_number;

    // Allow null (to clear) or a positive integer
    if (clinicDayNumber !== null) {
      const num = parseInt(clinicDayNumber, 10);
      if (isNaN(num) || num < 1 || num > 999) {
        return NextResponse.json(
          { error: "clinic_day_number must be between 1 and 999" },
          { status: 400 }
        );
      }
    }

    const result = await queryOne<{ appointment_id: string; clinic_day_number: number | null }>(
      `UPDATE ops.appointments
       SET clinic_day_number = $1, updated_at = NOW()
       WHERE appointment_id = $2
       RETURNING appointment_id, clinic_day_number`,
      [clinicDayNumber, id]
    );

    if (!result) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error updating appointment:", error);
    return NextResponse.json(
      { error: "Failed to update appointment" },
      { status: 500 }
    );
  }
}
