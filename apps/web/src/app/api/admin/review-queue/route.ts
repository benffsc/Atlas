import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiError, apiBadRequest } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

// GET — list pending review queue items
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const { limit, offset } = parsePagination(searchParams);
    const issueType = searchParams.get("issue_type") || "";
    const status = searchParams.get("status") || "pending";

    let whereClause = "WHERE q.status = $1";
    const params: (string | number)[] = [status];
    let paramIndex = 2;

    if (issueType) {
      whereClause += ` AND q.issue_type = $${paramIndex}`;
      params.push(issueType);
      paramIndex++;
    }

    const countResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::INT as count FROM ops.data_quality_review_queue q ${whereClause}`,
      params
    );

    params.push(limit, offset);
    const items = await queryRows(
      `SELECT
        q.id,
        q.entity_type,
        q.entity_id,
        q.issue_type,
        q.suggested_action,
        q.details,
        q.status,
        q.reviewed_by,
        q.reviewed_at,
        q.created_at,
        -- Enrich with entity details
        CASE q.entity_type
          WHEN 'appointment' THEN (
            SELECT jsonb_build_object(
              'appointment_date', a.appointment_date,
              'client_name', a.client_name,
              'owner_email', a.owner_email,
              'owner_phone', a.owner_phone,
              'owner_address', a.owner_address,
              'inferred_place_id', a.inferred_place_id
            )
            FROM ops.appointments a WHERE a.appointment_id = q.entity_id
          )
          ELSE NULL
        END as entity_details,
        -- For appointment-request matches, get request info
        CASE WHEN q.details->>'request_id' IS NOT NULL THEN (
          SELECT jsonb_build_object(
            'summary', r.summary,
            'status', r.status,
            'place_address', p.formatted_address
          )
          FROM ops.requests r
          LEFT JOIN sot.places p ON p.place_id = r.place_id
          WHERE r.request_id = (q.details->>'request_id')::UUID
        ) ELSE NULL END as request_details
      FROM ops.data_quality_review_queue q
      ${whereClause}
      ORDER BY q.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return NextResponse.json(
      apiSuccess({
        items,
        total: countResult?.count || 0,
        limit,
        offset,
      })
    );
  } catch (err) {
    return NextResponse.json(
      apiError(err instanceof Error ? err.message : "Unknown error", 500)
    );
  }
}

// PATCH — approve or dismiss a review queue item
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action, reviewed_by } = body as {
      id: string;
      action: "approve" | "dismiss";
      reviewed_by?: string;
    };

    if (!id || !action) {
      return NextResponse.json(apiBadRequest("id and action required"), {
        status: 400,
      });
    }

    if (action !== "approve" && action !== "dismiss") {
      return NextResponse.json(apiBadRequest("action must be approve or dismiss"), {
        status: 400,
      });
    }

    // Get the queue item
    const item = await queryOne<{
      id: string;
      entity_type: string;
      entity_id: string;
      issue_type: string;
      details: Record<string, unknown>;
    }>(
      `SELECT id, entity_type, entity_id, issue_type, details
       FROM ops.data_quality_review_queue WHERE id = $1 AND status = 'pending'`,
      [id]
    );

    if (!item) {
      return apiBadRequest("Item not found or already reviewed");
    }

    if (action === "approve") {
      // Handle different issue types
      if (item.issue_type === "potential_request_match") {
        // Appointment-request link: update appointment.request_id
        const requestId = item.details?.request_id as string;
        if (requestId) {
          await queryOne(
            `UPDATE ops.appointments SET request_id = $1, updated_at = NOW()
             WHERE appointment_id = $2 AND request_id IS NULL`,
            [requestId, item.entity_id]
          );
        }
      } else if (item.issue_type === "phone_address_mismatch") {
        // Phone-based person link: update appointment.person_id
        const personId = item.details?.person_id as string;
        if (personId) {
          await queryOne(
            `UPDATE ops.appointments SET person_id = $1, updated_at = NOW()
             WHERE appointment_id = $2 AND person_id IS NULL`,
            [personId, item.entity_id]
          );
        }
      }
    }

    // Mark as reviewed
    await queryOne(
      `UPDATE ops.data_quality_review_queue
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3`,
      [action === "approve" ? "approved" : "dismissed", reviewed_by || "staff", id]
    );

    return NextResponse.json(apiSuccess({ id, action, status: "done" }));
  } catch (err) {
    return NextResponse.json(
      apiError(err instanceof Error ? err.message : "Unknown error", 500)
    );
  }
}
