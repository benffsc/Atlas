import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";

interface UpgradeRequestBody {
  permission_status?: string;
  access_notes?: string | null;
  traps_overnight_safe?: boolean | null;
  access_without_contact?: boolean | null;
  colony_duration?: string;
  count_confidence?: string;
  is_being_fed?: boolean | null;
  feeding_schedule?: string | null;
  best_times_seen?: string | null;
  urgency_reasons?: string[] | null;
  urgency_notes?: string | null;
  kittens_already_taken?: boolean;
  already_assessed?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: UpgradeRequestBody = await request.json();

    // First, verify the request exists and is a legacy request
    const existingRequest = await queryOne<{
      request_id: string;
      source_system: string | null;
      data_source: string;
      status: string;
      place_id: string | null;
      requester_person_id: string | null;
    }>(
      `SELECT request_id, source_system, data_source, status, place_id, requester_person_id
       FROM trapper.sot_requests WHERE request_id = $1`,
      [id]
    );

    if (!existingRequest) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // Check if already upgraded
    if (existingRequest.data_source === "atlas" || existingRequest.source_system === "atlas_ui") {
      return NextResponse.json(
        { error: "This request has already been upgraded to Atlas schema" },
        { status: 400 }
      );
    }

    // Update the request with new Atlas schema fields
    const updateSql = `
      UPDATE trapper.sot_requests
      SET
        -- Enhanced intake fields
        permission_status = $2::trapper.permission_status,
        access_notes = $3,
        traps_overnight_safe = $4,
        access_without_contact = $5,
        colony_duration = $6::trapper.colony_duration,
        count_confidence = $7::trapper.count_confidence,
        is_being_fed = $8,
        feeding_schedule = $9,
        best_times_seen = $10,
        urgency_reasons = $11,
        urgency_notes = $12,
        -- Mark as upgraded
        data_source = 'atlas_ui'::trapper.data_source,
        -- Update status based on flags
        has_kittens = CASE WHEN $13 THEN FALSE ELSE has_kittens END,
        -- Timestamps
        updated_at = NOW()
      WHERE request_id = $1
      RETURNING request_id
    `;

    const result = await queryOne<{ request_id: string }>(updateSql, [
      id,
      body.permission_status || "unknown",
      body.access_notes || null,
      body.traps_overnight_safe,
      body.access_without_contact,
      body.colony_duration || "unknown",
      body.count_confidence || "unknown",
      body.is_being_fed,
      body.feeding_schedule || null,
      body.best_times_seen || null,
      body.urgency_reasons || null,
      body.urgency_notes || null,
      body.kittens_already_taken || false,
    ]);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to upgrade request" },
        { status: 500 }
      );
    }

    // Log the upgrade action in entity_edits
    try {
      await query(
        `INSERT INTO trapper.entity_edits (
          entity_type, entity_id, edit_type, old_value, new_value, changed_by, reason
        ) VALUES (
          'request', $1, 'upgrade',
          jsonb_build_object('data_source', $2, 'source_system', $3),
          jsonb_build_object('data_source', 'atlas_ui', 'upgraded_at', NOW()::TEXT),
          'web_user', 'Legacy request upgraded to Atlas schema'
        )`,
        [id, existingRequest.data_source, existingRequest.source_system]
      );
    } catch (logErr) {
      // Continue even if logging fails
      console.error("Failed to log upgrade:", logErr);
    }

    return NextResponse.json({
      success: true,
      new_request_id: result.request_id,
      message: "Request successfully upgraded to Atlas schema",
    });
  } catch (error) {
    console.error("Error upgrading request:", error);
    return NextResponse.json(
      { error: "Failed to upgrade request" },
      { status: 500 }
    );
  }
}
