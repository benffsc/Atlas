import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface RequestDetailRow {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  notes: string | null;
  legacy_notes: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  cats_are_friendly: boolean | null;
  preferred_contact_method: string | null;
  assigned_to: string | null;
  scheduled_date: string | null;
  scheduled_time_range: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  cats_trapped: number | null;
  cats_returned: number | null;
  data_source: string;
  source_system: string | null;
  source_record_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  place_id: string | null;
  place_name: string | null;
  place_address: string | null;
  place_kind: string | null;
  place_city: string | null;
  place_postal_code: string | null;
  place_coordinates: { lat: number; lng: number } | null;
  requester_person_id: string | null;
  requester_name: string | null;
  // Verified counts (computed from ClinicHQ linkage)
  linked_cat_count: number | null;
  verified_altered_count: number | null;
  verified_intact_count: number | null;
  unverified_count: number | null;
  verification_completeness: string | null;
  cats: object[] | null;
}

export async function GET(
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
    const sql = `
      SELECT *
      FROM trapper.v_request_detail
      WHERE request_id = $1
    `;

    const requestDetail = await queryOne<RequestDetailRow>(sql, [id]);

    if (!requestDetail) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(requestDetail);
  } catch (error) {
    console.error("Error fetching request detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch request detail" },
      { status: 500 }
    );
  }
}

// Valid status and priority values
const VALID_STATUSES = ["new", "triaged", "scheduled", "in_progress", "completed", "cancelled", "on_hold"];
const VALID_PRIORITIES = ["urgent", "high", "normal", "low"];

interface UpdateRequestBody {
  status?: string;
  priority?: string;
  summary?: string;
  notes?: string;
  estimated_cat_count?: number;
  has_kittens?: boolean;
  cats_are_friendly?: boolean;
  preferred_contact_method?: string;
  assigned_to?: string;
  scheduled_date?: string;
  scheduled_time_range?: string;
  resolution_notes?: string;
  cats_trapped?: number;
  cats_returned?: number;
}

export async function PATCH(
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
    const body: UpdateRequestBody = await request.json();

    // Validate status if provided
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate priority if provided
    if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
      return NextResponse.json(
        { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` },
        { status: 400 }
      );
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.status !== undefined) {
      updates.push(`status = $${paramIndex}::trapper.request_status`);
      values.push(body.status);
      paramIndex++;
    }

    if (body.priority !== undefined) {
      updates.push(`priority = $${paramIndex}::trapper.request_priority`);
      values.push(body.priority);
      paramIndex++;
    }

    if (body.summary !== undefined) {
      updates.push(`summary = $${paramIndex}`);
      values.push(body.summary || null);
      paramIndex++;
    }

    if (body.notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      values.push(body.notes || null);
      paramIndex++;
    }

    if (body.estimated_cat_count !== undefined) {
      updates.push(`estimated_cat_count = $${paramIndex}`);
      values.push(body.estimated_cat_count);
      paramIndex++;
    }

    if (body.has_kittens !== undefined) {
      updates.push(`has_kittens = $${paramIndex}`);
      values.push(body.has_kittens);
      paramIndex++;
    }

    if (body.cats_are_friendly !== undefined) {
      updates.push(`cats_are_friendly = $${paramIndex}`);
      values.push(body.cats_are_friendly);
      paramIndex++;
    }

    if (body.preferred_contact_method !== undefined) {
      updates.push(`preferred_contact_method = $${paramIndex}`);
      values.push(body.preferred_contact_method || null);
      paramIndex++;
    }

    if (body.assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramIndex}`);
      values.push(body.assigned_to || null);
      paramIndex++;
    }

    if (body.scheduled_date !== undefined) {
      updates.push(`scheduled_date = $${paramIndex}`);
      values.push(body.scheduled_date || null);
      paramIndex++;
    }

    if (body.scheduled_time_range !== undefined) {
      updates.push(`scheduled_time_range = $${paramIndex}`);
      values.push(body.scheduled_time_range || null);
      paramIndex++;
    }

    if (body.resolution_notes !== undefined) {
      updates.push(`resolution_notes = $${paramIndex}`);
      values.push(body.resolution_notes || null);
      paramIndex++;
    }

    if (body.cats_trapped !== undefined) {
      updates.push(`cats_trapped = $${paramIndex}`);
      values.push(body.cats_trapped);
      paramIndex++;
    }

    if (body.cats_returned !== undefined) {
      updates.push(`cats_returned = $${paramIndex}`);
      values.push(body.cats_returned);
      paramIndex++;
    }

    // Handle status changes that trigger resolved_at
    if (body.status === "completed" || body.status === "cancelled") {
      updates.push(`resolved_at = COALESCE(resolved_at, NOW())`);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add request_id to values
    values.push(id);

    const sql = `
      UPDATE trapper.sot_requests
      SET ${updates.join(", ")}
      WHERE request_id = $${paramIndex}
      RETURNING request_id, status, priority, updated_at
    `;

    const result = await queryOne<{
      request_id: string;
      status: string;
      priority: string;
      updated_at: string;
    }>(sql, values);

    if (!result) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      request: result,
    });
  } catch (error) {
    console.error("Error updating request:", error);
    return NextResponse.json(
      { error: "Failed to update request" },
      { status: 500 }
    );
  }
}
