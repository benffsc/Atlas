import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface IntakeSubmission {
  // Source tracking
  source?: "web" | "phone" | "in_person" | "paper";

  // Contact Info
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  requester_address?: string;
  requester_city?: string;
  requester_zip?: string;

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
  ownership_status: "unknown_stray" | "community_colony" | "my_cat" | "neighbors_cat" | "unsure";
  cat_count_estimate?: number;
  cat_count_text?: string;
  fixed_status: "none_fixed" | "some_fixed" | "most_fixed" | "all_fixed" | "unknown";
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
  has_medical_concerns?: boolean;
  medical_description?: string;
  is_emergency?: boolean;
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
}

export async function POST(request: NextRequest) {
  try {
    const body: IntakeSubmission = await request.json();

    // Validate required fields
    if (!body.first_name || !body.last_name || !body.email) {
      return NextResponse.json(
        { error: "First name, last name, and email are required" },
        { status: 400 }
      );
    }

    if (!body.cats_address) {
      return NextResponse.json(
        { error: "Cat location address is required" },
        { status: 400 }
      );
    }

    if (!body.ownership_status || !body.fixed_status) {
      return NextResponse.json(
        { error: "Ownership status and fixed status are required" },
        { status: 400 }
      );
    }

    // Get client IP and user agent
    const ip_address = request.headers.get("x-forwarded-for")?.split(",")[0] ||
                       request.headers.get("x-real-ip") ||
                       null;
    const user_agent = request.headers.get("user-agent") || null;

    // Insert into web_intake_submissions
    // The trigger will auto-compute triage
    const { data, error } = await supabase
      .from("web_intake_submissions")
      .insert({
        // Source tracking (defaults to 'web' for online submissions)
        source: body.source || "web",
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        phone: body.phone || null,
        requester_address: body.requester_address || null,
        requester_city: body.requester_city || null,
        requester_zip: body.requester_zip || null,
        // Third-party report fields
        is_third_party_report: body.is_third_party_report ?? false,
        third_party_relationship: body.third_party_relationship || null,
        property_owner_name: body.property_owner_name || null,
        property_owner_phone: body.property_owner_phone || null,
        property_owner_email: body.property_owner_email || null,
        cats_address: body.cats_address,
        cats_city: body.cats_city || null,
        cats_zip: body.cats_zip || null,
        county: body.county || null,
        ownership_status: body.ownership_status,
        cat_count_estimate: body.cat_count_estimate || null,
        cat_count_text: body.cat_count_text || null,
        fixed_status: body.fixed_status,
        has_kittens: body.has_kittens ?? null,
        kitten_count: body.kitten_count || null,
        kitten_age_estimate: body.kitten_age_estimate || null,
        kitten_mixed_ages_description: body.kitten_mixed_ages_description || null,
        kitten_behavior: body.kitten_behavior || null,
        kitten_contained: body.kitten_contained || null,
        mom_present: body.mom_present || null,
        mom_fixed: body.mom_fixed || null,
        can_bring_in: body.can_bring_in || null,
        kitten_notes: body.kitten_notes || null,
        awareness_duration: body.awareness_duration || null,
        has_medical_concerns: body.has_medical_concerns ?? null,
        medical_description: body.medical_description || null,
        is_emergency: body.is_emergency ?? false,
        cats_being_fed: body.cats_being_fed ?? null,
        feeder_info: body.feeder_info || null,
        has_property_access: body.has_property_access ?? null,
        access_notes: body.access_notes || null,
        is_property_owner: body.is_property_owner ?? null,
        situation_description: body.situation_description || null,
        referral_source: body.referral_source || null,
        media_urls: body.media_urls || null,
        ip_address,
        user_agent,
        // Staff assessment fields (for paper/phone intake)
        priority_override: body.priority_override || null,
        kitten_outcome: body.kitten_outcome || null,
        foster_readiness: body.foster_readiness || null,
        kitten_urgency_factors: body.kitten_urgency_factors || null,
        reviewed_by: body.reviewed_by || null,
        // If staff is entering, mark as reviewed
        ...(body.source !== "web" && body.reviewed_by ? {
          status: "reviewed",
          reviewed_at: new Date().toISOString(),
        } : {}),
      })
      .select("submission_id, triage_category, triage_score")
      .single();

    if (error) {
      console.error("Error creating intake submission:", error);
      return NextResponse.json(
        { error: "Failed to submit request" },
        { status: 500 }
      );
    }

    // Try to match to existing person (async, don't wait)
    Promise.resolve(supabase.rpc("match_intake_to_person", { p_submission_id: data.submission_id }))
      .then(() => {})
      .catch((err: unknown) => console.error("Person matching error:", err));

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
    return NextResponse.json(
      { error: "Invalid request" },
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

  let query = supabase
    .from("web_intake_submissions")
    .select("submission_id, submitted_at, status, triage_category, cats_address, cats_city");

  if (submission_id) {
    query = query.eq("submission_id", submission_id);
  } else if (email) {
    query = query.eq("email", email.toLowerCase()).order("submitted_at", { ascending: false }).limit(5);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching submission:", error);
    return NextResponse.json(
      { error: "Failed to fetch submission" },
      { status: 500 }
    );
  }

  return NextResponse.json({ submissions: data });
}
