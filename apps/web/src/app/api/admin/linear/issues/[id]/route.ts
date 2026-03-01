/**
 * Linear Single Issue API
 *
 * GET   - Get issue details
 * PATCH - Update issue
 */

import { NextRequest } from "next/server";
import { queryOne, query } from "@/lib/db";
import { getLinearClient } from "@/lib/linear/client";
import {
  apiSuccess,
  apiBadRequest,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";

// ============================================================================
// Types
// ============================================================================

interface IssueDetailRow {
  id: string;
  linear_id: string;
  identifier: string;
  title: string;
  description: string | null;
  state_id: string | null;
  state_name: string | null;
  state_type: string | null;
  priority: number | null;
  priority_label: string | null;
  project_id: string | null;
  project_name: string | null;
  cycle_id: string | null;
  cycle_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  labels: object;
  estimate: number | null;
  due_date: string | null;
  url: string | null;
  atlas_request_id: string | null;
  atlas_linked_at: string | null;
  atlas_linked_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  archived_at: string | null;
  synced_at: string;
}

// ============================================================================
// GET - Get Issue
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Try to find by linear_id or identifier
    const issue = await queryOne<IssueDetailRow>(
      `SELECT * FROM ops.linear_issues
       WHERE linear_id = $1 OR identifier = $1
       LIMIT 1`,
      [id]
    );

    if (!issue) {
      return apiNotFound("Issue", id);
    }

    // Get linked Atlas request details if any
    let linkedRequest = null;
    if (issue.atlas_request_id) {
      linkedRequest = await queryOne<{
        request_id: string;
        status: string;
        place_display_name: string;
      }>(
        `SELECT r.request_id, r.status, p.display_name as place_display_name
         FROM ops.requests r
         LEFT JOIN sot.places p ON p.place_id = r.place_id
         WHERE r.request_id = $1`,
        [issue.atlas_request_id]
      );
    }

    return apiSuccess({
      issue,
      linkedRequest,
    });
  } catch (error) {
    console.error("Error fetching Linear issue:", error);
    return apiServerError("Failed to fetch issue");
  }
}

// ============================================================================
// PATCH - Update Issue
// ============================================================================

interface UpdateIssueBody {
  title?: string;
  description?: string;
  projectId?: string;
  cycleId?: string;
  assigneeId?: string;
  priority?: number;
  estimate?: number;
  dueDate?: string;
  labelIds?: string[];
  stateId?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdateIssueBody = await request.json();

    // Find the issue
    const existing = await queryOne<{ linear_id: string }>(
      `SELECT linear_id FROM ops.linear_issues
       WHERE linear_id = $1 OR identifier = $1
       LIMIT 1`,
      [id]
    );

    if (!existing) {
      return apiNotFound("Issue", id);
    }

    // Build update input (only include provided fields)
    const updateInput: Record<string, unknown> = {};
    if (body.title !== undefined) updateInput.title = body.title;
    if (body.description !== undefined) updateInput.description = body.description;
    if (body.projectId !== undefined) updateInput.projectId = body.projectId;
    if (body.cycleId !== undefined) updateInput.cycleId = body.cycleId;
    if (body.assigneeId !== undefined) updateInput.assigneeId = body.assigneeId;
    if (body.priority !== undefined) updateInput.priority = body.priority;
    if (body.estimate !== undefined) updateInput.estimate = body.estimate;
    if (body.dueDate !== undefined) updateInput.dueDate = body.dueDate;
    if (body.labelIds !== undefined) updateInput.labelIds = body.labelIds;
    if (body.stateId !== undefined) updateInput.stateId = body.stateId;

    if (Object.keys(updateInput).length === 0) {
      return apiBadRequest("No fields to update");
    }

    // Update in Linear
    const client = getLinearClient();
    const updated = await client.updateIssue(existing.linear_id, updateInput);

    if (!updated) {
      return apiServerError("Failed to update issue in Linear");
    }

    // Update our local cache
    await query(
      `UPDATE ops.linear_issues SET
         title = $2,
         description = $3,
         state_id = $4,
         state_name = $5,
         state_type = $6,
         priority = $7,
         priority_label = $8,
         project_id = $9,
         project_name = $10,
         cycle_id = $11,
         cycle_name = $12,
         assignee_id = $13,
         assignee_name = $14,
         labels = $15,
         estimate = $16,
         due_date = $17,
         updated_at = $18,
         started_at = $19,
         completed_at = $20,
         canceled_at = $21,
         synced_at = NOW()
       WHERE linear_id = $1`,
      [
        existing.linear_id,
        updated.title,
        updated.description,
        updated.state?.id,
        updated.state?.name,
        updated.state?.type,
        updated.priority,
        updated.priorityLabel,
        updated.project?.id,
        updated.project?.name,
        updated.cycle?.id,
        updated.cycle?.name,
        updated.assignee?.id,
        updated.assignee?.name,
        JSON.stringify(updated.labels?.nodes?.map((l) => ({ id: l.id, name: l.name, color: l.color })) || []),
        updated.estimate,
        updated.dueDate,
        updated.updatedAt,
        updated.startedAt,
        updated.completedAt,
        updated.canceledAt,
      ]
    );

    return apiSuccess({
      issue: {
        linear_id: updated.id,
        identifier: updated.identifier,
        title: updated.title,
        state_name: updated.state?.name,
        url: updated.url,
      },
    });
  } catch (error) {
    console.error("Error updating Linear issue:", error);
    return apiServerError("Failed to update issue");
  }
}
