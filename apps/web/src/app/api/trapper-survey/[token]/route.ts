import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound, apiBadRequest, apiServerError } from "@/lib/api-response";

/**
 * GET /api/trapper-survey/[token] — Look up trapper by survey token (public, no auth)
 * POST /api/trapper-survey/[token] — Submit survey response (public, no auth)
 *
 * Token-based access: each trapper gets a unique survey link.
 * No authentication required — the token IS the auth.
 */

interface SurveyTrapper {
  person_id: string;
  first_name: string;
  last_name: string;
  trapper_type: string;
  survey_completed_at: string | null;
  capabilities: string[];
  availability_notes: string | null;
  geographic_range: string | null;
  has_own_traps: boolean;
  has_vehicle: boolean;
  trapping_experience: string | null;
  languages_spoken: string[] | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || token.length < 8) {
    return apiBadRequest("Invalid survey token");
  }

  try {
    const trapper = await queryOne<SurveyTrapper>(
      `SELECT
         p.person_id, p.first_name, p.last_name,
         tp.trapper_type, tp.survey_completed_at,
         COALESCE(tp.capabilities, '{}') AS capabilities,
         tp.availability_notes, tp.geographic_range,
         tp.has_own_traps, tp.has_vehicle,
         tp.trapping_experience, tp.languages_spoken
       FROM sot.trapper_profiles tp
       JOIN sot.people p ON p.person_id = tp.person_id
       WHERE tp.survey_token = $1`,
      [token]
    );

    if (!trapper) {
      return apiNotFound("survey", token);
    }

    return apiSuccess({ trapper });
  } catch (error) {
    console.error("[TRAPPER-SURVEY] GET error:", error);
    return apiServerError("Failed to load survey");
  }
}

const VALID_CAPABILITIES = ["trapping", "transport", "recon", "colony_care", "mentoring"];
const VALID_EXPERIENCE = ["none", "some", "experienced"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || token.length < 8) {
    return apiBadRequest("Invalid survey token");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid request body");
  }

  const {
    capabilities,
    availability_notes,
    geographic_range,
    has_own_traps,
    has_vehicle,
    trapping_experience,
    languages_spoken,
    additional_notes,
  } = body as {
    capabilities?: string[];
    availability_notes?: string;
    geographic_range?: string;
    has_own_traps?: boolean;
    has_vehicle?: boolean;
    trapping_experience?: string;
    languages_spoken?: string[];
    additional_notes?: string;
  };

  // Validate capabilities
  if (capabilities && !capabilities.every((c: string) => VALID_CAPABILITIES.includes(c))) {
    return apiBadRequest(`Invalid capabilities. Valid: ${VALID_CAPABILITIES.join(", ")}`);
  }

  if (trapping_experience && !VALID_EXPERIENCE.includes(trapping_experience)) {
    return apiBadRequest(`Invalid experience level. Valid: ${VALID_EXPERIENCE.join(", ")}`);
  }

  try {
    // Verify token exists
    const existing = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.trapper_profiles WHERE survey_token = $1`,
      [token]
    );

    if (!existing) {
      return apiNotFound("survey", token);
    }

    // Build notes append if additional_notes provided
    const notesAppend = additional_notes
      ? `\n[Survey ${new Date().toISOString().slice(0, 10)}] ${additional_notes}`
      : null;

    // Update profile
    await queryOne(
      `UPDATE sot.trapper_profiles SET
         capabilities = COALESCE($2, capabilities),
         availability_notes = COALESCE($3, availability_notes),
         geographic_range = COALESCE($4, geographic_range),
         has_own_traps = COALESCE($5, has_own_traps),
         has_vehicle = COALESCE($6, has_vehicle),
         trapping_experience = COALESCE($7, trapping_experience),
         languages_spoken = COALESCE($8, languages_spoken),
         notes = CASE WHEN $9::TEXT IS NOT NULL THEN COALESCE(notes, '') || $9 ELSE notes END,
         survey_completed_at = NOW(),
         onboarding_stage = CASE
           WHEN onboarding_stage IN ('new', 'interested') THEN 'certified'
           ELSE onboarding_stage
         END,
         updated_at = NOW()
       WHERE survey_token = $1
       RETURNING person_id`,
      [
        token,
        capabilities || null,
        availability_notes || null,
        geographic_range || null,
        has_own_traps ?? null,
        has_vehicle ?? null,
        trapping_experience || null,
        languages_spoken || null,
        notesAppend,
      ]
    );

    console.log(`[TRAPPER-SURVEY] Completed: person=${existing.person_id}`);

    return apiSuccess({ message: "Survey submitted successfully" });
  } catch (error) {
    console.error("[TRAPPER-SURVEY] POST error:", error);
    return apiServerError("Failed to submit survey");
  }
}
