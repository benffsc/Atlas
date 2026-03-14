import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiNotFound, apiBadRequest, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

interface TrapperProfileRow {
  person_id: string;
  trapper_type: string | null;
  rescue_name: string | null;
  rescue_is_registered: boolean;
  is_active: boolean;
  certified_date: string | null;
  notes: string | null;
  has_signed_contract: boolean;
  contract_signed_date: string | null;
  contract_areas: string[] | null;
  is_legacy_informal: boolean;
  source_system: string | null;
  created_at: string;
  updated_at: string;
  // Joined from v_trapper_tiers
  tier: string | null;
}

/** GET /api/people/[id]/trapper-profile — Trapper profile with contract info */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "person");

    const profile = await queryOne<TrapperProfileRow>(
      `SELECT
         tp.person_id,
         tp.trapper_type,
         tp.rescue_name,
         tp.rescue_is_registered,
         tp.is_active,
         tp.certified_date,
         tp.notes,
         tp.has_signed_contract,
         tp.contract_signed_date,
         tp.contract_areas,
         tp.is_legacy_informal,
         tp.source_system,
         tp.created_at,
         tp.updated_at,
         vt.tier
       FROM sot.trapper_profiles tp
       LEFT JOIN sot.v_trapper_tiers vt ON vt.person_id = tp.person_id
       WHERE tp.person_id = $1`,
      [id]
    );

    if (!profile) {
      // No trapper profile — return empty (person may be a trapper by role but no profile row)
      return apiSuccess({ profile: null });
    }

    return apiSuccess({ profile });
  } catch (error) {
    console.error("[API] Error fetching trapper profile:", error);
    return apiServerError("Failed to fetch trapper profile");
  }
}

/** PATCH /api/people/[id]/trapper-profile — Update trapper profile & contract info */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "person");

    const body = await request.json();
    const {
      notes,
      rescue_name,
      is_active,
      has_signed_contract,
      contract_signed_date,
      contract_areas,
    } = body;

    // Build SET clauses dynamically based on provided fields
    const setClauses: string[] = [];
    const values: unknown[] = [id]; // $1 = person_id
    let paramIndex = 2;

    if (notes !== undefined) {
      setClauses.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }
    if (rescue_name !== undefined) {
      setClauses.push(`rescue_name = $${paramIndex++}`);
      values.push(rescue_name);
    }
    if (is_active !== undefined) {
      setClauses.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }
    if (has_signed_contract !== undefined) {
      setClauses.push(`has_signed_contract = $${paramIndex++}`);
      values.push(has_signed_contract);
    }
    if (contract_signed_date !== undefined) {
      setClauses.push(`contract_signed_date = $${paramIndex++}`);
      values.push(contract_signed_date || null);
    }
    if (contract_areas !== undefined) {
      setClauses.push(`contract_areas = $${paramIndex++}`);
      values.push(contract_areas);
    }

    if (setClauses.length === 0) {
      return apiBadRequest("No fields to update");
    }

    setClauses.push("updated_at = NOW()");

    const updated = await queryOne<TrapperProfileRow>(
      `UPDATE sot.trapper_profiles
       SET ${setClauses.join(", ")}
       WHERE person_id = $1
       RETURNING
         person_id,
         trapper_type,
         rescue_name,
         rescue_is_registered,
         is_active,
         certified_date,
         notes,
         has_signed_contract,
         contract_signed_date,
         contract_areas,
         is_legacy_informal,
         source_system,
         created_at,
         updated_at`,
      values
    );

    if (!updated) {
      return apiNotFound("Trapper profile not found");
    }

    // Fetch tier from view
    const tierRow = await queryOne<{ tier: string | null }>(
      `SELECT tier FROM sot.v_trapper_tiers WHERE person_id = $1`,
      [id]
    );

    return apiSuccess({
      profile: { ...updated, tier: tierRow?.tier || null },
    });
  } catch (error) {
    console.error("[API] Error updating trapper profile:", error);
    return apiServerError("Failed to update trapper profile");
  }
}
