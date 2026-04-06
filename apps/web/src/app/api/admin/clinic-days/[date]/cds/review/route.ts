import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";
import { reviewCDSSuggestion } from "@/lib/cds";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * POST /api/admin/clinic-days/[date]/cds/review
 * Accept or reject a CDS suggestion (Manual > AI invariant).
 *
 * Body: { entry_id: UUID, action: "accept" | "reject", alternate_appointment_id?: UUID }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) return apiUnauthorized();

    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiBadRequest("Invalid date format. Use YYYY-MM-DD.");
    }

    const body = await request.json();
    const { entry_id, action, alternate_appointment_id } = body;

    if (!entry_id) return apiBadRequest("entry_id is required");
    requireValidUUID(entry_id, "entry");

    if (action !== "accept" && action !== "reject") {
      return apiBadRequest('action must be "accept" or "reject"');
    }

    if (alternate_appointment_id) {
      requireValidUUID(alternate_appointment_id, "appointment");
    }

    await reviewCDSSuggestion(entry_id, action, alternate_appointment_id);

    return apiSuccess({ entry_id, action, reviewed: true });
  } catch (error) {
    console.error("CDS review error:", error);
    return apiServerError("Failed to review CDS suggestion");
  }
}
