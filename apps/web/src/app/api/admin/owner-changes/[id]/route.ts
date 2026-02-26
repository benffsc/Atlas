// API route for handling owner change actions
// POST /api/admin/owner-changes/[id]

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface ActionRequest {
  action: "transfer" | "merge" | "keep_both" | "reject";
  reason?: string;
}

interface ActionResult {
  success: boolean;
  action: string;
  relationships_deleted?: number;
  relationships_created?: number;
  cats_transferred?: number;
  person_updated?: string;
  notes?: string;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params;

  if (!reviewId) {
    return NextResponse.json(
      { success: false, error: "Review ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: ActionRequest = await request.json();

    if (!body.action || !["transfer", "merge", "keep_both", "reject"].includes(body.action)) {
      return NextResponse.json(
        { success: false, error: "Invalid action. Must be: transfer, merge, keep_both, or reject" },
        { status: 400 }
      );
    }

    // Call the SQL function we created in MIG_2504
    const result = await queryOne<{ apply_owner_change: ActionResult }>(
      `SELECT ops.apply_owner_change($1, $2, $3, NULL) as apply_owner_change`,
      [reviewId, body.action, body.reason || null]
    );

    if (!result) {
      return NextResponse.json(
        { success: false, error: "Failed to apply owner change" },
        { status: 500 }
      );
    }

    const actionResult = result.apply_owner_change;

    if (!actionResult.success) {
      return NextResponse.json(
        { success: false, error: actionResult.error || "Action failed" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Owner change ${body.action} successful`,
      result: actionResult,
    });
  } catch (error) {
    console.error("Error applying owner change:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
