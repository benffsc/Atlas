import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface ClinicNoteRow {
  account_id: string;
  client_name: string;
  quick_notes: string | null;
  long_notes: string | null;
  tags: string | null;
  notes_updated_at: string | null;
  clinichq_client_id: number | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const personId = searchParams.get("person_id");
  const placeId = searchParams.get("place_id");
  const accountId = searchParams.get("account_id");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

  // Must have at least one filter
  if (!personId && !placeId && !accountId) {
    return NextResponse.json(
      { error: "Missing required parameter: person_id, place_id, or account_id" },
      { status: 400 }
    );
  }

  try {
    let sql: string;
    const params: unknown[] = [];

    if (accountId) {
      // Direct account lookup
      sql = `
        SELECT
          ca.account_id,
          ca.display_name as client_name,
          ca.quick_notes,
          ca.long_notes,
          ca.tags,
          ca.notes_updated_at::TEXT,
          ca.clinichq_client_id
        FROM ops.clinic_accounts ca
        WHERE ca.account_id = $1
        AND (ca.quick_notes IS NOT NULL OR ca.long_notes IS NOT NULL OR ca.tags IS NOT NULL)
      `;
      params.push(accountId);
    } else if (placeId) {
      // Get notes for accounts linked to appointments at this place
      sql = `
        SELECT DISTINCT
          ca.account_id,
          ca.display_name as client_name,
          ca.quick_notes,
          ca.long_notes,
          ca.tags,
          ca.notes_updated_at::TEXT,
          ca.clinichq_client_id
        FROM ops.appointments apt
        JOIN ops.clinic_accounts ca ON ca.account_id = apt.owner_account_id
        WHERE apt.inferred_place_id = $1
        AND (ca.quick_notes IS NOT NULL OR ca.long_notes IS NOT NULL OR ca.tags IS NOT NULL)
        ORDER BY ca.notes_updated_at DESC NULLS LAST
        LIMIT $2
      `;
      params.push(placeId, limit);
    } else if (personId) {
      // Get notes for accounts linked to this person's appointments
      sql = `
        SELECT DISTINCT
          ca.account_id,
          ca.display_name as client_name,
          ca.quick_notes,
          ca.long_notes,
          ca.tags,
          ca.notes_updated_at::TEXT,
          ca.clinichq_client_id
        FROM ops.appointments apt
        JOIN ops.clinic_accounts ca ON ca.account_id = apt.owner_account_id
        WHERE apt.resolved_person_id = $1
        AND (ca.quick_notes IS NOT NULL OR ca.long_notes IS NOT NULL OR ca.tags IS NOT NULL)
        ORDER BY ca.notes_updated_at DESC NULLS LAST
        LIMIT $2
      `;
      params.push(personId, limit);
    }

    const notes = await queryRows<ClinicNoteRow>(sql!, params);

    return NextResponse.json({
      notes,
      total: notes.length,
    });
  } catch (error) {
    console.error("[GET /api/clinic-notes] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch clinic notes" },
      { status: 500 }
    );
  }
}
