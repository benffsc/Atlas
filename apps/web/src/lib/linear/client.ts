/**
 * Linear GraphQL Client
 *
 * Rate-limited client for Linear's GraphQL API.
 * Follows Atlas patterns from VolunteerHub/ShelterLuv sync.
 *
 * @see https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 */

import type {
  LinearIssue,
  LinearProject,
  LinearCycle,
  LinearUser,
  LinearLabel,
  LinearIssuesResponse,
  LinearProjectsResponse,
  LinearCyclesResponse,
  LinearUsersResponse,
  LinearLabelsResponse,
  CreateIssueInput,
  UpdateIssueInput,
  IssueCreateResponse,
  IssueUpdateResponse,
  CommentCreateResponse,
  LinearPageInfo,
} from "./types";

import {
  ISSUES_QUERY,
  ISSUE_BY_ID_QUERY,
  PROJECTS_QUERY,
  CYCLES_QUERY,
  USERS_QUERY,
  LABELS_QUERY,
  VIEWER_QUERY,
  TEAMS_QUERY,
  CREATE_ISSUE_MUTATION,
  UPDATE_ISSUE_MUTATION,
  ARCHIVE_ISSUE_MUTATION,
  CREATE_COMMENT_MUTATION,
} from "./queries";

// ============================================================================
// Configuration
// ============================================================================

const LINEAR_API_ENDPOINT = "https://api.linear.app/graphql";
const RATE_LIMIT_MS = 250; // 4 requests per second (Linear allows 1,500/hour)
const DEFAULT_PAGE_SIZE = 50;

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Linear Client Class
// ============================================================================

export class LinearClient {
  private apiKey: string;
  private lastRequestTime: number = 0;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.LINEAR_API_KEY;
    if (!key) {
      throw new Error("LINEAR_API_KEY is required");
    }
    this.apiKey = key;
  }

  /**
   * Execute a GraphQL query with rate limiting
   */
  private async query<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_MS) {
      await sleep(RATE_LIMIT_MS - timeSinceLastRequest);
    }

    const response = await fetch(LINEAR_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    this.lastRequestTime = Date.now();

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Linear API error ${response.status}: ${text.substring(0, 200)}`);
    }

    const json = await response.json();

    if (json.errors && json.errors.length > 0) {
      const errorMessages = json.errors.map((e: { message: string }) => e.message).join(", ");
      throw new Error(`Linear GraphQL error: ${errorMessages}`);
    }

    return json.data as T;
  }

  // ==========================================================================
  // Verification
  // ==========================================================================

  /**
   * Verify API key is valid by fetching current user
   */
  async verifyAuth(): Promise<{ id: string; name: string; email: string }> {
    const data = await this.query<{ viewer: { id: string; name: string; email: string } }>(
      VIEWER_QUERY
    );
    return data.viewer;
  }

  /**
   * Get available teams
   */
  async getTeams(): Promise<{ id: string; name: string; key: string }[]> {
    const data = await this.query<{ teams: { nodes: { id: string; name: string; key: string }[] } }>(
      TEAMS_QUERY
    );
    return data.teams.nodes;
  }

  // ==========================================================================
  // Issues
  // ==========================================================================

  /**
   * Fetch issues with pagination
   */
  async getIssues(
    options: {
      first?: number;
      after?: string;
      filter?: Record<string, unknown>;
    } = {}
  ): Promise<{ issues: LinearIssue[]; pageInfo: LinearPageInfo }> {
    const data = await this.query<LinearIssuesResponse>(ISSUES_QUERY, {
      first: options.first || DEFAULT_PAGE_SIZE,
      after: options.after || null,
      filter: options.filter || null,
    });

    return {
      issues: data.issues.nodes,
      pageInfo: data.issues.pageInfo,
    };
  }

  /**
   * Fetch all issues (handles pagination automatically)
   */
  async getAllIssues(
    filter?: Record<string, unknown>,
    onProgress?: (fetched: number) => void
  ): Promise<LinearIssue[]> {
    const allIssues: LinearIssue[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const { issues, pageInfo } = await this.getIssues({
        first: DEFAULT_PAGE_SIZE,
        after: cursor || undefined,
        filter,
      });

      allIssues.push(...issues);
      cursor = pageInfo.endCursor;
      hasMore = pageInfo.hasNextPage;

      if (onProgress) {
        onProgress(allIssues.length);
      }
    }

    return allIssues;
  }

  /**
   * Get a single issue by ID
   */
  async getIssue(id: string): Promise<LinearIssue | null> {
    try {
      const data = await this.query<{ issue: LinearIssue }>(ISSUE_BY_ID_QUERY, { id });
      return data.issue;
    } catch {
      return null;
    }
  }

  /**
   * Create a new issue
   */
  async createIssue(input: CreateIssueInput): Promise<LinearIssue | null> {
    const data = await this.query<IssueCreateResponse>(CREATE_ISSUE_MUTATION, {
      input,
    });

    if (!data.issueCreate.success) {
      throw new Error("Failed to create issue");
    }

    return data.issueCreate.issue;
  }

  /**
   * Update an existing issue
   */
  async updateIssue(id: string, input: UpdateIssueInput): Promise<LinearIssue | null> {
    const data = await this.query<IssueUpdateResponse>(UPDATE_ISSUE_MUTATION, {
      id,
      input,
    });

    if (!data.issueUpdate.success) {
      throw new Error("Failed to update issue");
    }

    return data.issueUpdate.issue;
  }

  /**
   * Archive an issue
   */
  async archiveIssue(id: string): Promise<boolean> {
    const data = await this.query<{ issueArchive: { success: boolean } }>(
      ARCHIVE_ISSUE_MUTATION,
      { id }
    );
    return data.issueArchive.success;
  }

  // ==========================================================================
  // Projects
  // ==========================================================================

  /**
   * Fetch projects with pagination
   */
  async getProjects(
    options: { first?: number; after?: string } = {}
  ): Promise<{ projects: LinearProject[]; pageInfo: LinearPageInfo }> {
    const data = await this.query<LinearProjectsResponse>(PROJECTS_QUERY, {
      first: options.first || DEFAULT_PAGE_SIZE,
      after: options.after || null,
    });

    return {
      projects: data.projects.nodes,
      pageInfo: data.projects.pageInfo,
    };
  }

  /**
   * Fetch all projects
   */
  async getAllProjects(): Promise<LinearProject[]> {
    const allProjects: LinearProject[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const { projects, pageInfo } = await this.getProjects({
        first: DEFAULT_PAGE_SIZE,
        after: cursor || undefined,
      });

      allProjects.push(...projects);
      cursor = pageInfo.endCursor;
      hasMore = pageInfo.hasNextPage;
    }

    return allProjects;
  }

  // ==========================================================================
  // Cycles
  // ==========================================================================

  /**
   * Fetch cycles with pagination
   */
  async getCycles(
    options: { first?: number; after?: string; filter?: Record<string, unknown> } = {}
  ): Promise<{ cycles: LinearCycle[]; pageInfo: LinearPageInfo }> {
    const data = await this.query<LinearCyclesResponse>(CYCLES_QUERY, {
      first: options.first || DEFAULT_PAGE_SIZE,
      after: options.after || null,
      filter: options.filter || null,
    });

    return {
      cycles: data.cycles.nodes,
      pageInfo: data.cycles.pageInfo,
    };
  }

  /**
   * Fetch all cycles
   */
  async getAllCycles(): Promise<LinearCycle[]> {
    const allCycles: LinearCycle[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const { cycles, pageInfo } = await this.getCycles({
        first: DEFAULT_PAGE_SIZE,
        after: cursor || undefined,
      });

      allCycles.push(...cycles);
      cursor = pageInfo.endCursor;
      hasMore = pageInfo.hasNextPage;
    }

    return allCycles;
  }

  // ==========================================================================
  // Team Members
  // ==========================================================================

  /**
   * Fetch users with pagination
   */
  async getUsers(
    options: { first?: number; after?: string } = {}
  ): Promise<{ users: LinearUser[]; pageInfo: LinearPageInfo }> {
    const data = await this.query<LinearUsersResponse>(USERS_QUERY, {
      first: options.first || DEFAULT_PAGE_SIZE,
      after: options.after || null,
    });

    return {
      users: data.users.nodes,
      pageInfo: data.users.pageInfo,
    };
  }

  /**
   * Fetch all users
   */
  async getAllUsers(): Promise<LinearUser[]> {
    const allUsers: LinearUser[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const { users, pageInfo } = await this.getUsers({
        first: DEFAULT_PAGE_SIZE,
        after: cursor || undefined,
      });

      allUsers.push(...users);
      cursor = pageInfo.endCursor;
      hasMore = pageInfo.hasNextPage;
    }

    return allUsers;
  }

  // ==========================================================================
  // Labels
  // ==========================================================================

  /**
   * Fetch labels with pagination
   */
  async getLabels(
    options: { first?: number; after?: string } = {}
  ): Promise<{ labels: LinearLabel[]; pageInfo: LinearPageInfo }> {
    const data = await this.query<LinearLabelsResponse>(LABELS_QUERY, {
      first: options.first || DEFAULT_PAGE_SIZE,
      after: options.after || null,
    });

    return {
      labels: data.issueLabels.nodes,
      pageInfo: data.issueLabels.pageInfo,
    };
  }

  /**
   * Fetch all labels
   */
  async getAllLabels(): Promise<LinearLabel[]> {
    const allLabels: LinearLabel[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const { labels, pageInfo } = await this.getLabels({
        first: DEFAULT_PAGE_SIZE,
        after: cursor || undefined,
      });

      allLabels.push(...labels);
      cursor = pageInfo.endCursor;
      hasMore = pageInfo.hasNextPage;
    }

    return allLabels;
  }

  // ==========================================================================
  // Comments
  // ==========================================================================

  /**
   * Add a comment to an issue
   */
  async createComment(issueId: string, body: string): Promise<boolean> {
    const data = await this.query<CommentCreateResponse>(CREATE_COMMENT_MUTATION, {
      input: { issueId, body },
    });
    return data.commentCreate.success;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let clientInstance: LinearClient | null = null;

/**
 * Get or create the Linear client singleton
 */
export function getLinearClient(): LinearClient {
  if (!clientInstance) {
    clientInstance = new LinearClient();
  }
  return clientInstance;
}

/**
 * Create a new Linear client with a specific API key
 */
export function createLinearClient(apiKey: string): LinearClient {
  return new LinearClient(apiKey);
}
