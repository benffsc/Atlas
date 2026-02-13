import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { submission_id, converted_by = "web_user" } = body;

    if (!submission_id) {
      return NextResponse.json(
        { error: "submission_id is required" },
        { status: 400 }
      );
    }

    // Call the SQL function to convert to request
    const result = await queryOne<{ request_id: string }>(
      `SELECT sot.convert_intake_to_request($1, $2) as request_id`,
      [submission_id, converted_by]
    );

    if (!result?.request_id) {
      console.error("Error converting intake: no request_id returned");
      return NextResponse.json(
        { error: "Failed to convert submission to request" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      request_id: result.request_id,
    });
  } catch (err) {
    console.error("Convert error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request" },
      { status: 400 }
    );
  }
}
