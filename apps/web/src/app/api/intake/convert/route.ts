import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { submission_id, converted_by = "web_user" } = body;

    if (!submission_id) {
      return apiBadRequest("submission_id is required");
    }

    // Call the SQL function to convert to request (MIG_2531: using ops schema)
    const result = await queryOne<{ request_id: string }>(
      `SELECT ops.convert_intake_to_request($1, $2) as request_id`,
      [submission_id, converted_by]
    );

    if (!result?.request_id) {
      console.error("Error converting intake: no request_id returned");
      return apiServerError("Failed to convert submission to request");
    }

    return apiSuccess({ request_id: result.request_id });
  } catch (err) {
    console.error("Convert error:", err);
    return apiBadRequest(err instanceof Error ? err.message : "Invalid request");
  }
}
