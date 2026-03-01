/**
 * Linear Issues List & Create API
 *
 * GET  - List issues with filtering
 * POST - Create new issue in Linear
 */

import { NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getLinearClient } from "@/lib/linear/client";
import {
  apiSuccess,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";

// ============================================================================
// GET - List Issues
// ============================================================================

interface IssueRow {
  id: string;
  linear_id: string;
  identifier: string;
  title: string;
  description: string | null;
  state_name: string | null;
  state_type: string | null;
  priority: number | null;
  priority_label: string | null;
  project_name: string | null;
  cycle_name: string | null;
  assignee_name: string | null;
  labels: object;
  estimate: number | null;
  due_date: string | null;
  url: string | null;
  atlas_request_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const { limit, offset } = parsePagination(searchParams);

    // Filters
    const stateType = searchParams.get("state_type");
    const projectId = searchParams.get("project_id");
    const cycleId = searchParams.get("cycle_id");
    const assigneeId = searchParams.get("assignee_id");
    const search = searchParams.get("q");
    const linked = searchParams.get("linked"); // 'true', 'false', or null

    // Build query
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (stateType) {
      conditions.push(`state_type = $${paramIndex++}`);
      params.push(stateType);
    }

    if (projectId) {
      conditions.push(`project_id = $${paramIndex++}`);
      params.push(projectId);
    }

    if (cycleId) {
      conditions.push(`cycle_id = $${paramIndex++}`);
      params.push(cycleId);
    }

    if (assigneeId) {
      conditions.push(`assignee_id = $${paramIndex++}`);
      params.push(assigneeId);
    }

    if (search) {
      conditions.push(`(title ILIKE $${paramIndex} OR identifier ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (linked === "true") {
      conditions.push(`atlas_request_id IS NOT NULL`);
    } else if (linked === "false") {
      conditions.push(`atlas_request_id IS NULL`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) FROM ops.linear_issues ${whereClause}`,
      params
    );
    const total = parseInt(countResult?.count || "0", 10);

    // Get issues
    params.push(limit, offset);
    const result = await query<IssueRow>(
      `SELECT
         id, linear_id, identifier, title, description,
         state_name, state_type, priority, priority_label,
         project_name, cycle_name, assignee_name,
         labels, estimate, due_date, url,
         atlas_request_id, created_at, updated_at, completed_at
       FROM ops.linear_issues
       ${whereClause}
       ORDER BY
         CASE state_type
           WHEN 'started' THEN 1
           WHEN 'unstarted' THEN 2
           WHEN 'backlog' THEN 3
           WHEN 'completed' THEN 4
           WHEN 'canceled' THEN 5
           ELSE 6
         END,
         priority ASC NULLS LAST,
         updated_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return apiSuccess({
      issues: result.rows,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching Linear issues:", error);
    return apiServerError("Failed to fetch issues");
  }
}

// ============================================================================
// POST - Create Issue
// ============================================================================

interface CreateIssueBody {
  title: string;
  description?: string;
  projectId?: string;
  cycleId?: string;
  assigneeId?: string;
  priority?: number;
  estimate?: number;
  dueDate?: string;
  labelIds?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateIssueBody = await request.json();

    if (!body.title?.trim()) {
      return apiBadRequest("title is required");
    }

    // Get team ID (we need this for Linear API)
    const client = getLinearClient();
    const teams = await client.getTeams();

    if (teams.length === 0) {
      return apiServerError("No Linear teams found");
    }

    // Use first team (Atlas likely has one team)
    const teamId = teams[0].id;

    // Create issue in Linear
    const issue = await client.createIssue({
      title: body.title.trim(),
      description: body.description,
      teamId,
      projectId: body.projectId,
      cycleId: body.cycleId,
      assigneeId: body.assigneeId,
      priority: body.priority,
      estimate: body.estimate,
      dueDate: body.dueDate,
      labelIds: body.labelIds,
    });

    if (!issue) {
      return apiServerError("Failed to create issue in Linear");
    }

    // Store in our database
    await query(
      `INSERT INTO ops.linear_issues (
         linear_id, identifier, title, description,
         state_id, state_name, state_type,
         priority, priority_label,
         project_id, project_name,
         cycle_id, cycle_name,
         assignee_id, assignee_name,
         creator_id, creator_name,
         labels, estimate, due_date,
         created_at, updated_at, url, synced_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW()
       )
       ON CONFLICT (linear_id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         synced_at = NOW()`,
      [
        issue.id,
        issue.identifier,
        issue.title,
        issue.description,
        issue.state?.id,
        issue.state?.name,
        issue.state?.type,
        issue.priority,
        issue.priorityLabel,
        issue.project?.id,
        issue.project?.name,
        issue.cycle?.id,
        issue.cycle?.name,
        issue.assignee?.id,
        issue.assignee?.name,
        issue.creator?.id,
        issue.creator?.name,
        JSON.stringify(issue.labels?.nodes?.map((l) => ({ id: l.id, name: l.name, color: l.color })) || []),
        issue.estimate,
        issue.dueDate,
        issue.createdAt,
        issue.updatedAt,
        issue.url,
      ]
    );

    return apiSuccess({
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
      },
    });
  } catch (error) {
    console.error("Error creating Linear issue:", error);
    return apiServerError("Failed to create issue");
  }
}
