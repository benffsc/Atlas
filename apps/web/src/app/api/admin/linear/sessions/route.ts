/**
 * Linear Claude Sessions List & Create API
 *
 * GET  - List sessions with filtering
 * POST - Start a new Claude Code session
 */

import { NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { parsePagination } from "@/lib/api-validation";
import { startClaudeSession } from "@/lib/linear/claude-session";

// ============================================================================
// Types
// ============================================================================

interface SessionRow {
  id: string;
  session_id: string;
  linear_issue_id: string | null;
  branch_name: string | null;
  commit_hashes: string[] | null;
  pr_number: number | null;
  pr_url: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  files_changed: string[] | null;
  metadata: object;
  // Joined fields
  issue_identifier: string | null;
  issue_title: string | null;
  issue_state_name: string | null;
  issue_state_type: string | null;
}

// ============================================================================
// GET - List Sessions
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const { limit, offset } = parsePagination(searchParams);

    // Filters
    const status = searchParams.get("status");
    const issueId = searchParams.get("issue_id");
    const search = searchParams.get("q");

    // Build query
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`s.status = $${paramIndex++}`);
      params.push(status);
    }

    if (issueId) {
      conditions.push(`s.linear_issue_id = $${paramIndex++}`);
      params.push(issueId);
    }

    if (search) {
      conditions.push(
        `(s.branch_name ILIKE $${paramIndex} OR s.session_id ILIKE $${paramIndex} OR i.identifier ILIKE $${paramIndex} OR i.title ILIKE $${paramIndex})`
      );
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) FROM ops.linear_claude_sessions s
       LEFT JOIN ops.linear_issues i ON i.linear_id = s.linear_issue_id
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult?.count || "0", 10);

    // Get sessions
    params.push(limit, offset);
    const result = await query<SessionRow>(
      `SELECT
         s.id,
         s.session_id,
         s.linear_issue_id,
         s.branch_name,
         s.commit_hashes,
         s.pr_number,
         s.pr_url,
         s.status,
         s.started_at,
         s.completed_at,
         s.summary,
         s.files_changed,
         s.metadata,
         i.identifier as issue_identifier,
         i.title as issue_title,
         i.state_name as issue_state_name,
         i.state_type as issue_state_type
       FROM ops.linear_claude_sessions s
       LEFT JOIN ops.linear_issues i ON i.linear_id = s.linear_issue_id
       ${whereClause}
       ORDER BY s.started_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return apiSuccess({
      sessions: result.rows,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching Linear sessions:", error);
    return apiServerError("Failed to fetch sessions");
  }
}

// ============================================================================
// POST - Start New Session
// ============================================================================

interface CreateSessionBody {
  session_id: string;
  branch_name?: string;
  linear_issue_id?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateSessionBody = await request.json();

    if (!body.session_id?.trim()) {
      return apiBadRequest("session_id is required");
    }

    const session = await startClaudeSession({
      sessionId: body.session_id.trim(),
      branchName: body.branch_name,
      linearIssueId: body.linear_issue_id,
      metadata: body.metadata,
    });

    return apiSuccess({ session });
  } catch (error) {
    console.error("Error creating Claude session:", error);
    return apiServerError("Failed to create session");
  }
}
