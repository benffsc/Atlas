/**
 * Linear API Types
 *
 * TypeScript interfaces for Linear GraphQL API responses.
 * @see https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 */

// ============================================================================
// Core Types
// ============================================================================

export interface LinearUser {
  id: string;
  name: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  active: boolean;
  admin: boolean;
  createdAt: string;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: "backlog" | "unstarted" | "started" | "completed" | "canceled";
  color: string;
  position: number;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
  parent: { id: string } | null;
  createdAt: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description: string | null;
  state: string;
  icon: string | null;
  color: string | null;
  slugId: string;
  url: string;
  targetDate: string | null;
  startDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinearCycle {
  id: string;
  name: string | null;
  number: number;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  priorityLabel: string;
  estimate: number | null;
  dueDate: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  archivedAt: string | null;
  state: LinearWorkflowState;
  assignee: LinearUser | null;
  creator: LinearUser | null;
  project: { id: string; name: string } | null;
  cycle: { id: string; name: string | null; number: number } | null;
  labels: { nodes: LinearLabel[] };
}

export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  user: LinearUser;
  issue: { id: string };
}

// ============================================================================
// API Response Types
// ============================================================================

export interface LinearPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface LinearConnection<T> {
  nodes: T[];
  pageInfo: LinearPageInfo;
}

export interface LinearIssuesResponse {
  issues: LinearConnection<LinearIssue>;
}

export interface LinearProjectsResponse {
  projects: LinearConnection<LinearProject>;
}

export interface LinearCyclesResponse {
  cycles: LinearConnection<LinearCycle>;
}

export interface LinearUsersResponse {
  users: LinearConnection<LinearUser>;
}

export interface LinearLabelsResponse {
  issueLabels: LinearConnection<LinearLabel>;
}

export interface LinearWorkflowStatesResponse {
  workflowStates: LinearConnection<LinearWorkflowState>;
}

// ============================================================================
// Mutation Types
// ============================================================================

export interface CreateIssueInput {
  title: string;
  description?: string;
  teamId: string;
  projectId?: string;
  cycleId?: string;
  assigneeId?: string;
  priority?: number;
  estimate?: number;
  dueDate?: string;
  labelIds?: string[];
  stateId?: string;
}

export interface UpdateIssueInput {
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

export interface CreateCommentInput {
  issueId: string;
  body: string;
}

export interface IssueCreateResponse {
  issueCreate: {
    success: boolean;
    issue: LinearIssue | null;
  };
}

export interface IssueUpdateResponse {
  issueUpdate: {
    success: boolean;
    issue: LinearIssue | null;
  };
}

export interface CommentCreateResponse {
  commentCreate: {
    success: boolean;
    comment: LinearComment | null;
  };
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | "Project" | "Cycle" | "IssueLabel";
  createdAt: string;
  data: Record<string, unknown>;
  url: string;
  organizationId: string;
  webhookTimestamp: number;
  webhookId: string;
}

// ============================================================================
// Atlas Integration Types
// ============================================================================

export interface LinearSyncResult {
  recordType: string;
  fetched: number;
  created: number;
  updated: number;
  errors: number;
  cursor: string | null;
}

export interface LinearSyncStats {
  issues: LinearSyncResult;
  projects: LinearSyncResult;
  cycles: LinearSyncResult;
  labels: LinearSyncResult;
  teamMembers: LinearSyncResult;
  totalDuration: number;
}

export interface ClaudeSessionConfig {
  issueIdentifier?: string;
  autoCreateIssue?: boolean;
  issueTitle?: string;
  projectId?: string;
  labels?: string[];
}

export interface ClaudeSession {
  id: string;
  sessionId: string;
  linearIssueId: string | null;
  branchName: string | null;
  commitHashes: string[];
  prNumber: number | null;
  prUrl: string | null;
  status: "active" | "paused" | "completed" | "abandoned";
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  filesChanged: string[];
}
