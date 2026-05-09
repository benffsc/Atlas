import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";

/**
 * GET /api/trappers/emails?tier=ffsc|community|all
 *
 * Returns deduplicated email list for trappers, one per person (highest confidence).
 * Designed for "copy all emails" button on the trappers page.
 */

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiError("Authentication required", 401);

  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier") || "ffsc";

  let typeFilter: string;
  if (tier === "ffsc") {
    typeFilter = `tp.trapper_type IN ('ffsc_volunteer', 'ffsc_staff')`;
  } else if (tier === "community") {
    typeFilter = `tp.trapper_type = 'community_trapper'`;
  } else {
    typeFilter = `1=1`;
  }

  try {
    const rows = await queryRows<{ email: string; name: string }>(
      `SELECT DISTINCT ON (p.person_id)
         pi.id_value_raw AS email,
         p.first_name || ' ' || p.last_name AS name
       FROM sot.trapper_profiles tp
       JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
       JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
         AND pi.id_type = 'email' AND pi.confidence >= 0.5
       WHERE tp.is_active = true AND ${typeFilter}
       ORDER BY p.person_id, pi.confidence DESC, pi.created_at DESC`
    );

    return apiSuccess({
      count: rows.length,
      emails: rows.map((r) => r.email),
      comma_separated: rows.map((r) => r.email).join(", "),
      with_names: rows.map((r) => `${r.name} <${r.email}>`),
    });
  } catch (error) {
    console.error("[TRAPPERS] Email list error:", error);
    return apiServerError("Failed to fetch trapper emails");
  }
}
