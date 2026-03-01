/**
 * Claude Code Session Integration for Linear
 *
 * Manages the lifecycle of Claude Code development sessions linked to Linear issues.
 *
 * Branch naming convention: feat/ATL-123-description or fix/ATL-456-bug-fix
 * Session auto-links to issue ATL-123 or ATL-456 if found in branch name.
 *
 * @example
 * // Start a new session
 * const session = await startClaudeSession({
 *   sessionId: "abc123",
 *   branchName: "feat/ATL-42-add-user-auth",
 * });
 *
 * // Update session with commit
 * await updateSessionCommit(session.id, "a1b2c3d");
 *
 * // Complete session
 * await completeSession(session.id, "Implemented user authentication with JWT");
 */

import { query, queryOne } from "@/lib/db";
import { getLinearClient } from "./client";

// ============================================================================
// Types
// ============================================================================

export interface ClaudeSession {
  id: string;
  session_id: string;
  linear_issue_id: string | null;
  branch_name: string | null;
  commit_hashes: string[] | null;
  pr_number: number | null;
  pr_url: string | null;
  status: "active" | "paused" | "completed" | "abandoned";
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  files_changed: string[] | null;
  metadata: Record<string, unknown>;
}

export interface StartSessionOptions {
  sessionId: string;
  branchName?: string;
  linearIssueId?: string;
  metadata?: Record<string, unknown>;
}

export interface CompleteSessionOptions {
  summary?: string;
  filesChanged?: string[];
  prNumber?: number;
  prUrl?: string;
}

// ============================================================================
// Branch Parsing
// ============================================================================

/**
 * Extracts Linear issue identifier from branch name.
 * Supports formats like:
 * - feat/ATL-123-description
 * - fix/ATL-456-bug-fix
 * - ATL-789
 * - feature/ATL-123
 */
export function parseIssueFromBranch(branchName: string): string | null {
  // Match patterns like ATL-123, LIN-456, etc.
  const match = branchName.match(/([A-Z]{2,5}-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extracts description from branch name after the issue identifier.
 */
export function parseBranchDescription(branchName: string): string | null {
  // Remove prefix (feat/, fix/, etc.) and issue ID, get remaining description
  const cleaned = branchName
    .replace(/^(feat|fix|feature|bugfix|hotfix|chore|docs|refactor|test|ci)\//i, "")
    .replace(/[A-Z]{2,5}-\d+[-_]?/i, "")
    .replace(/[-_]/g, " ")
    .trim();

  return cleaned || null;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Starts a new Claude Code session.
 * If branchName contains a Linear issue identifier, links to that issue.
 * If linearIssueId is provided, uses that directly.
 */
export async function startClaudeSession(options: StartSessionOptions): Promise<ClaudeSession> {
  const { sessionId, branchName, linearIssueId, metadata = {} } = options;

  // Check for existing active session with same sessionId
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM ops.linear_claude_sessions
     WHERE session_id = $1 AND status = 'active'`,
    [sessionId]
  );

  if (existing) {
    // Return existing active session
    const session = await queryOne<ClaudeSession>(
      `SELECT * FROM ops.linear_claude_sessions WHERE id = $1`,
      [existing.id]
    );
    if (session) return session;
  }

  // Determine Linear issue to link
  let issueId = linearIssueId || null;

  if (!issueId && branchName) {
    const issueIdentifier = parseIssueFromBranch(branchName);
    if (issueIdentifier) {
      // Look up the issue by identifier
      const issue = await queryOne<{ linear_id: string }>(
        `SELECT linear_id FROM ops.linear_issues WHERE identifier = $1`,
        [issueIdentifier]
      );
      if (issue) {
        issueId = issue.linear_id;
      }
    }
  }

  // Create the session
  const result = await queryOne<ClaudeSession>(
    `INSERT INTO ops.linear_claude_sessions (
       session_id, linear_issue_id, branch_name, status, metadata
     ) VALUES ($1, $2, $3, 'active', $4)
     RETURNING *`,
    [sessionId, issueId, branchName, JSON.stringify(metadata)]
  );

  if (!result) {
    throw new Error("Failed to create Claude session");
  }

  // If linked to an issue, optionally add a comment to Linear
  if (issueId && result) {
    try {
      const client = getLinearClient();
      await client.createComment(
        issueId,
        `Claude Code session started${branchName ? ` on branch \`${branchName}\`` : ""}`
      );
    } catch {
      // Non-critical - don't fail session creation if comment fails
      console.warn("Failed to add session start comment to Linear");
    }
  }

  return result;
}

/**
 * Updates a session with a new commit hash.
 */
export async function updateSessionCommit(
  sessionId: string,
  commitHash: string
): Promise<void> {
  await query(
    `UPDATE ops.linear_claude_sessions
     SET commit_hashes = array_append(COALESCE(commit_hashes, ARRAY[]::text[]), $2)
     WHERE session_id = $1 AND status = 'active'`,
    [sessionId, commitHash]
  );
}

/**
 * Updates a session with changed files.
 */
export async function updateSessionFiles(
  sessionId: string,
  files: string[]
): Promise<void> {
  await query(
    `UPDATE ops.linear_claude_sessions
     SET files_changed = (
       SELECT array_agg(DISTINCT f)
       FROM unnest(COALESCE(files_changed, ARRAY[]::text[]) || $2::text[]) AS f
     )
     WHERE session_id = $1 AND status = 'active'`,
    [sessionId, files]
  );
}

/**
 * Links a session to a PR.
 */
export async function linkSessionToPR(
  sessionId: string,
  prNumber: number,
  prUrl: string
): Promise<void> {
  await query(
    `UPDATE ops.linear_claude_sessions
     SET pr_number = $2, pr_url = $3
     WHERE session_id = $1 AND status IN ('active', 'paused')`,
    [sessionId, prNumber, prUrl]
  );
}

/**
 * Pauses an active session.
 */
export async function pauseSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE ops.linear_claude_sessions
     SET status = 'paused'
     WHERE session_id = $1 AND status = 'active'`,
    [sessionId]
  );
}

/**
 * Resumes a paused session.
 */
export async function resumeSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE ops.linear_claude_sessions
     SET status = 'active'
     WHERE session_id = $1 AND status = 'paused'`,
    [sessionId]
  );
}

/**
 * Marks a session as abandoned.
 */
export async function abandonSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE ops.linear_claude_sessions
     SET status = 'abandoned', completed_at = NOW()
     WHERE session_id = $1 AND status IN ('active', 'paused')`,
    [sessionId]
  );
}

/**
 * Completes a Claude Code session.
 * Adds a summary comment to the linked Linear issue if any.
 */
export async function completeSession(
  sessionId: string,
  options: CompleteSessionOptions = {}
): Promise<ClaudeSession | null> {
  const { summary, filesChanged, prNumber, prUrl } = options;

  // Get the session
  const session = await queryOne<ClaudeSession>(
    `SELECT * FROM ops.linear_claude_sessions
     WHERE session_id = $1 AND status IN ('active', 'paused')`,
    [sessionId]
  );

  if (!session) {
    console.warn(`No active session found for sessionId: ${sessionId}`);
    return null;
  }

  // Update the session
  const updateResult = await queryOne<ClaudeSession>(
    `UPDATE ops.linear_claude_sessions
     SET status = 'completed',
         completed_at = NOW(),
         summary = COALESCE($2, summary),
         files_changed = COALESCE($3, files_changed),
         pr_number = COALESCE($4, pr_number),
         pr_url = COALESCE($5, pr_url)
     WHERE id = $1
     RETURNING *`,
    [session.id, summary, filesChanged, prNumber, prUrl]
  );

  // Add completion comment to Linear if linked
  if (session.linear_issue_id && updateResult) {
    try {
      const client = getLinearClient();
      const commitCount = updateResult.commit_hashes?.length || 0;
      const fileCount = updateResult.files_changed?.length || 0;

      let comment = `Claude Code session completed\n`;
      comment += `- Commits: ${commitCount}\n`;
      comment += `- Files changed: ${fileCount}\n`;
      if (updateResult.pr_url) {
        comment += `- PR: ${updateResult.pr_url}\n`;
      }
      if (summary) {
        comment += `\n**Summary:**\n${summary}`;
      }

      await client.createComment(session.linear_issue_id, comment);
    } catch {
      console.warn("Failed to add session completion comment to Linear");
    }
  }

  return updateResult;
}

/**
 * Gets the current active session for a given sessionId.
 */
export async function getActiveSession(sessionId: string): Promise<ClaudeSession | null> {
  return queryOne<ClaudeSession>(
    `SELECT * FROM ops.linear_claude_sessions
     WHERE session_id = $1 AND status = 'active'`,
    [sessionId]
  );
}

/**
 * Gets a session by ID.
 */
export async function getSession(id: string): Promise<ClaudeSession | null> {
  return queryOne<ClaudeSession>(
    `SELECT * FROM ops.linear_claude_sessions WHERE id = $1`,
    [id]
  );
}

/**
 * Gets all sessions for a Linear issue.
 */
export async function getSessionsForIssue(linearIssueId: string): Promise<ClaudeSession[]> {
  const result = await query<ClaudeSession>(
    `SELECT * FROM ops.linear_claude_sessions
     WHERE linear_issue_id = $1
     ORDER BY started_at DESC`,
    [linearIssueId]
  );
  return result.rows;
}
