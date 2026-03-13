import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";

/**
 * Community Trapper Onboarding Webhook (FFS-474)
 *
 * Receives new community trapper sign-ups from JotForm (via Airtable or direct).
 * Creates the person + trapper_profiles + person_roles records.
 *
 * Flow:
 *   JotForm contract submission
 *     → Airtable Atlas Sync base (optional relay)
 *       → POST /api/webhooks/trapper-onboarding
 *         → data_engine_resolve_identity() → person
 *         → person_roles (trapper)
 *         → trapper_profiles (community_trapper, has_signed_contract=true)
 *
 * Auth: Bearer token via WEBHOOK_SECRET or CRON_SECRET env var.
 *
 * Payload (matches Airtable "Community Trapper Agreements" schema):
 * {
 *   first_name: string (required)
 *   last_name: string (required)
 *   email: string (required)
 *   phone?: string
 *   address?: string
 *   availability?: string       // Trapper's availability schedule
 *   signature?: string          // Contract signature (URL or base64)
 *   contract_areas?: string     // Areas they're authorized to trap
 *   rescue_name?: string        // If they run a rescue
 *   notes?: string
 *   contract_signed_date?: string // ISO date
 *   source_record_id?: string   // Airtable/JotForm record ID
 * }
 */

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.CRON_SECRET;

interface TrapperOnboardingPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  address?: string;
  availability?: string;
  signature?: string;
  contract_areas?: string;
  rescue_name?: string;
  notes?: string;
  contract_signed_date?: string;
  source_record_id?: string;
}

function validatePayload(
  body: Record<string, unknown>
): TrapperOnboardingPayload | null {
  const firstName = (body.first_name || body.firstName) as string | undefined;
  const lastName = (body.last_name || body.lastName) as string | undefined;
  const email = body.email as string | undefined;

  if (!firstName || !lastName || !email) return null;

  // Basic email validation
  if (!email.includes("@") || !email.includes(".")) return null;

  return {
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    email: email.trim().toLowerCase(),
    phone: (body.phone as string)?.trim() || undefined,
    address: (body.address as string)?.trim() || undefined,
    availability: (body.availability as string)?.trim() || undefined,
    signature: (body.signature || body.Signature) as string | undefined,
    contract_areas: (body.contract_areas || body.contractAreas) as
      | string
      | undefined,
    rescue_name: (body.rescue_name || body.rescueName) as string | undefined,
    notes: (body.notes as string)?.trim() || undefined,
    contract_signed_date: (body.contract_signed_date ||
      body.contractSignedDate) as string | undefined,
    source_record_id: (body.source_record_id || body.sourceRecordId) as
      | string
      | undefined,
  };
}

export async function POST(request: NextRequest) {
  // Verify webhook secret
  const authHeader = request.headers.get("authorization");
  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return apiUnauthorized("Unauthorized");
  }

  try {
    const body = await request.json();
    const payload = validatePayload(body);

    if (!payload) {
      return apiBadRequest(
        "Missing required fields: first_name, last_name, email"
      );
    }

    // Step 1: Resolve identity (creates person if new, matches if existing)
    const identityResult = await queryOne<{
      person_id: string;
      match_type: string;
    }>(
      `SELECT * FROM sot.data_engine_resolve_identity($1, $2, $3, $4, $5, $6)`,
      [
        payload.email,
        payload.phone || null,
        payload.first_name,
        payload.last_name,
        payload.address || null,
        "atlas_sync",
      ]
    );

    if (!identityResult) {
      return apiServerError("Identity resolution failed");
    }

    const personId = identityResult.person_id;

    // Step 2: Add trapper role (idempotent)
    await queryOne(
      `INSERT INTO sot.person_roles (person_id, role, source_system)
       VALUES ($1, 'trapper', 'atlas_sync')
       ON CONFLICT DO NOTHING
       RETURNING person_id`,
      [personId]
    );

    // Step 3: Create/update trapper profile
    // Build notes from availability + any explicit notes
    const profileNotes = [
      payload.availability ? `Availability: ${payload.availability}` : null,
      payload.notes,
    ]
      .filter(Boolean)
      .join("\n");

    const hasSigned = !!payload.signature;
    const profile = await queryOne<{ person_id: string }>(
      `INSERT INTO sot.trapper_profiles (
         person_id, trapper_type, is_active,
         has_signed_contract, contract_signed_date, contract_areas,
         rescue_name, notes, source_system
       ) VALUES (
         $1, 'community_trapper', true,
         $2, $3, $4,
         $5, $6, 'atlas_sync'
       )
       ON CONFLICT (person_id) DO UPDATE SET
         has_signed_contract = EXCLUDED.has_signed_contract OR sot.trapper_profiles.has_signed_contract,
         contract_signed_date = COALESCE(EXCLUDED.contract_signed_date, sot.trapper_profiles.contract_signed_date),
         contract_areas = COALESCE(EXCLUDED.contract_areas, sot.trapper_profiles.contract_areas),
         rescue_name = COALESCE(EXCLUDED.rescue_name, sot.trapper_profiles.rescue_name),
         notes = CASE
           WHEN sot.trapper_profiles.notes IS NULL THEN EXCLUDED.notes
           WHEN EXCLUDED.notes IS NULL THEN sot.trapper_profiles.notes
           ELSE sot.trapper_profiles.notes || E'\n[Onboarding] ' || EXCLUDED.notes
         END,
         updated_at = NOW()
       RETURNING person_id`,
      [
        personId,
        hasSigned,
        payload.contract_signed_date || (hasSigned ? new Date().toISOString().slice(0, 10) : null),
        payload.contract_areas || null,
        payload.rescue_name || null,
        profileNotes || null,
      ]
    );

    // Step 4: Audit trail
    await queryOne(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         new_value, edit_source, reason
       ) VALUES (
         'person', $1, 'create', 'trapper_onboarding',
         $2, 'trapper-onboarding-webhook',
         'Community trapper onboarded via webhook'
       )`,
      [
        personId,
        JSON.stringify({
          email: payload.email,
          source_record_id: payload.source_record_id,
          match_type: identityResult.match_type,
          has_signature: !!payload.signature,
          availability: payload.availability || null,
        }),
      ]
    );

    return apiSuccess({
      person_id: personId,
      match_type: identityResult.match_type,
      trapper_type: "community_trapper",
      message: `Trapper ${payload.first_name} ${payload.last_name} onboarded successfully`,
    });
  } catch (error) {
    console.error("Trapper onboarding webhook error:", error);
    return apiServerError("Trapper onboarding failed");
  }
}

// GET for endpoint discovery
export async function GET() {
  return apiSuccess({
    endpoint: "trapper-onboarding webhook",
    usage: "POST with { first_name, last_name, email, phone?, ... }",
    auth: "Include Authorization: Bearer YOUR_SECRET header",
    docs: "See FFS-474 in Linear for full payload spec",
  });
}
