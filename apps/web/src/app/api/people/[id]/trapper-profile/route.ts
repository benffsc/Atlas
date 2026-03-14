import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiNotFound, apiServerError } from "@/lib/api-response";
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
