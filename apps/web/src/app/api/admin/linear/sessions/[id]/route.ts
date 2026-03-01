/**
 * Linear Claude Session Single Item API
 *
 * GET   - Get session details
 * PATCH - Update session (add commits, files, PR link)
 * POST  - Complete/pause/resume/abandon session
 */

import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import {
  apiSuccess,
  apiBadRequest,
  apiNotFound,
  apiServerError,
} from "@/lib/api-response";
import {
  getSession,
  updateSessionCommit,
  updateSessionFiles,
  linkSessionToPR,
  completeSession,
  pauseSession,
  resumeSession,
  abandonSession,
  ClaudeSession,
} from "@/lib/linear/claude-session";

// ============================================================================
// GET - Get Session Details
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Try to find by id or session_id
    const session = await queryOne<ClaudeSession>(
      `SELECT s.*,
              i.identifier as issue_identifier,
              i.title as issue_title,
              i.state_name as issue_state_name,
              i.state_type as issue_state_type,
              i.url as issue_url
       FROM ops.linear_claude_sessions s
       LEFT JOIN ops.linear_issues i ON i.linear_id = s.linear_issue_id
       WHERE s.id::text = $1 OR s.session_id = $1
       LIMIT 1`,
      [id]
    );

    if (!session) {
      return apiNotFound("Session", id);
    }

    return apiSuccess({ session });
  } catch (error) {
    console.error("Error fetching session:", error);
    return apiServerError("Failed to fetch session");
  }
}

// ============================================================================
// PATCH - Update Session
// ============================================================================

interface PatchBody {
  commits?: string[];
  files?: string[];
  pr_number?: number;
  pr_url?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: PatchBody = await request.json();

    // Find the session
    const session = await queryOne<{ session_id: string }>(
      `SELECT session_id FROM ops.linear_claude_sessions
       WHERE id::text = $1 OR session_id = $1
       LIMIT 1`,
      [id]
    );

    if (!session) {
      return apiNotFound("Session", id);
    }

    // Update commits
    if (body.commits && body.commits.length > 0) {
      for (const commit of body.commits) {
        await updateSessionCommit(session.session_id, commit);
      }
    }

    // Update files
    if (body.files && body.files.length > 0) {
      await updateSessionFiles(session.session_id, body.files);
    }

    // Link PR
    if (body.pr_number && body.pr_url) {
      await linkSessionToPR(session.session_id, body.pr_number, body.pr_url);
    }

    // Fetch updated session
    const updated = await getSession(id);

    return apiSuccess({ session: updated });
  } catch (error) {
    console.error("Error updating session:", error);
    return apiServerError("Failed to update session");
  }
}

// ============================================================================
// POST - Session Actions (complete, pause, resume, abandon)
// ============================================================================

interface ActionBody {
  action: "complete" | "pause" | "resume" | "abandon";
  summary?: string;
  files_changed?: string[];
  pr_number?: number;
  pr_url?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: ActionBody = await request.json();

    if (!body.action) {
      return apiBadRequest("action is required");
    }

    // Find the session
    const session = await queryOne<{ session_id: string; status: string }>(
      `SELECT session_id, status FROM ops.linear_claude_sessions
       WHERE id::text = $1 OR session_id = $1
       LIMIT 1`,
      [id]
    );

    if (!session) {
      return apiNotFound("Session", id);
    }

    switch (body.action) {
      case "complete":
        const completed = await completeSession(session.session_id, {
          summary: body.summary,
          filesChanged: body.files_changed,
          prNumber: body.pr_number,
          prUrl: body.pr_url,
        });
        return apiSuccess({ session: completed, message: "Session completed" });

      case "pause":
        if (session.status !== "active") {
          return apiBadRequest("Can only pause active sessions");
        }
        await pauseSession(session.session_id);
        const paused = await getSession(id);
        return apiSuccess({ session: paused, message: "Session paused" });

      case "resume":
        if (session.status !== "paused") {
          return apiBadRequest("Can only resume paused sessions");
        }
        await resumeSession(session.session_id);
        const resumed = await getSession(id);
        return apiSuccess({ session: resumed, message: "Session resumed" });

      case "abandon":
        if (!["active", "paused"].includes(session.status)) {
          return apiBadRequest("Can only abandon active or paused sessions");
        }
        await abandonSession(session.session_id);
        const abandoned = await getSession(id);
        return apiSuccess({ session: abandoned, message: "Session abandoned" });

      default:
        return apiBadRequest(`Unknown action: ${body.action}`);
    }
  } catch (error) {
    console.error("Error performing session action:", error);
    return apiServerError("Failed to perform session action");
  }
}
