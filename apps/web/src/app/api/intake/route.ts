import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

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
  referral_source?: string;
  media_urls?: string[];

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
}

export async function POST(request: NextRequest) {
  try {
    const body: IntakeSubmission = await request.json();

    // Validate required fields
    if (!body.first_name || !body.last_name) {
      return NextResponse.json(
        { error: "First name and last name are required" },
        { status: 400 }
      );
    }

    // Require email OR phone
    if (!body.email && !body.phone) {
      return NextResponse.json(
        { error: "Email or phone is required" },
        { status: 400 }
      );
    }

    if (!body.cats_address) {
      return NextResponse.json(
        { error: "Cat location address is required" },
        { status: 400 }
      );
    }

    // Check for duplicate by source_raw_id first (Jotform Submission ID - most reliable)
    if (body.source_raw_id) {
      const existingBySourceId = await queryOne<{ submission_id: string }>(
        `SELECT submission_id FROM ops.intake_submissions WHERE source_raw_id = $1 LIMIT 1`,
        [body.source_raw_id]
      );

      if (existingBySourceId) {
        console.log(`Duplicate blocked by source_raw_id: ${body.source_raw_id}, existing: ${existingBySourceId.submission_id}`);
        return NextResponse.json({
          success: true,
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
      console.log(`Duplicate submission blocked: ${body.email || body.phone} at ${body.cats_address}, existing: ${duplicateCheck.submission_id}`);
      return NextResponse.json({
        success: true,
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
    const data = await queryOne<{ submission_id: string; triage_category: string; triage_score: number }>(
      `INSERT INTO ops.intake_submissions (
        intake_source, source_system, source_raw_id, first_name, last_name, email, phone,
        requester_address, requester_city, requester_zip,
        matched_person_id, selected_address_place_id, cats_at_requester_address,
        is_third_party_report, third_party_relationship,
        property_owner_name, property_owner_phone, property_owner_email,
        cats_address, cats_city, cats_zip, county,
        ownership_status, cat_count_estimate, cat_count_text, cats_needing_tnr, peak_count,
        eartip_count_observed, fixed_status, handleability,
        observation_time_of_day, is_at_feeding_station, reporter_confidence,
        has_kittens, kitten_count, kitten_age_estimate, kitten_mixed_ages_description,
        kitten_behavior, kitten_contained, mom_present, mom_fixed, can_bring_in, kitten_notes,
        awareness_duration, feeds_cat, feeding_frequency, feeding_duration, cat_comes_inside,
        has_medical_concerns, medical_description, is_emergency, emergency_acknowledged,
        cats_being_fed, feeder_info, has_property_access, access_notes, is_property_owner,
        situation_description, referral_source, media_urls, ip_address, user_agent,
        priority_override, kitten_outcome, foster_readiness, kitten_urgency_factors,
        reviewed_by, custom_fields, is_test, status, reviewed_at, submission_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
        $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51,
        $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62, $63, $64, $65, $66, $67,
        $68, $69, $70, $71, $72
      )
      RETURNING submission_id, triage_category::TEXT, triage_score`,
      [
        body.source || "web", // Maps to intake_source enum: web, phone, in_person, paper, legacy_airtable, jotform
        body.source_system || null, // More specific source tracking (web_intake_receptionist, jotform_public, etc.)
        body.source_raw_id || null, // External system ID (e.g., Jotform Submission ID)
        body.first_name,
        body.last_name,
        body.email || null,
        body.phone || null,
        body.requester_address || null,
        body.requester_city || null,
        body.requester_zip || null,
        body.existing_person_id || null, // $10 - matched_person_id when pre-selected
        body.selected_address_place_id || null, // $11 - place_id when using known address
        body.cats_at_requester_address ?? true, // $12 - defaults to true
        body.is_third_party_report ?? false,
        body.third_party_relationship || null,
        body.property_owner_name || null,
        body.property_owner_phone || null,
        body.property_owner_email || null,
        body.cats_address,
        body.cats_city || null,
        body.cats_zip || null,
        body.county || null,
        body.ownership_status || "unknown_stray",
        body.cat_count_estimate || null,
        body.cat_count_text || null,
        body.cats_needing_tnr || null,
        body.peak_count || null,
        body.eartip_count_observed || null,
        body.fixed_status || "unknown",
        body.handleability || null,
        body.observation_time_of_day || null,
        body.is_at_feeding_station ?? null,
        body.reporter_confidence || null,
        body.has_kittens ?? null,
        body.kitten_count || null,
        body.kitten_age_estimate || null,
        body.kitten_mixed_ages_description || null,
        body.kitten_behavior || null,
        body.kitten_contained || null,
        body.mom_present || null,
        body.mom_fixed || null,
        body.can_bring_in || null,
        body.kitten_notes || null,
        body.awareness_duration || null,
        body.feeds_cat ?? null,
        body.feeding_frequency || null,
        body.feeding_duration || null,
        body.cat_comes_inside || null,
        body.has_medical_concerns ?? null,
        body.medical_description || null,
        body.is_emergency ?? false,
        body.emergency_acknowledged ?? false,
        body.cats_being_fed ?? null,
        body.feeder_info || null,
        body.has_property_access ?? null,
        body.access_notes || null,
        body.is_property_owner ?? null,
        body.situation_description || null,
        body.referral_source || null,
        body.media_urls || null,
        ip_address,
        user_agent,
        body.priority_override || null,
        body.kitten_outcome || null,
        body.foster_readiness || null,
        body.kitten_urgency_factors || null,
        body.reviewed_by || null,
        // Merge count_confidence and colony_duration into custom_fields (MIG_622 classification support)
        JSON.stringify({
          ...(body.custom_fields || {}),
          ...(body.count_confidence ? { count_confidence: body.count_confidence } : {}),
          ...(body.colony_duration ? { colony_duration: body.colony_duration } : {}),
        }),
        body.is_test || false,
        isStaffEntry ? "reviewed" : "new", // Legacy status field
        isStaffEntry ? new Date().toISOString() : null,
        isStaffEntry ? "in_progress" : "new", // New unified submission_status (MIG_254)
      ]
    );

    if (!data) {
      console.error("Error creating intake submission: no data returned");
      return NextResponse.json(
        { error: "Failed to submit request" },
        { status: 500 }
      );
    }

    // Try to match to existing person (async, don't wait)
    queryOne("SELECT sot.match_intake_to_person($1)", [data.submission_id])
      .catch((err: unknown) => console.error("Person matching error:", err));

    // Link to place and queue for geocoding — await to ensure place gets created
    try {
      await queryOne("SELECT sot.link_intake_to_place($1)", [data.submission_id]);
    } catch (err: unknown) {
      console.error("Place linking error:", err);
      // Non-fatal: submission was already saved, place linking can be retried
    }

    // Return success with submission ID and triage info
    return NextResponse.json({
      success: true,
      submission_id: data.submission_id,
      triage_category: data.triage_category,
      triage_score: data.triage_score,
      message: getTriageMessage(data.triage_category),
    });
  } catch (err) {
    console.error("Intake submission error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Submission failed: ${errorMessage}` },
      { status: 400 }
    );
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
    return NextResponse.json(
      { error: "Submission ID or email required" },
      { status: 400 }
    );
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

    return NextResponse.json({ submissions });
  } catch (error) {
    console.error("Error fetching submission:", error);
    return NextResponse.json(
      { error: "Failed to fetch submission" },
      { status: 500 }
    );
  }
}
