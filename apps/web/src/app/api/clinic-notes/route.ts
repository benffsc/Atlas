import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { requireValidUUID, parsePagination, ApiError } from "@/lib/api-validation";

interface ClinicNoteRow {
  account_id: string;
  client_name: string;
  quick_notes: string | null;
  long_notes: string | null;
  tags: string | null;
  notes_updated_at: string | null;
  clinichq_client_id: number | null;
}

const NOTE_COLUMNS = `
  ca.account_id,
  ca.display_name as client_name,
  ca.quick_notes,
  ca.long_notes,
  ca.tags,
  ca.notes_updated_at::TEXT,
  ca.clinichq_client_id
`;

const HAS_NOTES = `(ca.quick_notes IS NOT NULL OR ca.long_notes IS NOT NULL OR ca.tags IS NOT NULL)`;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const personId = searchParams.get("person_id");
  const placeId = searchParams.get("place_id");
  const accountId = searchParams.get("account_id");

  // Must have at least one filter
  if (!personId && !placeId && !accountId) {
    return apiBadRequest("Missing required parameter: person_id, place_id, or account_id");
  }

  try {
    // Validate UUIDs (Invariant 46)
    if (personId) requireValidUUID(personId, "person");
    if (placeId) requireValidUUID(placeId, "place");
    if (accountId) requireValidUUID(accountId, "account");

    const { limit } = parsePagination(searchParams, { maxLimit: 100, defaultLimit: 20 });

    let sql: string;
    const params: unknown[] = [];

    if (accountId) {
      // Direct account lookup
      sql = `
        SELECT ${NOTE_COLUMNS}
        FROM ops.clinic_accounts ca
        WHERE ca.account_id = $1
          AND ca.merged_into_account_id IS NULL
          AND ${HAS_NOTES}
      `;
      params.push(accountId);
    } else if (placeId) {
      // Path 1: accounts linked via appointments at this place
      // Path 2: accounts resolved to people linked to this place
      sql = `
        SELECT ${NOTE_COLUMNS}
        FROM (
          -- Via appointment at this place
          SELECT DISTINCT ca.account_id
          FROM ops.appointments apt
          JOIN ops.clinic_accounts ca ON ca.account_id = apt.owner_account_id
          WHERE apt.inferred_place_id = $1
            AND ca.merged_into_account_id IS NULL
            AND ${HAS_NOTES}

          UNION

          -- Via resolved person linked to this place
          SELECT DISTINCT ca.account_id
          FROM ops.clinic_accounts ca
          JOIN sot.person_place pp ON pp.person_id = ca.resolved_person_id
          WHERE pp.place_id = $1
            AND ca.merged_into_account_id IS NULL
            AND ca.resolved_person_id IS NOT NULL
            AND ${HAS_NOTES}
        ) matched
        JOIN ops.clinic_accounts ca USING (account_id)
        ORDER BY ca.notes_updated_at DESC NULLS LAST
        LIMIT $2
      `;
      params.push(placeId, limit);
    } else if (personId) {
      // Path 1: accounts linked via appointments resolved to this person
      // Path 2: accounts directly resolved to this person (FFS-173 fix)
      sql = `
        SELECT ${NOTE_COLUMNS}
        FROM (
          -- Via appointment resolved to this person
          SELECT DISTINCT ca.account_id
          FROM ops.appointments apt
          JOIN ops.clinic_accounts ca ON ca.account_id = apt.owner_account_id
          WHERE apt.resolved_person_id = $1
            AND ca.merged_into_account_id IS NULL
            AND ${HAS_NOTES}

          UNION

          -- Via direct resolution on clinic_accounts (no appointment needed)
          SELECT ca.account_id
          FROM ops.clinic_accounts ca
          WHERE ca.resolved_person_id = $1
            AND ca.merged_into_account_id IS NULL
            AND ${HAS_NOTES}
        ) matched
        JOIN ops.clinic_accounts ca USING (account_id)
        ORDER BY ca.notes_updated_at DESC NULLS LAST
        LIMIT $2
      `;
      params.push(personId, limit);
    }

    const notes = await queryRows<ClinicNoteRow>(sql!, params);

    return apiSuccess({
      notes,
      total: notes.length,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return apiBadRequest(error.message);
    }
    console.error("[GET /api/clinic-notes] Error:", error);
    return apiServerError("Failed to fetch clinic notes");
  }
}
