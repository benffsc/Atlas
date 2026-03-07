import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { geocodeAddress, buildAddressString } from "@/lib/geocoding";

interface IntakeSubmission {
  // Source tracking
  source?: "web" | "phone" | "in_person" | "paper";
  source_system?: string;  // For tracking intake type (e.g., "web_intake_receptionist")
  source_raw_id?: string;  // External system ID (e.g., Jotform Submission ID) for deduplication

  // Contact Info
  first_name: string;
  last_name: string;
  email?: string;  // Email OR phone required
  phone?: string;
  requester_address?: string;
  requester_city?: string;
  requester_zip?: string;

  // Person/Address linking (new in MIG_538)
  existing_person_id?: string;        // Selected person (skip matching)
  selected_address_place_id?: string; // Using known address for cats
  cats_at_requester_address?: boolean; // True if cats are at requester home

  // Third-party report
  is_third_party_report?: boolean;
  third_party_relationship?: string;
  property_owner_name?: string;
  property_owner_phone?: string;
  property_owner_email?: string;

  // FFS-298: Requester relationship to location (non-third-party)
  requester_relationship?: string;

  // Cat Location
  cats_address: string;
  cats_city?: string;
  cats_zip?: string;
  county?: string;

  // Triage Questions
  ownership_status?: "unknown_stray" | "community_colony" | "newcomer" | "my_cat" | "neighbors_cat" | "unsure";
  cat_count_estimate?: number;
  cat_count_text?: string;
  count_confidence?: "exact" | "good_estimate" | "rough_guess" | "unknown";  // MIG_534: Is count exact or estimate?
  colony_duration?: "under_1_month" | "1_to_6_months" | "6_to_24_months" | "over_2_years" | "unknown";  // How long cats at location
  cats_needing_tnr?: number;  // Cats still needing spay/neuter (distinct from total count)
  peak_count?: number;
  eartip_count_observed?: number;
  fixed_status?: "none_fixed" | "some_fixed" | "most_fixed" | "all_fixed" | "unknown" | "yes_eartip" | "no";
  observation_time_of_day?: string;
  is_at_feeding_station?: boolean;
  reporter_confidence?: string;

  // Handleability - determines carrier vs trap
  handleability?: "friendly_carrier" | "shy_handleable" | "unhandleable_trap" | "unknown" | "some_friendly" | "all_unhandleable";

  // Kittens
  has_kittens?: boolean;
  kitten_count?: number;
  kitten_age_estimate?: string;
  kitten_mixed_ages_description?: string;
  kitten_behavior?: string;
  kitten_contained?: string;
  mom_present?: string;
  mom_fixed?: string;
  can_bring_in?: string;
  kitten_notes?: string;
  awareness_duration?: "under_1_week" | "under_1_month" | "1_to_6_months" | "6_to_12_months" | "over_1_year" | "unknown";

  // Feeding behavior
  feeds_cat?: boolean;
  feeding_frequency?: "daily" | "few_times_week" | "occasionally" | "rarely";
  feeding_duration?: "just_started" | "few_weeks" | "few_months" | "over_year";
  cat_comes_inside?: "yes_regularly" | "sometimes" | "never";

  // MIG_2532: Call sheet feeding logistics
  feeding_location?: string;  // Where cats are fed (call sheet: "Where Do Cats Eat?")
  feeding_time?: string;      // What time cats are fed (call sheet: "What Time?")
  has_medical_concerns?: boolean;
  medical_description?: string;
  is_emergency?: boolean;
  emergency_acknowledged?: boolean;
  cats_being_fed?: boolean;
  feeder_info?: string;
  has_property_access?: boolean;
  access_notes?: string;
  is_property_owner?: boolean;
  situation_description?: string;
  call_type?: string;
  cat_name?: string;
  cat_description?: string;
  feeding_situation?: string;
  referral_source?: string;
  media_urls?: string[];

  // MIG_2532: Trapping characteristics (from call sheet)
  dogs_on_site?: string;      // yes, no
  trap_savvy?: string;        // yes, no, unknown
  previous_tnr?: string;      // yes, no, partial
  best_trapping_time?: string; // Free text: best day/time for trapping
  important_notes?: string[]; // Array of flags: withhold_food, other_feeders, etc.

  // Staff assessment fields (for paper/phone intake entry)
  priority_override?: "high" | "normal" | "low";
  kitten_outcome?: "foster_intake" | "tnr_candidate" | "pending_space" | "declined";
  foster_readiness?: "high" | "medium" | "low";
  kitten_urgency_factors?: string[];
  reviewed_by?: string;

  // Custom fields (from admin-configured questions)
  custom_fields?: Record<string, string | boolean>;

  // Test mode - for demos and training
  is_test?: boolean;

  // FFS-150: Direct request creation from call sheet
  create_request_directly?: boolean;
  close_request?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: IntakeSubmission = await request.json();

    // Validate required fields
    if (!body.first_name || !body.last_name) {
      return apiBadRequest("First name and last name are required");
    }

    // Require email OR phone
    if (!body.email && !body.phone) {
      return apiBadRequest("Email or phone is required");
    }

    if (!body.cats_address) {
      return apiBadRequest("Cat location address is required");
    }

    // Check for duplicate by source_raw_id first (Jotform Submission ID - most reliable)
    if (body.source_raw_id) {
      const existingBySourceId = await queryOne<{ submission_id: string }>(
        `SELECT submission_id FROM ops.intake_submissions WHERE source_raw_id = $1 LIMIT 1`,
        [body.source_raw_id]
      );

      if (existingBySourceId) {
        console.error(`[INTAKE] Duplicate blocked by source_raw_id: ${body.source_raw_id}, existing: ${existingBySourceId.submission_id}`);
        return apiSuccess({
          submission_id: existingBySourceId.submission_id,
          message: "Your request was already received. Thank you!",
          duplicate: true
        });
      }
    }

    // Check for duplicate submission (same email/phone + first_name + cats_address within 5 minutes)
    // This prevents Jotform/Airtable webhook retries from creating duplicates
    const duplicateCheck = body.email
      ? await queryOne<{ submission_id: string; submitted_at: string }>(
          `SELECT submission_id, submitted_at::TEXT
           FROM ops.intake_submissions
           WHERE LOWER(email) = LOWER($1)
             AND LOWER(first_name) = LOWER($2)
             AND LOWER(TRIM(cats_address)) = LOWER(TRIM($3))
             AND submitted_at > NOW() - INTERVAL '5 minutes'
           LIMIT 1`,
          [body.email, body.first_name, body.cats_address]
        )
      : body.phone
        ? await queryOne<{ submission_id: string; submitted_at: string }>(
            `SELECT submission_id, submitted_at::TEXT
             FROM ops.intake_submissions
             WHERE REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = REGEXP_REPLACE($1, '[^0-9]', '', 'g')
               AND LOWER(first_name) = LOWER($2)
               AND LOWER(TRIM(cats_address)) = LOWER(TRIM($3))
               AND submitted_at > NOW() - INTERVAL '5 minutes'
             LIMIT 1`,
            [body.phone, body.first_name, body.cats_address]
          )
        : null;

    if (duplicateCheck) {
      console.error(`[INTAKE] Duplicate submission blocked: ${body.email || body.phone} at ${body.cats_address}, existing: ${duplicateCheck.submission_id}`);
      return apiSuccess({
        submission_id: duplicateCheck.submission_id,
        message: "Your request was already received. Thank you!",
        duplicate: true
      });
    }

    // Get client IP and user agent
    const ip_address = request.headers.get("x-forwarded-for")?.split(",")[0] ||
                       request.headers.get("x-real-ip") ||
                       null;
    const user_agent = request.headers.get("user-agent") || null;

    // Determine if staff is entering (for status override)
    const isStaffEntry = body.source !== "web" && body.reviewed_by;

    // Insert into web_intake_submissions using direct SQL
    // The trigger will auto-compute triage
    // MIG_2531: Added structured columns (cat_name, cat_description, count_confidence, colony_duration)
    // MIG_2532: Added call sheet fields (feeding_location, feeding_time, dogs_on_site, etc.)
    const data = await queryOne<{ submission_id: string; triage_category: string; triage_score: number }>(
      `INSERT INTO ops.intake_submissions (
        intake_source, source_system, source_raw_id, first_name, last_name, email, phone,
        requester_address, requester_city, requester_zip,
        matched_person_id, selected_address_place_id, cats_at_requester_address,
        is_third_party_report, third_party_relationship,
        property_owner_name, property_owner_phone, property_owner_email,
        cats_address, cats_city, cats_zip, county,
        ownership_status, cat_count_estimate, cat_count_text, cats_needing_tnr, peak_count,
        count_confidence, colony_duration,
        eartip_count_observed, fixed_status, handleability,
        observation_time_of_day, is_at_feeding_station, reporter_confidence,
        has_kittens, kitten_count, kitten_age_estimate, kitten_mixed_ages_description,
        kitten_behavior, kitten_contained, mom_present, mom_fixed, can_bring_in, kitten_notes,
        awareness_duration, feeds_cat, feeding_frequency, feeding_duration, cat_comes_inside,
        feeding_location, feeding_time,
        has_medical_concerns, medical_description, is_emergency, emergency_acknowledged,
        cats_being_fed, feeder_info, has_property_access, access_notes, is_property_owner,
        situation_description, referral_source, media_urls, ip_address, user_agent,
        dogs_on_site, trap_savvy, previous_tnr, best_trapping_time, important_notes,
        priority_override, kitten_outcome, foster_readiness, kitten_urgency_factors,
        reviewed_by, custom_fields, is_test, status, reviewed_at, submission_status,
        call_type, cat_name, cat_description, feeding_situation,
        requester_relationship
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
        $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51,
        $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62, $63, $64, $65, $66, $67,
        $68, $69, $70, $71, $72, $73, $74, $75, $76, $77, $78, $79, $80, $81,
        $82, $83, $84, $85, $86
      )
      RETURNING submission_id, triage_category::TEXT, triage_score`,
      [
        body.source || "web", // $1 - Maps to intake_source enum: web, phone, in_person, paper, legacy_airtable, jotform
        body.source_system || null, // $2 - More specific source tracking
        body.source_raw_id || null, // $3 - External system ID
        body.first_name, // $4
        body.last_name, // $5
        body.email || null, // $6
        body.phone || null, // $7
        body.requester_address || null, // $8
        body.requester_city || null, // $9
        body.requester_zip || null, // $10
        body.existing_person_id || null, // $11 - matched_person_id when pre-selected
        body.selected_address_place_id || null, // $12 - place_id when using known address
        body.cats_at_requester_address ?? true, // $13 - defaults to true
        body.is_third_party_report ?? false, // $14
        body.third_party_relationship || null, // $15
        body.property_owner_name || null, // $16
        body.property_owner_phone || null, // $17
        body.property_owner_email || null, // $18
        body.cats_address, // $19
        body.cats_city || null, // $20
        body.cats_zip || null, // $21
        body.county || null, // $22
        body.ownership_status || "unknown_stray", // $23
        body.cat_count_estimate ?? null, // $24
        body.cat_count_text || null, // $25
        body.cats_needing_tnr ?? null, // $26
        body.peak_count ?? null, // $27
        body.count_confidence || null, // $28 - MIG_2531: structured column
        body.colony_duration || null, // $29 - MIG_2531: structured column
        body.eartip_count_observed ?? null, // $30
        body.fixed_status || "unknown", // $31
        body.handleability || null, // $32
        body.observation_time_of_day || null, // $33
        body.is_at_feeding_station ?? null, // $34
        body.reporter_confidence || null, // $35
        body.has_kittens ?? null, // $36
        body.kitten_count ?? null, // $37
        body.kitten_age_estimate || null, // $38
        body.kitten_mixed_ages_description || null, // $39
        body.kitten_behavior || null, // $40
        body.kitten_contained || null, // $41
        body.mom_present || null, // $42
        body.mom_fixed || null, // $43
        body.can_bring_in || null, // $44
        body.kitten_notes || null, // $45
        body.awareness_duration || null, // $46
        body.feeds_cat ?? null, // $47
        body.feeding_frequency || null, // $48
        body.feeding_duration || null, // $49
        body.cat_comes_inside || null, // $50
        body.feeding_location || null, // $51 - MIG_2532: call sheet field
        body.feeding_time || null, // $52 - MIG_2532: call sheet field
        body.has_medical_concerns ?? null, // $53
        body.medical_description || null, // $54
        body.is_emergency ?? false, // $55
        body.emergency_acknowledged ?? false, // $56
        body.cats_being_fed ?? null, // $57
        body.feeder_info || null, // $58
        body.has_property_access ?? null, // $59
        body.access_notes || null, // $60
        body.is_property_owner ?? null, // $61
        body.situation_description || null, // $62
        body.referral_source || null, // $63
        body.media_urls || null, // $64
        ip_address, // $65
        user_agent, // $66
        body.dogs_on_site || null, // $67 - MIG_2532: call sheet field
        body.trap_savvy || null, // $68 - MIG_2532: call sheet field
        body.previous_tnr || null, // $69 - MIG_2532: call sheet field
        body.best_trapping_time || null, // $70 - MIG_2532: call sheet field
        body.important_notes || null, // $71 - MIG_2532: call sheet field (array)
        body.priority_override || null, // $72
        body.kitten_outcome || null, // $73
        body.foster_readiness || null, // $74
        body.kitten_urgency_factors || null, // $75
        body.reviewed_by || null, // $76
        // MIG_2531: count_confidence and colony_duration now have proper columns (above)
        // Keep custom_fields for any additional dynamic fields
        body.custom_fields ? JSON.stringify(body.custom_fields) : null, // $77
        body.is_test || false, // $78
        isStaffEntry ? "reviewed" : "new", // $79 - Legacy status field
        isStaffEntry ? new Date().toISOString() : null, // $80
        isStaffEntry ? "in_progress" : "new", // $81 - New unified submission_status
        body.call_type || null, // $82 - MIG_2849: structured call type
        body.cat_name || null, // $83 - MIG_2531: structured cat name
        body.cat_description || null, // $84 - MIG_2531: structured cat description
        body.feeding_situation || null, // $85 - MIG_2531: structured feeding situation
        body.requester_relationship || "resident", // $86 - FFS-298: requester relationship to location
      ]
    );

    if (!data) {
      console.error("Error creating intake submission: no data returned");
      return apiServerError("Failed to submit request");
    }

    // Try to match to existing person (async, don't wait)
    queryOne("SELECT sot.match_intake_to_person($1)", [data.submission_id])
      .catch((err: unknown) => console.error("Person matching error:", err));

    // Link to place — await to ensure place gets created before geocoding
    // Skip if staff already selected an address (selected_address_place_id handles it)
    if (!body.selected_address_place_id && body.cats_address) {
      try {
        await queryOne("SELECT sot.link_intake_to_place($1)", [data.submission_id]);
      } catch (err: unknown) {
        console.error("Place linking error:", err);
        // Non-fatal: submission was already saved, place linking can be retried
      }
    }

    // FFS-128: Inline geocoding — geocode the address immediately so map shows pin
    // Don't block submission on geocoding failure; cron will retry later
    if (body.cats_address && !body.selected_address_place_id) {
      try {
        const addressStr = buildAddressString(body.cats_address, body.cats_city, body.cats_zip);
        const geoResult = await geocodeAddress(addressStr);
        if (geoResult?.success) {
          // Update the submission with geocoded coordinates
          await queryOne(
            `UPDATE ops.intake_submissions
             SET geo_latitude = $1, geo_longitude = $2, geo_formatted_address = $3,
                 geo_confidence = 1.0, updated_at = NOW()
             WHERE submission_id = $4`,
            [geoResult.lat, geoResult.lng, geoResult.formatted_address, data.submission_id]
          );
          // Also update the linked place if one was created
          await queryOne(
            `UPDATE sot.places
             SET location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                 formatted_address = COALESCE(formatted_address, $3),
                 updated_at = NOW()
             WHERE place_id = (
               SELECT place_id FROM ops.intake_submissions WHERE submission_id = $4
             )
             AND location IS NULL`,
            [geoResult.lat, geoResult.lng, geoResult.formatted_address, data.submission_id]
          );
        }
      } catch (geoErr: unknown) {
        console.error("Inline geocoding error (non-fatal):", geoErr);
      }
    }

    // FFS-150: Direct request creation from call sheet
    let request_id: string | null = null;
    if (body.create_request_directly) {
      try {
        const convertResult = await queryOne<{ request_id: string }>(
          `SELECT ops.convert_intake_to_request($1, $2) as request_id`,
          [data.submission_id, body.reviewed_by || "call_sheet"]
        );

        if (convertResult?.request_id) {
          request_id = convertResult.request_id;

          // Forward call sheet fields to the created request
          const setClauses: string[] = [];
          const values: unknown[] = [];
          let idx = 1;

          if (body.priority_override) {
            setClauses.push(`priority = $${idx}`);
            values.push(body.priority_override);
            idx++;
          }

          // Forward trapping-specific fields from custom_fields
          if (body.custom_fields) {
            const cf = body.custom_fields;
            if (cf.property_type) { setClauses.push(`property_type = $${idx}`); values.push(cf.property_type); idx++; }
            if (cf.dogs_on_site) { setClauses.push(`dogs_on_site = $${idx}`); values.push(cf.dogs_on_site); idx++; }
            if (cf.trap_savvy) { setClauses.push(`trap_savvy = $${idx}`); values.push(cf.trap_savvy); idx++; }
            if (cf.previous_tnr) { setClauses.push(`previous_tnr = $${idx}`); values.push(cf.previous_tnr); idx++; }
            if (cf.feeding_time) { setClauses.push(`feeding_time = $${idx}`); values.push(cf.feeding_time); idx++; }
            if (cf.feeding_location) { setClauses.push(`feeding_location = $${idx}`); values.push(cf.feeding_location); idx++; }
            if (cf.best_trapping_time) { setClauses.push(`best_trapping_time = $${idx}`); values.push(cf.best_trapping_time); idx++; }
            if (cf.important_notes && Array.isArray(cf.important_notes)) {
              setClauses.push(`important_notes = $${idx}::text[]`);
              values.push(cf.important_notes);
              idx++;
            }
            if (cf.urgency_reasons && Array.isArray(cf.urgency_reasons)) {
              setClauses.push(`urgency_reasons = $${idx}::text[]`);
              values.push(cf.urgency_reasons);
              idx++;
            }
          }

          // Close request if requested
          if (body.close_request) {
            setClauses.push(`status = $${idx}`);
            values.push("completed");
            idx++;
            setClauses.push(`resolved_at = NOW()`);
          }

          if (setClauses.length > 0) {
            values.push(request_id);
            await queryOne(
              `UPDATE ops.requests SET ${setClauses.join(", ")} WHERE request_id = $${idx}`,
              values
            );
          }
        }
      } catch (convertErr) {
        console.error("[INTAKE] Direct request creation failed (submission still saved):", convertErr);
      }
    }

    // Return success with submission ID and triage info
    return apiSuccess({
      submission_id: data.submission_id,
      triage_category: data.triage_category,
      triage_score: data.triage_score,
      message: getTriageMessage(data.triage_category),
      ...(request_id ? { request_id } : {}),
    });
  } catch (err) {
    console.error("Intake submission error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return apiBadRequest(`Submission failed: ${errorMessage}`);
  }
}

function getTriageMessage(category: string): string {
  switch (category) {
    case "high_priority_tnr":
      return "Thank you! Your request has been marked as high priority. We'll contact you within 1-2 business days.";
    case "standard_tnr":
      return "Thank you for your request! We'll review it and contact you within 3-5 business days.";
    case "wellness_only":
      return "Thank you! It looks like the cats at your location are already fixed. We'll contact you about wellness services.";
    case "owned_cat_low":
      return "Thank you for reaching out. For owned cats, we recommend contacting your local veterinarian or a low-cost spay/neuter clinic. If you have questions, we'll follow up.";
    case "out_of_county":
      return "Thank you for your request. Unfortunately, our services are limited to Sonoma County. We'll send you resources for your area.";
    case "needs_review":
    default:
      return "Thank you! Your request has been received and will be reviewed by our team.";
  }
}

// GET endpoint to check submission status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const submission_id = searchParams.get("id");
  const email = searchParams.get("email");

  if (!submission_id && !email) {
    return apiBadRequest("Submission ID or email required");
  }

  try {
    let submissions;
    if (submission_id) {
      submissions = await queryRows(
        `SELECT submission_id, submitted_at, status, triage_category::TEXT, cats_address, cats_city
         FROM ops.intake_submissions
         WHERE submission_id = $1`,
        [submission_id]
      );
    } else if (email) {
      submissions = await queryRows(
        `SELECT submission_id, submitted_at, status, triage_category::TEXT, cats_address, cats_city
         FROM ops.intake_submissions
         WHERE LOWER(email) = LOWER($1)
         ORDER BY submitted_at DESC
         LIMIT 5`,
        [email]
      );
    }

    return apiSuccess({ submissions });
  } catch (error) {
    console.error("Error fetching submission:", error);
    return apiServerError("Failed to fetch submission");
  }
}
