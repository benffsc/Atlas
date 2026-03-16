import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { apiSuccess, apiServerError, apiBadRequest, apiNotFound } from "@/lib/api-response";

interface ColonyDetail {
  colony_id: string;
  colony_name: string;
  status: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  place_count: number;
  request_count: number;
  total_linked_cats: number;
  linked_community_cats: number;
  linked_owned_cats: number;
  linked_community_altered: number;
  linked_community_unaltered: number;
  observation_total_cats: number | null;
  total_cats_confidence: string | null;
  observation_fixed_cats: number | null;
  fixed_cats_confidence: string | null;
  latest_observation_date: string | null;
  has_count_discrepancy: boolean;
  discrepancy_amount: number | null;
}

interface LinkedPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  relationship_type: string;
  is_primary: boolean;
  added_by: string;
  added_at: string;
}

interface LinkedRequest {
  request_id: string;
  requester_name: string | null;
  formatted_address: string;
  status: string;
  estimated_cat_count: number | null;
  added_by: string;
  added_at: string;
}

interface Observation {
  observation_id: string;
  observation_date: string;
  total_cats: number | null;
  total_cats_confidence: string | null;
  fixed_cats: number | null;
  fixed_cats_confidence: string | null;
  unfixed_cats: number | null;
  notes: string | null;
  observed_by: string;
  created_at: string;
}

// GET /api/colonies/[id] - Get colony details with linked data
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get colony stats
    const colony = await queryOne<ColonyDetail>(
      `SELECT
        colony_id,
        name AS colony_name,
        colony_status AS status,
        description AS notes,
        created_at,
        updated_at,
        place_count,
        request_count,
        total_linked_cats,
        linked_community_cats,
        linked_owned_cats,
        linked_community_altered,
        linked_community_unaltered,
        observation_total_cats,
        total_cats_confidence,
        observation_fixed_cats,
        fixed_cats_confidence,
        latest_observation_date,
        has_count_discrepancy,
        discrepancy_amount
      FROM ops.v_colony_stats
      WHERE colony_id = $1`,
      [id]
    );

    if (!colony) {
      return apiNotFound("colony", id);
    }

    // Get linked places
    const places = await queryRows<LinkedPlace>(
      `SELECT
        cp.place_id,
        p.display_name,
        p.formatted_address,
        cp.relationship_type,
        cp.is_primary,
        cp.added_by,
        cp.added_at
      FROM sot.colony_places cp
      JOIN sot.places p ON p.place_id = cp.place_id
      WHERE cp.colony_id = $1
      ORDER BY cp.is_primary DESC, p.formatted_address`,
      [id]
    );

    // Get linked requests
    const requests = await queryRows<LinkedRequest>(
      `SELECT
        cr.request_id,
        rq.requester_name,
        p.formatted_address,
        r.status,
        r.estimated_cat_count,
        cr.added_by,
        cr.added_at
      FROM sot.colony_requests cr
      JOIN ops.requests r ON r.request_id = cr.request_id
      LEFT JOIN sot.places p ON p.place_id = r.place_id
      LEFT JOIN sot.people rq ON rq.person_id = r.requester_person_id
      WHERE cr.colony_id = $1
      ORDER BY cr.added_at DESC`,
      [id]
    );

    // Get observations
    const observations = await queryRows<Observation>(
      `SELECT
        observation_id,
        observation_date,
        total_cats,
        total_cats_confidence,
        fixed_cats,
        fixed_cats_confidence,
        unfixed_cats,
        notes,
        observed_by,
        created_at
      FROM sot.colony_observations
      WHERE colony_id = $1
      ORDER BY observation_date DESC, created_at DESC
      LIMIT 20`,
      [id]
    );

    return apiSuccess({ ...colony, places, requests, observations });
  } catch (error) {
    console.error("Error fetching colony:", error);
    return apiServerError("Failed to fetch colony");
  }
}

// PATCH /api/colonies/[id] - Update colony
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { colony_name, status, notes } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIndex = 1;

    if (colony_name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(colony_name?.trim() || null);
    }

    if (status !== undefined) {
      const validStatuses = ["active", "monitored", "resolved", "inactive"];
      if (!validStatuses.includes(status)) {
        return apiBadRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      }
      updates.push(`colony_status = $${paramIndex++}`);
      values.push(status);
    }

    if (notes !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(notes?.trim() || null);
    }

    if (updates.length === 0) {
      return apiBadRequest("No fields to update");
    }

    values.push(id);

    const result = await queryOne<{ colony_id: string }>(
      `UPDATE sot.colonies
       SET ${updates.join(", ")}
       WHERE colony_id = $${paramIndex}
       RETURNING colony_id`,
      values
    );

    if (!result) {
      return apiNotFound("colony", id);
    }

    return apiSuccess({ colony_id: result.colony_id });
  } catch (error) {
    console.error("Error updating colony:", error);
    return apiServerError("Failed to update colony");
  }
}

// DELETE /api/colonies/[id] - Delete colony
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await queryOne<{ colony_id: string }>(
      `DELETE FROM sot.colonies WHERE colony_id = $1 RETURNING colony_id`,
      [id]
    );

    if (!result) {
      return apiNotFound("colony", id);
    }

    return apiSuccess({ deleted: true });
  } catch (error) {
    console.error("Error deleting colony:", error);
    return apiServerError("Failed to delete colony");
  }
}
