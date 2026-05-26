import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiBadRequest, apiSuccess, apiServerError } from "@/lib/api-response";

interface WatchlistResult {
  success: boolean;
  message: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return apiBadRequest("Person ID is required");
  }

  try {
    requireValidUUID(id, "person");
    const body = await request.json();
    const { watch_list, reason } = body;

    if (typeof watch_list !== "boolean") {
      return apiBadRequest("watch_list must be a boolean");
    }

    if (watch_list && (!reason || !reason.trim())) {
      return apiBadRequest("Reason is required when adding to watch list");
    }

    const result = await queryOne<WatchlistResult>(
      `SELECT * FROM ops.toggle_person_watchlist($1, $2, $3, $4)`,
      [id, watch_list, reason || null, "atlas_ui"]
    );

    if (!result?.success) {
      return apiBadRequest(result?.message || "Failed to update watch list");
    }

    return apiSuccess({
      success: true,
      message: result.message,
      watch_list,
    });
  } catch (error) {
    console.error("Error updating person watchlist:", error);
    return apiServerError("Failed to update watch list");
  }
}
