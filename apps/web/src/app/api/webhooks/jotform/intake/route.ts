import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import {
  apiSuccess,
  apiUnauthorized,
  apiServerError,
  apiBadRequest,
} from "@/lib/api-response";

/**
 * Jotform Intake Form Webhook
 *
 * Receives FFSC assistance request submissions from Jotform and inserts
 * them into the Atlas intake queue (ops.intake_submissions).
 *
 * Jotform form ID: 260855308349060 (clone with pet spay/neuter redirect)
 * Original form:   260143732665153
 *
 * Jotform sends field data as a flat object. Field names are the "name"
 * property set on each Jotform question. The mapping below converts
 * Jotform field names → Atlas intake_submissions columns.
 *
 * Auth: Bearer token via WEBHOOK_SECRET env var.
 */

export const maxDuration = 30;

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Jotform call type labels → Atlas call_type values
const CALL_TYPE_MAP: Record<string, string> = {
  "Pet Spay/Neuter - My cat needs to be fixed": "pet_spay_neuter",
  "Single Stray - One unfamiliar cat showed up": "single_stray",
  "Colony/FFR - Multiple outdoor cats need help": "colony_tnr",
  "Kitten Situation - Found kittens, need help": "kitten_rescue",
  "Kitten Situation - Found kittens": "kitten_rescue",
  "Medical Concern - Cat appears injured or sick": "medical_concern",
  "Wellness Check - Already fixed cat needs medical care": "wellness_check",
};

// Jotform handleability labels → Atlas handleability values
const HANDLEABILITY_MAP: Record<string, string> = {
  "Friendly - can use a carrier": "friendly_carrier",
  "Shy but handleable": "shy_handleable",
  "Feral - will need a trap": "unhandleable_trap",
  "Some are friendly, some feral": "some_friendly",
  "All are feral (need traps)": "all_unhandleable",
  "Unknown / Haven't tried": "unknown",
};

// Jotform fixed status → Atlas fixed_status values
const FIXED_STATUS_MAP: Record<string, string> = {
  "All are fixed": "all_fixed",
  "Some are fixed": "some_fixed",
  "None are fixed": "none_fixed",
  "Unknown": "unknown",
};

// Jotform feeding → Atlas feeding values
const FEEDING_MAP: Record<string, string> = {
  "I feed them daily": "daily",
  "I feed them sometimes": "occasionally",
  "Someone else feeds them": "someone_else",
  "No regular feeding": "no_feeding",
  "Unknown": "unknown",
};

// Call type → ownership_status
const OWNERSHIP_MAP: Record<string, string> = {
  pet_spay_neuter: "my_cat",
  wellness_check: "my_cat",
  colony_tnr: "community_colony",
  single_stray: "unknown_stray",
  kitten_rescue: "unknown_stray",
  medical_concern: "unknown_stray",
};

interface JotformPayload {
  // Metadata
  formID?: string;
  submissionID?: string;
  // Page 1: Call type
  callType?: string;
  petSpayChoice?: string;
  // Page 2: Contact
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | Record<string, string>;
  isThirdParty?: string;
  thirdPartyRelationship?: string;
  propertyOwnerName?: string;
  propertyOwnerPhone?: string | Record<string, string>;
  propertyOwnerEmail?: string;
  // Address (Jotform autocomplete widget returns nested object)
  typeA58?: string | Record<string, string>;
  typeA?: string | Record<string, string>;
  sameAsRequester?: string | string[];
  county?: string;
  // Cat details
  catName?: string;
  catCount?: string;
  catDescription?: string;
  handleability?: string;
  fixedStatus?: string;
  peakCount?: string;
  eartipCount?: string;
  feedingSituation?: string;
  // Kittens
  hasKittens?: string;
  kittenCount?: string;
  kittenAge?: string;
  kittenSocialization?: string;
  momPresent?: string;
  // Medical
  hasMedicalConcerns?: string;
  medicalDescription?: string;
  isEmergency?: string;
  emergencyAcknowledged?: string;
  // Property
  isPropertyOwner?: string;
  hasPropertyAccess?: string;
  // Final
  notes?: string;
  referralSource?: string;
  [key: string]: unknown;
}

/** Extract phone number from Jotform phone field (can be string or {full, area, phone}) */
function extractPhone(field: string | Record<string, string> | undefined): string | null {
  if (!field) return null;
  if (typeof field === "string") return field.trim() || null;
  // Jotform phone widget returns { full: "(707) 555-1234", area: "707", phone: "5551234" }
  return field.full?.trim() || field.phone?.trim() || null;
}

/** Extract address from Jotform autocomplete widget (can be string or nested object) */
function extractAddress(field: string | Record<string, string> | undefined): {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  if (!field) return { street: null, city: null, state: null, zip: null };
  if (typeof field === "string") {
    // Sometimes comes as "Street name: X\nHouse number: Y\nCity: Z\n..."
    const parts: Record<string, string> = {};
    field.split("\n").forEach((line) => {
      const [key, ...val] = line.split(":");
      if (key && val.length) parts[key.trim().toLowerCase()] = val.join(":").trim();
    });
    const houseNumber = parts["house number"] || "";
    const streetName = parts["street name"] || "";
    const street = [houseNumber, streetName].filter(Boolean).join(" ") || null;
    return {
      street,
      city: parts["city"] || null,
      state: parts["state"] || null,
      zip: parts["postal code"] || null,
    };
  }
  // Nested object from Jotform widget
  const houseNumber = field["House number"] || field.streetNumber || "";
  const streetName = field["Street name"] || field.route || "";
  const street = [houseNumber, streetName].filter(Boolean).join(" ") || null;
  return {
    street,
    city: field.City || field.locality || null,
    state: field.State || field.administrativeAreaLevel1 || null,
    zip: field["Postal code"] || field.postalCode || null,
  };
}

export async function POST(request: NextRequest) {
  // Verify auth
  const authHeader = request.headers.get("authorization");
  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return apiUnauthorized("Invalid or missing authorization");
  }

  let payload: JotformPayload;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const formData = await request.formData();
      payload = Object.fromEntries(formData.entries()) as unknown as JotformPayload;
    }
  } catch {
    return apiBadRequest("Could not parse request body");
  }

  // Map fields
  const firstName = payload.firstName?.trim() || null;
  const lastName = payload.lastName?.trim() || null;
  const email = payload.email?.trim()?.toLowerCase() || null;
  const phone = extractPhone(payload.phone);
  const submissionID = payload.submissionID || null;

  if (!firstName || !lastName) {
    return apiBadRequest("Missing required fields: firstName and lastName");
  }
  if (!email && !phone) {
    return apiBadRequest("Email or phone is required");
  }

  // Call type mapping
  const callTypeLabel = payload.callType?.trim() || "";
  const callType = CALL_TYPE_MAP[callTypeLabel] || "info_only";
  const ownershipStatus = OWNERSHIP_MAP[callType] || "unknown_stray";

  // Pet spay choice tracking
  const petSpayChoice = payload.petSpayChoice?.trim() || null;
  const isPetSpayRedirect = callType === "pet_spay_neuter" && petSpayChoice?.includes("Sonoma Humane");

  // Address extraction
  const requesterAddr = extractAddress(payload.typeA58);
  const catAddr = extractAddress(payload.typeA);
  const sameAsRequester = Array.isArray(payload.sameAsRequester)
    ? payload.sameAsRequester.some((v) => v.includes("Yes"))
    : payload.sameAsRequester?.includes("Yes") || false;

  // If cats at requester address, use requester address for cats
  const catsAddress = sameAsRequester
    ? requesterAddr.street
    : catAddr.street || requesterAddr.street;
  const catsCity = sameAsRequester
    ? requesterAddr.city
    : catAddr.city || requesterAddr.city;
  const catsZip = sameAsRequester
    ? requesterAddr.zip
    : catAddr.zip || requesterAddr.zip;

  if (!catsAddress) {
    // For pet spay redirects, address may not be filled — that's OK
    if (!isPetSpayRedirect) {
      return apiBadRequest("Cat location address is required");
    }
  }

  // Map remaining fields
  const handleability = HANDLEABILITY_MAP[payload.handleability || ""] || null;
  const fixedStatus = FIXED_STATUS_MAP[payload.fixedStatus || ""] || null;
  const feedingSituation = FEEDING_MAP[payload.feedingSituation || ""] || null;
  const county = payload.county?.trim() || null;
  const catCount = payload.catCount ? parseInt(payload.catCount, 10) || null : null;
  const peakCount = payload.peakCount ? parseInt(payload.peakCount, 10) || null : null;
  const eartipCount = payload.eartipCount ? parseInt(payload.eartipCount, 10) || null : null;

  // Third party
  const isThirdParty = payload.isThirdParty?.includes("someone else") || false;
  const thirdPartyRelationship = isThirdParty ? payload.thirdPartyRelationship?.trim() || null : null;
  const propertyOwnerName = isThirdParty ? payload.propertyOwnerName?.trim() || null : null;
  const propertyOwnerPhone = isThirdParty ? extractPhone(payload.propertyOwnerPhone) : null;
  const propertyOwnerEmail = isThirdParty ? payload.propertyOwnerEmail?.trim() || null : null;

  // Kittens
  const hasKittens = payload.hasKittens === "Yes";
  const kittenCount = hasKittens && payload.kittenCount ? parseInt(payload.kittenCount, 10) || null : null;
  const kittenAge = hasKittens ? payload.kittenAge?.trim() || null : null;
  const kittenBehavior = hasKittens ? payload.kittenSocialization?.trim() || null : null;
  const momPresent = hasKittens ? payload.momPresent?.trim() || null : null;

  // Medical
  const hasMedicalConcerns = payload.hasMedicalConcerns === "Yes";
  const medicalDescription = hasMedicalConcerns ? payload.medicalDescription?.trim() || null : null;
  const isEmergency = payload.isEmergency?.includes("Urgent") || false;

  // Property
  const isPropertyOwner = payload.isPropertyOwner === "Yes" ? "yes" : payload.isPropertyOwner === "No" ? "no" : null;
  const hasPropertyAccess = payload.hasPropertyAccess === "Yes" ? "yes"
    : payload.hasPropertyAccess === "No" ? "no"
    : payload.hasPropertyAccess?.includes("permission") ? "need_permission" : null;

  // Notes and referral
  const notes = payload.notes?.trim() || null;
  const referralSource = payload.referralSource?.trim() || null;

  // Custom fields for tracking pet spay redirect choice
  const customFields = isPetSpayRedirect
    ? JSON.stringify({ pet_spay_redirect: true, pet_spay_choice: petSpayChoice })
    : petSpayChoice
      ? JSON.stringify({ pet_spay_choice: petSpayChoice })
      : null;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || null;
  const ua = request.headers.get("user-agent") || null;

  try {
    // Dedup by Jotform submission ID
    if (submissionID) {
      const existing = await queryOne<{ submission_id: string }>(
        `SELECT submission_id FROM ops.intake_submissions WHERE source_raw_id = $1 LIMIT 1`,
        [submissionID]
      );
      if (existing) {
        console.log(`[JOTFORM-INTAKE] Duplicate blocked: submissionID=${submissionID}`);
        return apiSuccess({ submission_id: existing.submission_id, duplicate: true });
      }
    }

    // Insert
    const result = await queryOne<{ submission_id: string; triage_category: string; triage_score: number }>(
      `INSERT INTO ops.intake_submissions (
        intake_source, source_system, source_raw_id,
        first_name, last_name, email, phone,
        requester_address, requester_city, requester_zip,
        cats_at_requester_address,
        is_third_party_report, third_party_relationship,
        property_owner_name, property_owner_phone, property_owner_email,
        cats_address, cats_city, cats_zip, county,
        ownership_status, call_type,
        cat_name, cat_count_estimate, cat_description,
        handleability, fixed_status, peak_count, eartip_count_observed,
        feeding_situation,
        has_kittens, kitten_count, kitten_age_estimate, kitten_behavior,
        mom_present,
        has_medical_concerns, medical_description, is_emergency,
        is_property_owner, has_property_access,
        situation_description, referral_source,
        custom_fields, ip_address, user_agent
      ) VALUES (
        'jotform', 'jotform_public_form', $1,
        $2, $3, $4, $5,
        $6, $7, $8,
        $9,
        $10, $11,
        $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20,
        $21, $22, $23,
        $24, $25, $26, $27,
        $28,
        $29, $30, $31, $32,
        $33,
        $34, $35, $36,
        $37, $38,
        $39, $40,
        $41::JSONB, $42, $43
      )
      RETURNING submission_id, triage_category::TEXT, triage_score`,
      [
        submissionID,                          // $1
        firstName,                             // $2
        lastName,                              // $3
        email,                                 // $4
        phone,                                 // $5
        requesterAddr.street,                  // $6
        requesterAddr.city,                    // $7
        requesterAddr.zip,                     // $8
        sameAsRequester,                       // $9
        isThirdParty,                          // $10
        thirdPartyRelationship,                // $11
        propertyOwnerName,                     // $12
        propertyOwnerPhone,                    // $13
        propertyOwnerEmail,                    // $14
        catsAddress,                           // $15
        catsCity,                              // $16
        catsZip,                               // $17
        county,                                // $18
        ownershipStatus,                       // $19
        callType,                              // $20
        payload.catName?.trim() || null,       // $21
        catCount,                              // $22
        payload.catDescription?.trim() || null, // $23
        handleability,                         // $24
        fixedStatus,                           // $25
        peakCount,                             // $26
        eartipCount,                           // $27
        feedingSituation,                      // $28
        hasKittens,                            // $29
        kittenCount,                           // $30
        kittenAge,                             // $31
        kittenBehavior,                        // $32
        momPresent,                            // $33
        hasMedicalConcerns,                    // $34
        medicalDescription,                    // $35
        isEmergency,                           // $36
        isPropertyOwner,                       // $37
        hasPropertyAccess,                     // $38
        notes,                                 // $39
        referralSource,                        // $40
        customFields,                          // $41
        ip,                                    // $42
        ua,                                    // $43
      ]
    );

    if (!result) {
      return apiServerError("Failed to insert intake submission");
    }

    // Async: match person + link place (fire-and-forget)
    queryOne("SELECT sot.match_intake_to_person($1)", [result.submission_id])
      .catch((err) => console.error("[JOTFORM-INTAKE] Person matching error:", err));
    queryOne("SELECT sot.link_intake_to_place($1)", [result.submission_id])
      .catch((err) => console.error("[JOTFORM-INTAKE] Place linking error:", err));

    console.log(
      `[JOTFORM-INTAKE] Processed: id=${result.submission_id}, type=${callType}, triage=${result.triage_category}, pet_redirect=${isPetSpayRedirect}`
    );

    return apiSuccess({
      submission_id: result.submission_id,
      triage_category: result.triage_category,
      triage_score: result.triage_score,
      call_type: callType,
      pet_spay_redirect: isPetSpayRedirect,
    });
  } catch (error) {
    console.error("[JOTFORM-INTAKE] Error:", error);
    return apiServerError("Failed to process intake submission");
  }
}

// Health check
export async function GET() {
  return apiSuccess({
    endpoint: "jotform-intake",
    description: "Receives FFSC assistance request form submissions from Jotform",
    auth: "Bearer token via Authorization header",
    form_id: "260855308349060",
    maps_to: "ops.intake_submissions",
  });
}
