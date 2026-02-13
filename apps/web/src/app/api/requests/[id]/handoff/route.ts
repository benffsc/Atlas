import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface HandoffResult {
  original_request_id: string;
  new_request_id: string;
  handoff_status: string;
}

interface ExistingPerson {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * POST /api/requests/[id]/handoff
 *
 * Hands off a request to a new caretaker at a new location.
 * Unlike redirect (which implies the original address was wrong),
 * handoff represents legitimate succession of responsibility.
 *
 * Creates a new request linked to the original with non-overlapping
 * attribution windows to prevent double-counting in Beacon stats.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Require authentication
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id: requestId } = await params;
    const body = await request.json();

    const {
      handoff_reason,
      existing_target_request_id,
      new_address,
      existing_person_id,
      new_requester_first_name,
      new_requester_last_name,
      new_requester_phone,
      new_requester_email,
      summary,
      notes,
      estimated_cat_count,
      // Kitten assessment fields
      has_kittens,
      kitten_count,
      kitten_age_weeks,
      kitten_assessment_status,
      kitten_assessment_outcome,
      kitten_not_needed_reason,
    } = body;

    // Validate required fields
    if (!handoff_reason) {
      return NextResponse.json(
        { error: "Handoff reason is required" },
        { status: 400 }
      );
    }

    // --- Link to existing request path ---
    if (existing_target_request_id) {
      // Verify target request exists and is in a valid state
      const target = await queryOne<{ request_id: string; status: string }>(
        `SELECT request_id, status::TEXT FROM ops.requests WHERE request_id = $1`,
        [existing_target_request_id]
      );
      if (!target) {
        return NextResponse.json({ error: "Target request not found" }, { status: 404 });
      }
      if (["cancelled", "redirected", "handed_off"].includes(target.status)) {
        return NextResponse.json(
          { error: "Target request is already closed and cannot be linked to" },
          { status: 400 }
        );
      }

      // Close original + link to existing target
      await queryOne(
        `UPDATE ops.requests SET
          status = 'handed_off',
          redirected_to_request_id = $2,
          redirect_reason = $3,
          redirect_at = NOW(),
          resolved_at = NOW(),
          transfer_type = 'handoff',
          resolution_notes = $4
        WHERE request_id = $1
          AND status NOT IN ('redirected', 'handed_off', 'cancelled')`,
        [requestId, existing_target_request_id, handoff_reason, `Handed off to existing request ${existing_target_request_id}`]
      );

      // Link target back (only if it doesn't already have a parent)
      await queryOne(
        `UPDATE ops.requests SET
          redirected_from_request_id = $1,
          transfer_type = COALESCE(transfer_type, 'handoff')
        WHERE request_id = $2
          AND redirected_from_request_id IS NULL`,
        [requestId, existing_target_request_id]
      );

      // Audit log
      await queryOne(
        `INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, field_name, new_value, reason, edited_by)
         VALUES ('request', $1, 'field_update', 'status', to_jsonb('handed_off'::TEXT), $2, $3)`,
        [requestId, `Handed off to existing request ${existing_target_request_id}: ${handoff_reason}`, `staff:${session.staff_id}`]
      );

      return NextResponse.json({
        success: true,
        original_request_id: requestId,
        new_request_id: existing_target_request_id,
        handoff_url: `/requests/${existing_target_request_id}`,
      });
    }

    // --- Create new request path (existing behavior) ---
    if (!new_address) {
      return NextResponse.json(
        { error: "New address is required for handoff" },
        { status: 400 }
      );
    }

    // Determine requester details - from existing person or manual entry
    let firstName = new_requester_first_name;
    let lastName = new_requester_last_name;
    let phone = new_requester_phone;
    let email = new_requester_email;

    // If existing person selected, look up their details
    if (existing_person_id) {
      const existingPerson = await queryOne<ExistingPerson>(
        `SELECT first_name, last_name,
          (SELECT id_value FROM sot.person_identifiers
           WHERE person_id = $1 AND id_type = 'email' AND confidence >= 0.5
           ORDER BY confidence DESC NULLS LAST LIMIT 1) as email,
          (SELECT id_value FROM sot.person_identifiers
           WHERE person_id = $1 AND id_type = 'phone' AND confidence >= 0.5
           ORDER BY confidence DESC NULLS LAST LIMIT 1) as phone
         FROM sot.people WHERE person_id = $1`,
        [existing_person_id]
      );
      if (existingPerson) {
        firstName = existingPerson.first_name || firstName;
        lastName = existingPerson.last_name || lastName;
        // Use existing person's contact info if not overridden
        if (!phone) phone = existingPerson.phone;
        if (!email) email = existingPerson.email;
      }
    }

    // Build name in "Last, First" format (Atlas convention)
    const new_requester_name = lastName && firstName
      ? `${lastName}, ${firstName}`
      : lastName || firstName || null;

    if (!new_requester_name) {
      return NextResponse.json(
        { error: "New caretaker name is required (first and last name)" },
        { status: 400 }
      );
    }

    // Call the handoff_request function
    const result = await queryOne<HandoffResult>(
      `SELECT * FROM ops.handoff_request(
        p_original_request_id := $1,
        p_handoff_reason := $2,
        p_new_address := $3,
        p_new_requester_name := $4,
        p_new_requester_phone := $5,
        p_new_requester_email := $6,
        p_summary := $7,
        p_notes := $8,
        p_estimated_cat_count := $9,
        p_created_by := $10,
        p_new_requester_person_id := $11,
        p_has_kittens := $12,
        p_kitten_count := $13,
        p_kitten_age_weeks := $14,
        p_kitten_assessment_status := $15,
        p_kitten_assessment_outcome := $16,
        p_kitten_not_needed_reason := $17
      )`,
      [
        requestId,
        handoff_reason,
        new_address,
        new_requester_name,
        phone || null,
        email || null,
        summary || null,
        notes || null,
        estimated_cat_count || null,
        `staff:${session.staff_id}`,
        existing_person_id || null,
        has_kittens || false,
        kitten_count || null,
        kitten_age_weeks || null,
        kitten_assessment_status || null,
        kitten_assessment_outcome || null,
        kitten_not_needed_reason || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to hand off request" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      original_request_id: result.original_request_id,
      new_request_id: result.new_request_id,
      handoff_url: `/requests/${result.new_request_id}`,
    });
  } catch (error) {
    console.error("Handoff request error:", error);

    // Handle specific error messages from the function
    if (error instanceof Error) {
      const msg = error.message;

      if (msg.includes("not found")) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      }
      if (msg.includes("already been closed")) {
        return NextResponse.json(
          { error: "This request has already been closed and cannot be handed off" },
          { status: 400 }
        );
      }

      // Return the actual error message for debugging
      return NextResponse.json(
        { error: `Failed to hand off request: ${msg}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to hand off request" },
      { status: 500 }
    );
  }
}
