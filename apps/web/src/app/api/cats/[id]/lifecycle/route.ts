import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";

interface LifecycleEvent {
  event_id: string;
  event_type: string;
  event_subtype: string | null;
  event_at: string;
  person_id: string | null;
  person_name: string | null;
  place_id: string | null;
  place_name: string | null;
  metadata: Record<string, unknown> | null;
  source_system: string;
  source_record_id: string | null;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "cat");

    const sql = `
      SELECT
        le.event_id,
        le.event_type,
        le.event_subtype,
        le.event_at::TEXT,
        le.person_id,
        p.display_name AS person_name,
        le.place_id,
        pl.display_name AS place_name,
        le.metadata,
        le.source_system,
        le.source_record_id,
        le.created_at::TEXT
      FROM sot.cat_lifecycle_events le
      LEFT JOIN sot.people p ON p.person_id = le.person_id
      LEFT JOIN sot.places pl ON pl.place_id = le.place_id
      WHERE le.cat_id = $1
      ORDER BY le.event_at DESC
    `;

    const events = await queryRows<LifecycleEvent>(sql, [id]);

    return apiSuccess({ events });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    console.error("Error fetching cat lifecycle events:", error);
    return apiServerError("Failed to fetch lifecycle events");
  }
}
