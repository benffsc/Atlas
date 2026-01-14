import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
    const { data, error } = await supabase.rpc("convert_intake_to_request", {
      p_submission_id: submission_id,
      p_converted_by: converted_by,
    });

    if (error) {
      console.error("Error converting intake:", error);
      return NextResponse.json(
        { error: "Failed to convert submission to request" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      request_id: data,
    });
  } catch (err) {
    console.error("Convert error:", err);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
