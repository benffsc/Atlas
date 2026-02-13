import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// PATCH - Advance onboarding status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { new_status, notes, advanced_by } = body;

    if (!new_status) {
      return NextResponse.json(
        { error: "new_status is required" },
        { status: 400 }
      );
    }

    // Valid statuses
    const validStatuses = [
      "interested",
      "contacted",
      "orientation_scheduled",
      "orientation_complete",
      "training_scheduled",
      "training_complete",
      "contract_sent",
      "contract_signed",
      "approved",
      "declined",
      "withdrawn",
      "on_hold",
    ];

    if (!validStatuses.includes(new_status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Advance using centralized function
    const result = await queryOne<{
      onboarding_id: string;
      previous_status: string;
      new_status: string;
      person_created: boolean;
    }>(`
      SELECT * FROM trapper.advance_trapper_onboarding(
        p_person_id := $1::UUID,
        p_new_status := $2,
        p_notes := $3,
        p_advanced_by := $4
      )
    `, [
      id,
      new_status,
      notes || null,
      advanced_by || "web_user",
    ]);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to advance onboarding" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      onboarding_id: result.onboarding_id,
      previous_status: result.previous_status,
      new_status: result.new_status,
      person_created: result.person_created,
    });
  } catch (err) {
    console.error("Error advancing onboarding:", err);
    return NextResponse.json(
      { error: "Failed to advance onboarding status" },
      { status: 500 }
    );
  }
}

// GET - Get single onboarding record
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const candidate = await queryOne(`
      SELECT * FROM ops.v_trapper_onboarding_pipeline
      WHERE person_id = $1
    `, [id]);

    if (!candidate) {
      return NextResponse.json(
        { error: "Onboarding record not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ candidate });
  } catch (err) {
    console.error("Error fetching onboarding record:", err);
    return NextResponse.json(
      { error: "Failed to fetch onboarding record" },
      { status: 500 }
    );
  }
}
