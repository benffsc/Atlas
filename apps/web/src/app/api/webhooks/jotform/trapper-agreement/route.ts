import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import {
  apiSuccess,
  apiError,
  apiUnauthorized,
  apiServerError,
  apiBadRequest,
} from "@/lib/api-response";

/**
 * JotForm Community Trapper Agreement Webhook (FFS-557)
 *
 * Replaces the Airtable pull-based sync with a direct webhook:
 *   JotForm submission → POST here → resolve identity → create trapper profile
 *
 * JotForm sends form data as a flat object with field names.
 * Expected fields (map these in JotForm webhook config):
 *   first_name, last_name, email, phone, address, availability, signature
 *
 * Auth: Bearer token via WEBHOOK_SECRET env var.
 */

export const maxDuration = 30;

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

interface JotFormPayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  availability?: string;
  signature?: string;
  // JotForm also sends metadata
  formID?: string;
  submissionID?: string;
}

export async function POST(request: NextRequest) {
  // Verify auth
  const authHeader = request.headers.get("authorization");
  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return apiUnauthorized("Invalid or missing authorization");
  }

  let payload: JotFormPayload;
  try {
    // JotForm can send as JSON or form-encoded depending on config
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      // Form-encoded (JotForm default)
      const formData = await request.formData();
      payload = Object.fromEntries(formData.entries()) as unknown as JotFormPayload;
    }
  } catch {
    return apiBadRequest("Could not parse request body");
  }

  // Validate required fields
  const firstName = payload.first_name?.trim();
  const lastName = payload.last_name?.trim();
  const email = payload.email?.trim()?.toLowerCase();
  const phone = payload.phone?.trim() || null;
  const address = payload.address?.trim() || null;

  if (!firstName || !lastName) {
    return apiBadRequest("Missing required fields: first_name and last_name");
  }

  if (!email || !email.includes("@")) {
    return apiBadRequest("Missing or invalid email address");
  }

  try {
    // Step 1: Resolve identity (creates person if new, matches if existing)
    const identityResult = await queryOne<{
      person_id: string;
      match_type: string;
    }>(
      `SELECT * FROM sot.data_engine_resolve_identity($1, $2, $3, $4, $5, $6)`,
      [email, phone, firstName, lastName, address, "jotform"]
    );

    if (!identityResult) {
      return apiServerError("Identity resolution returned no result");
    }

    const personId = identityResult.person_id;

    // Step 2: Add trapper role (idempotent)
    await queryOne(
      `INSERT INTO sot.person_roles (person_id, role, source_system)
       VALUES ($1, 'trapper', 'web_intake')
       ON CONFLICT DO NOTHING
       RETURNING person_id`,
      [personId]
    );

    // Step 3: Create/update trapper profile
    const profileNotes = payload.availability
      ? `Availability: ${payload.availability}`
      : null;

    const hasSigned = !!payload.signature;

    await queryOne(
      `INSERT INTO sot.trapper_profiles (
         person_id, trapper_type, is_active,
         has_signed_contract, contract_signed_date, contract_areas,
         notes, source_system
       ) VALUES (
         $1, 'community_trapper', true,
         $2, $3, NULL,
         $4, 'web_intake'
       )
       ON CONFLICT (person_id) DO UPDATE SET
         has_signed_contract = EXCLUDED.has_signed_contract OR sot.trapper_profiles.has_signed_contract,
         contract_signed_date = COALESCE(EXCLUDED.contract_signed_date, sot.trapper_profiles.contract_signed_date),
         notes = CASE
           WHEN sot.trapper_profiles.notes IS NULL THEN EXCLUDED.notes
           WHEN EXCLUDED.notes IS NULL THEN sot.trapper_profiles.notes
           ELSE sot.trapper_profiles.notes || E'\n[JotForm Agreement] ' || EXCLUDED.notes
         END,
         updated_at = NOW()
       RETURNING person_id`,
      [
        personId,
        hasSigned,
        hasSigned ? new Date().toISOString().slice(0, 10) : null,
        profileNotes,
      ]
    );

    // Step 4: Audit trail
    await queryOne(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         new_value, edit_source, reason
       ) VALUES (
         'person', $1, 'create', 'trapper_onboarding',
         $2, 'jotform-trapper-agreement',
         'Community trapper agreement submitted via JotForm'
       )`,
      [
        personId,
        JSON.stringify({
          jotform_submission_id: payload.submissionID || null,
          jotform_form_id: payload.formID || null,
          email,
          match_type: identityResult.match_type,
          has_signature: hasSigned,
          availability: payload.availability || null,
        }),
      ]
    );

    console.log(
      `[JOTFORM-TRAPPER] Processed agreement: person=${personId}, match=${identityResult.match_type}, signed=${hasSigned}`
    );

    return apiSuccess({
      message: "Trapper agreement processed successfully",
      person_id: personId,
      match_type: identityResult.match_type,
      has_signed_contract: hasSigned,
    });
  } catch (error) {
    console.error("[JOTFORM-TRAPPER] Error processing agreement:", error);
    return apiServerError("Failed to process trapper agreement");
  }
}

// GET for endpoint discovery / health check
export async function GET() {
  return apiSuccess({
    endpoint: "jotform-trapper-agreement",
    description: "Receives JotForm community trapper agreement submissions",
    auth: "Bearer token via Authorization header",
    fields: ["first_name", "last_name", "email", "phone", "address", "availability", "signature"],
  });
}
