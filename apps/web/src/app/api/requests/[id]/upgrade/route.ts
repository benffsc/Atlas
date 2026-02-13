import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";

interface UpgradeRequestBody {
  permission_status?: string;
  access_notes?: string | null;
  traps_overnight_safe?: boolean | null;
  access_without_contact?: boolean | null;
  // Cat count semantic clarification (MIG_534)
  cat_count_clarification?: "total" | "needs_tnr" | "unknown";
  cats_still_needing_tnr?: number | null;
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
    console.log("[upgrade] Starting upgrade for request:", id);
    console.log("[upgrade] Request body:", JSON.stringify(body, null, 2));

    // First, verify the request exists and is a legacy request
    const existingRequest = await queryOne<{
      request_id: string;
      source_system: string | null;
      data_source: string;
      status: string;
      place_id: string | null;
      requester_person_id: string | null;
      estimated_cat_count: number | null;
    }>(
      `SELECT request_id, source_system, data_source, status, place_id, requester_person_id, estimated_cat_count
       FROM ops.requests WHERE request_id = $1`,
      [id]
    );

    console.log("[upgrade] Existing request:", existingRequest);

    if (!existingRequest) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // Check if already upgraded
    if (existingRequest.data_source === "atlas_ui") {
      return NextResponse.json(
        { error: "This request has already been upgraded to Atlas schema" },
        { status: 400 }
      );
    }

    // Determine cat count updates based on clarification (MIG_534)
    // If clarification is "total": original count becomes total_cats_reported, user's input becomes estimated_cat_count
    // If clarification is "needs_tnr": keep estimated_cat_count as-is, just update semantic
    // If clarification is "unknown": keep everything as legacy
    let catCountUpdate = "";
    const extraParams: (string | number | null)[] = [];
    let nextParamIndex = 14;

    if (body.cat_count_clarification === "total" && body.cats_still_needing_tnr !== undefined) {
      catCountUpdate = `,
        total_cats_reported = estimated_cat_count,
        estimated_cat_count = $${nextParamIndex},
        cat_count_semantic = 'needs_tnr'`;
      extraParams.push(body.cats_still_needing_tnr);
      nextParamIndex++;
    } else if (body.cat_count_clarification === "needs_tnr") {
      catCountUpdate = `,
        cat_count_semantic = 'needs_tnr'`;
    }
    // If "unknown", keep cat_count_semantic as 'legacy_total' (no update needed)

    // Update the request with new Atlas schema fields
    const updateSql = `
      UPDATE ops.requests
      SET
        -- Enhanced intake fields
        permission_status = $2,
        access_notes = $3,
        traps_overnight_safe = $4,
        access_without_contact = $5,
        colony_duration = $6,
        count_confidence = $7,
        is_being_fed = $8,
        feeding_schedule = $9,
        best_times_seen = $10,
        urgency_reasons = $11,
        urgency_notes = $12,
        -- Mark as upgraded
        data_source = 'atlas_ui',
        -- Update status based on flags
        has_kittens = CASE WHEN $13 THEN FALSE ELSE has_kittens END,
        -- Timestamps
        updated_at = NOW()
        ${catCountUpdate}
      WHERE request_id = $1
      RETURNING request_id
    `;

    const updateParams = [
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
      ...extraParams,
    ];
    console.log("[upgrade] Running update with params:", updateParams);

    const result = await queryOne<{ request_id: string }>(updateSql, updateParams);
    console.log("[upgrade] Update result:", result);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to upgrade request" },
        { status: 500 }
      );
    }

    // Log the upgrade action in entity_edits
    try {
      await query(
        `INSERT INTO sot.entity_edits (
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

    // Auto-reconcile colony estimates if staff provided clarified cat counts (MIG_562)
    let reconcileResult = null;
    if (
      existingRequest.place_id &&
      body.cat_count_clarification === "total" &&
      body.cats_still_needing_tnr !== undefined
    ) {
      try {
        // Get the original reported count (now stored as total_cats_reported after update)
        const totalCatsReported = existingRequest.estimated_cat_count;

        reconcileResult = await queryOne<{
          reconciled: boolean;
          new_colony_size: number | null;
          verified_altered: number | null;
          message: string;
        }>(
          `SELECT * FROM sot.auto_reconcile_colony_on_upgrade($1, $2, $3, $4)`,
          [id, totalCatsReported, body.cats_still_needing_tnr, "web_user"]
        );

        if (reconcileResult?.reconciled) {
          console.log("[upgrade] Colony auto-reconciled:", reconcileResult.message);
        }

        // Also add a staff-verified estimate for the total_cats_reported
        if (totalCatsReported && existingRequest.place_id) {
          await queryOne(
            `SELECT sot.add_staff_verified_estimate($1, $2, $3, $4)`,
            [
              existingRequest.place_id,
              totalCatsReported,
              id,
              `From request upgrade: ${totalCatsReported} total reported, ${body.cats_still_needing_tnr} still needing TNR`,
            ]
          );
        }
      } catch (reconcileErr) {
        // Don't fail the upgrade if reconciliation fails
        console.error("[upgrade] Colony reconciliation failed:", reconcileErr);
      }
    }

    return NextResponse.json({
      success: true,
      new_request_id: result.request_id,
      message: "Request successfully upgraded to Atlas schema",
      colony_reconciled: reconcileResult?.reconciled || false,
      colony_message: reconcileResult?.message || null,
    });
  } catch (error) {
    console.error("Error upgrading request:", error);
    return NextResponse.json(
      { error: "Failed to upgrade request" },
      { status: 500 }
    );
  }
}
