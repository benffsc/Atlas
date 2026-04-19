import { NextRequest } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";
import { apiSuccess, apiError, apiServerError, apiBadRequest } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

/**
 * GET /api/tippy-tickets
 *
 * List tippy tickets with optional filters.
 * Query params: status, ticket_type, priority, place_id, person_id, cat_id, limit, offset
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams);
  const status = searchParams.get("status");
  const ticketType = searchParams.get("ticket_type");
  const priority = searchParams.get("priority");
  const placeId = searchParams.get("place_id");
  const personId = searchParams.get("person_id");
  const catId = searchParams.get("cat_id");
  const includeResolved = searchParams.get("include_resolved") === "true";

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`t.status = $${paramIdx++}`);
      params.push(status);
    } else if (!includeResolved) {
      conditions.push(`t.status != 'closed'`);
    }

    if (ticketType) {
      conditions.push(`t.ticket_type = $${paramIdx++}`);
      params.push(ticketType);
    }

    if (priority) {
      conditions.push(`t.priority = $${paramIdx++}`);
      params.push(priority);
    }

    if (placeId) {
      conditions.push(`(t.primary_place_id = $${paramIdx} OR t.linked_entities @> $${paramIdx + 1}::jsonb)`);
      params.push(placeId, JSON.stringify([{ entity_id: placeId }]));
      paramIdx += 2;
    }

    if (personId) {
      conditions.push(`(t.primary_person_id = $${paramIdx} OR t.linked_entities @> $${paramIdx + 1}::jsonb)`);
      params.push(personId, JSON.stringify([{ entity_id: personId }]));
      paramIdx += 2;
    }

    if (catId) {
      conditions.push(`(t.primary_cat_id = $${paramIdx} OR t.linked_entities @> $${paramIdx + 1}::jsonb)`);
      params.push(catId, JSON.stringify([{ entity_id: catId }]));
      paramIdx += 2;
    }

    const whereClause = conditions.length > 0
      ? "WHERE " + conditions.join(" AND ")
      : "";

    const tickets = await queryRows<{
      ticket_id: string;
      ticket_type: string;
      status: string;
      priority: string;
      raw_input: string;
      summary: string | null;
      primary_place_id: string | null;
      primary_person_id: string | null;
      primary_cat_id: string | null;
      primary_request_id: string | null;
      linked_entities: unknown[];
      actions_taken: unknown[];
      followup_date: string | null;
      followup_notes: string | null;
      resolved_at: string | null;
      resolution_notes: string | null;
      reported_by: string | null;
      source: string;
      tags: string[];
      created_at: string;
      updated_at: string;
      // Joined display names
      place_name: string | null;
      person_name: string | null;
      cat_name: string | null;
    }>(`
      SELECT
        t.ticket_id::text,
        t.ticket_type,
        t.status,
        t.priority,
        t.raw_input,
        t.summary,
        t.primary_place_id::text,
        t.primary_person_id::text,
        t.primary_cat_id::text,
        t.primary_request_id::text,
        t.linked_entities,
        t.actions_taken,
        t.followup_date::text,
        t.followup_notes,
        t.resolved_at::text,
        t.resolution_notes,
        t.reported_by,
        t.source,
        t.tags,
        t.created_at::text,
        t.updated_at::text,
        COALESCE(p.display_name, p.formatted_address) AS place_name,
        per.display_name AS person_name,
        c.name AS cat_name
      FROM ops.tippy_tickets t
      LEFT JOIN sot.places p ON p.place_id = t.primary_place_id
      LEFT JOIN sot.people per ON per.person_id = t.primary_person_id
      LEFT JOIN sot.cats c ON c.cat_id = t.primary_cat_id
      ${whereClause}
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        CASE t.status
          WHEN 'open' THEN 1
          WHEN 'actioned' THEN 2
          WHEN 'deferred' THEN 3
          WHEN 'closed' THEN 4
        END,
        t.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]);

    const countRow = await queryOne<{ total: number }>(`
      SELECT COUNT(*)::int AS total FROM ops.tippy_tickets t ${whereClause}
    `, params);

    return apiSuccess({
      tickets,
      total: countRow?.total || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching tippy tickets:", error);
    return apiServerError(error instanceof Error ? error.message : "Failed to fetch tickets");
  }
}

/**
 * POST /api/tippy-tickets
 *
 * Create a new tippy ticket.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      ticket_type,
      raw_input,
      summary,
      priority,
      primary_place_id,
      primary_person_id,
      primary_cat_id,
      primary_request_id,
      linked_entities,
      actions_taken,
      followup_date,
      followup_notes,
      reported_by,
      source,
      tags,
      status,
    } = body;

    if (!ticket_type || !raw_input) {
      return apiBadRequest("ticket_type and raw_input are required");
    }

    const validTypes = [
      "person_intel", "site_observation", "site_relationship",
      "cat_return_context", "data_correction", "followup_needed",
      "general_intel",
    ];
    if (!validTypes.includes(ticket_type)) {
      return apiBadRequest(`Invalid ticket_type. Must be one of: ${validTypes.join(", ")}`);
    }

    const ticket = await queryOne<{ ticket_id: string }>(`
      INSERT INTO ops.tippy_tickets (
        ticket_type, status, priority,
        raw_input, summary,
        primary_place_id, primary_person_id, primary_cat_id, primary_request_id,
        linked_entities, actions_taken,
        followup_date, followup_notes,
        reported_by, source, tags
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8, $9,
        $10, $11,
        $12, $13,
        $14, $15, $16
      )
      RETURNING ticket_id::text
    `, [
      ticket_type,
      status || "open",
      priority || "normal",
      raw_input,
      summary || null,
      primary_place_id || null,
      primary_person_id || null,
      primary_cat_id || null,
      primary_request_id || null,
      JSON.stringify(linked_entities || []),
      JSON.stringify(actions_taken || []),
      followup_date || null,
      followup_notes || null,
      reported_by || null,
      source || "staff",
      tags || [],
    ]);

    return apiSuccess({ ticket_id: ticket?.ticket_id });
  } catch (error) {
    console.error("Error creating tippy ticket:", error);
    return apiServerError(error instanceof Error ? error.message : "Failed to create ticket");
  }
}

/**
 * PATCH /api/tippy-tickets
 *
 * Update a tippy ticket. Requires ticket_id in body.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticket_id, ...updates } = body;

    if (!ticket_id) {
      return apiBadRequest("ticket_id is required");
    }

    const setClauses: string[] = [];
    const params: unknown[] = [ticket_id];
    let paramIdx = 2;

    const allowedFields = [
      "status", "priority", "summary", "ticket_type",
      "primary_place_id", "primary_person_id", "primary_cat_id", "primary_request_id",
      "linked_entities", "actions_taken",
      "followup_date", "followup_notes",
      "resolved_at", "resolution_notes",
      "reported_by", "tags",
    ];

    for (const field of allowedFields) {
      if (field in updates) {
        const value = ["linked_entities", "actions_taken"].includes(field)
          ? JSON.stringify(updates[field])
          : updates[field];
        setClauses.push(`${field} = $${paramIdx++}`);
        params.push(value);
      }
    }

    if (updates.status === "closed" && !updates.resolved_at) {
      setClauses.push(`resolved_at = NOW()`);
    }

    if (setClauses.length === 0) {
      return apiBadRequest("No valid fields to update");
    }

    setClauses.push("updated_at = NOW()");

    const result = await execute(`
      UPDATE ops.tippy_tickets
      SET ${setClauses.join(", ")}
      WHERE ticket_id = $1
    `, params);

    if (result.rowCount === 0) {
      return apiError("Ticket not found", 404);
    }

    return apiSuccess({ updated: true });
  } catch (error) {
    console.error("Error updating tippy ticket:", error);
    return apiServerError(error instanceof Error ? error.message : "Failed to update ticket");
  }
}
