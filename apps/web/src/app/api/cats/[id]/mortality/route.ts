import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiNotFound, apiServerError, apiBadRequest } from "@/lib/api-response";
import { DEATH_CAUSE, DATE_PRECISION, type DeathCause } from "@/lib/enums";

/**
 * Cat Mortality API Endpoint
 *
 * GET - Check if cat has mortality record, return details
 * POST - Report cat as deceased using register_mortality_event()
 *
 * Used by:
 * - Cat detail page "Report Deceased" button
 * - Beacon survival rate calculations
 */

interface MortalityEvent {
  mortality_event_id: string;
  cat_id: string;
  death_date: string | null;
  death_date_precision: string;
  death_cause: DeathCause;
  death_cause_notes: string | null;
  death_age_months: number | null;
  death_age_category: string | null;
  place_id: string | null;
  place_name: string | null;
  reported_by: string | null;
  reported_date: string;
  notes: string | null;
  created_at: string;
}

interface RegisterMortalityResult {
  success: boolean;
  message: string;
  mortality_event_id: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "cat");

    // Check if cat exists and get basic info
    const catSql = `
      SELECT
        c.cat_id,
        c.display_name,
        c.is_deceased,
        c.deceased_date::TEXT
      FROM sot.cats c
      WHERE c.cat_id = $1
    `;
    const cat = await queryOne<{
      cat_id: string;
      display_name: string;
      is_deceased: boolean | null;
      deceased_date: string | null;
    }>(catSql, [id]);

    if (!cat) {
      return apiNotFound("Cat", id);
    }

    // Get mortality event if exists
    const mortalitySql = `
      SELECT
        me.mortality_event_id,
        me.cat_id,
        me.death_date::TEXT,
        me.death_date_precision,
        me.death_cause::TEXT,
        me.death_cause_notes,
        me.death_age_months,
        me.death_age_category,
        me.place_id,
        p.display_name AS place_name,
        me.reported_by,
        me.reported_date::TEXT,
        me.notes,
        me.created_at::TEXT
      FROM sot.cat_mortality_events me
      LEFT JOIN sot.places p ON p.place_id = me.place_id
      WHERE me.cat_id = $1
        AND me.deleted_at IS NULL
    `;
    const mortality = await queryOne<MortalityEvent>(mortalitySql, [id]);

    return apiSuccess({
      cat_id: cat.cat_id,
      display_name: cat.display_name,
      is_deceased: cat.is_deceased ?? false,
      deceased_date: cat.deceased_date,
      mortality_event: mortality ?? null,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error fetching mortality info:", error);
    return apiServerError("Failed to fetch mortality information");
  }
}

interface ReportMortalityBody {
  death_date?: string;
  death_date_precision?: string;
  death_cause: DeathCause;
  death_cause_notes?: string;
  death_age_months?: number;
  place_id?: string;
  reported_by?: string;
  notes?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "cat");
    const body: ReportMortalityBody = await request.json();

    // Validate death_cause
    if (!body.death_cause || !DEATH_CAUSE.includes(body.death_cause as DeathCause)) {
      return apiBadRequest(`Invalid death_cause. Must be one of: ${DEATH_CAUSE.join(", ")}`);
    }

    // Validate death_date_precision if provided
    if (body.death_date_precision && !DATE_PRECISION.includes(body.death_date_precision as (typeof DATE_PRECISION)[number])) {
      return apiBadRequest(`Invalid death_date_precision. Must be one of: ${DATE_PRECISION.join(", ")}`);
    }

    // Validate death_age_months if provided
    if (body.death_age_months !== undefined && body.death_age_months !== null) {
      if (body.death_age_months < 0 || body.death_age_months > 300) {
        return apiBadRequest("death_age_months must be between 0 and 300");
      }
    }

    // Call the register_mortality_event function
    const result = await queryOne<RegisterMortalityResult>(
      `
      SELECT * FROM ops.register_mortality_event(
        p_cat_id := $1,
        p_death_date := $2::DATE,
        p_death_date_precision := $3,
        p_death_cause := $4,
        p_death_cause_notes := $5,
        p_death_age_months := $6,
        p_place_id := $7::UUID,
        p_reported_by := $8,
        p_source_system := 'atlas_ui',
        p_notes := $9
      )
    `,
      [
        id,
        body.death_date || null,
        body.death_date_precision || "estimated",
        body.death_cause,
        body.death_cause_notes || null,
        body.death_age_months ?? null,
        body.place_id || null,
        body.reported_by || "atlas_user",
        body.notes || null,
      ]
    );

    if (!result) {
      return apiServerError("Failed to register mortality event");
    }

    if (!result.success) {
      return apiBadRequest(result.message);
    }

    return apiSuccess({
      message: result.message,
      mortality_event_id: result.mortality_event_id,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error reporting mortality:", error);
    return apiServerError("Failed to report mortality");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "cat");

    // Soft-delete mortality event and reset cat deceased status
    const deleteSql = `
      WITH soft_deleted AS (
        UPDATE sot.cat_mortality_events
        SET deleted_at = NOW(), deleted_by = 'web_user'
        WHERE cat_id = $1 AND deleted_at IS NULL
        RETURNING cat_id
      )
      UPDATE sot.cats
      SET is_deceased = FALSE, deceased_date = NULL, updated_at = NOW()
      WHERE cat_id = $1
      RETURNING cat_id, display_name
    `;

    const result = await queryOne<{ cat_id: string; display_name: string }>(deleteSql, [id]);

    if (!result) {
      return apiNotFound("Cat", id);
    }

    return apiSuccess({
      message: `Mortality record removed for ${result.display_name}`,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiBadRequest(error.message);
    }
    console.error("Error removing mortality record:", error);
    return apiServerError("Failed to remove mortality record");
  }
}
