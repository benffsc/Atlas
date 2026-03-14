import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { logFieldEdit } from "@/lib/audit";

interface ContractRow {
  contract_id: string;
  person_id: string;
  contract_type: string;
  status: string;
  signed_date: string | null;
  expiration_date: string | null;
  service_area_description: string | null;
  service_place_ids: string[] | null;
  contract_notes: string | null;
  renewed_from_contract_id: string | null;
  source_system: string;
  created_at: string;
  updated_at: string;
  is_expiring_soon: boolean;
  is_expired: boolean;
}

/** GET /api/people/[id]/contracts — List contracts for person */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "person");

    const contracts = await queryRows<ContractRow>(
      `SELECT
         tc.contract_id,
         tc.person_id,
         tc.contract_type,
         tc.status,
         tc.signed_date::text,
         tc.expiration_date::text,
         tc.service_area_description,
         tc.service_place_ids::text[],
         tc.contract_notes,
         tc.renewed_from_contract_id::text,
         tc.source_system,
         tc.created_at::text,
         tc.updated_at::text,
         CASE
           WHEN tc.expiration_date IS NOT NULL
             AND tc.expiration_date > CURRENT_DATE
             AND tc.expiration_date <= CURRENT_DATE + 30
           THEN TRUE ELSE FALSE
         END AS is_expiring_soon,
         CASE
           WHEN tc.expiration_date IS NOT NULL
             AND tc.expiration_date < CURRENT_DATE
           THEN TRUE ELSE FALSE
         END AS is_expired
       FROM ops.trapper_contracts tc
       WHERE tc.person_id = $1
       ORDER BY tc.signed_date DESC NULLS LAST, tc.created_at DESC`,
      [id]
    );

    return apiSuccess({ contracts });
  } catch (error) {
    console.error("[API] Error fetching contracts:", error);
    return apiServerError("Failed to fetch contracts");
  }
}

/** POST /api/people/[id]/contracts — Create a new contract */
export async function POST(
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
      contract_type,
      signed_date,
      expiration_date,
      service_area_description,
      service_place_ids,
      contract_notes,
      expire_previous,
    } = body as {
      contract_type: string;
      signed_date?: string;
      expiration_date?: string;
      service_area_description?: string;
      service_place_ids?: string[];
      contract_notes?: string;
      expire_previous?: boolean;
    };

    if (!contract_type) return apiError("contract_type is required", 400);

    const validTypes = ["ffsc_volunteer", "community_limited", "colony_caretaker", "rescue_partnership"];
    if (!validTypes.includes(contract_type)) {
      return apiError(`contract_type must be one of: ${validTypes.join(", ")}`, 400);
    }

    // Verify person exists
    const person = await queryOne<{ person_id: string }>(
      `SELECT person_id FROM sot.people WHERE person_id = $1 AND merged_into_person_id IS NULL`,
      [id]
    );
    if (!person) return apiNotFound("Person", id);

    // Optionally expire previous active contract of same type and get its ID
    let renewedFromId: string | null = null;
    if (expire_previous) {
      const prev = await queryOne<{ contract_id: string }>(
        `UPDATE ops.trapper_contracts
         SET status = 'expired', updated_at = NOW()
         WHERE person_id = $1 AND contract_type = $2 AND status = 'active'
         RETURNING contract_id::text`,
        [id, contract_type]
      );
      if (prev) {
        renewedFromId = prev.contract_id;
      }
    }

    // Create contract via DB function
    const result = await queryOne<{ create_trapper_contract: string }>(
      `SELECT ops.create_trapper_contract($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        contract_type,
        signed_date || new Date().toISOString().split("T")[0],
        expiration_date || null,
        service_area_description || null,
        service_place_ids?.length ? service_place_ids : null,
        contract_notes || null,
        renewedFromId,
      ]
    );

    const contractId = result?.create_trapper_contract;

    // Audit log
    await logFieldEdit("person", id, "contract_created", null, contract_type, {
      editedBy: session.staff_id || "web_user",
      editSource: "web_ui",
      reason: `New ${contract_type} contract created`,
    });

    return apiSuccess({ contract_id: contractId, action: "created" });
  } catch (error) {
    console.error("[API] Error creating contract:", error);
    return apiServerError("Failed to create contract");
  }
}
