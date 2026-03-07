import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";
import { NextRequest } from "next/server";

interface CheckoutRow {
  checkout_id: string;
  person_name: string | null;
  person_id: string | null;
  checked_out_at: string | null;
  returned_at: string | null;
  notes: string | null;
  source_system: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    requireValidUUID(id, "equipment");

    const checkouts = await queryRows<CheckoutRow>(
      `
      SELECT
        ec.checkout_id,
        p.display_name AS person_name,
        ec.person_id,
        ec.checked_out_at::text,
        ec.returned_at::text,
        ec.notes,
        ec.source_system
      FROM ops.equipment_checkouts ec
      LEFT JOIN sot.people p ON p.person_id = ec.person_id
      WHERE ec.equipment_id = $1
      ORDER BY ec.checked_out_at DESC NULLS LAST
      `,
      [id]
    );

    return apiSuccess({ checkouts });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    console.error("Equipment checkouts error:", error);
    return apiServerError("Failed to fetch checkouts");
  }
}
