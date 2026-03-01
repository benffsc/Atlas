/**
 * Linear GraphQL Queries
 *
 * GraphQL query and mutation strings for Linear API.
 * @see https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 */

// ============================================================================
// Fragments
// ============================================================================

export const USER_FRAGMENT = `
  fragment UserFields on User {
    id
    name
    displayName
    email
    avatarUrl
    active
    admin
    createdAt
  }
`;

export const WORKFLOW_STATE_FRAGMENT = `
  fragment WorkflowStateFields on WorkflowState {
    id
    name
    type
    color
    position
  }
`;

export const LABEL_FRAGMENT = `
  fragment LabelFields on IssueLabel {
    id
    name
    color
    description
    parent { id }
    createdAt
  }
`;

export const PROJECT_FRAGMENT = `
  fragment ProjectFields on Project {
    id
    name
    description
    state
    icon
    color
    slugId
    url
    targetDate
    startDate
    createdAt
    updatedAt
  }
`;

export const CYCLE_FRAGMENT = `
  fragment CycleFields on Cycle {
    id
    name
    number
    startsAt
    endsAt
    completedAt
    progress
    createdAt
    updatedAt
  }
`;

export const ISSUE_FRAGMENT = `
  fragment IssueFields on Issue {
    id
    identifier
    title
    description
    priority
    priorityLabel
    estimate
    dueDate
    url
    createdAt
    updatedAt
    startedAt
    completedAt
    canceledAt
    archivedAt
    state {
      id
      name
      type
      color
    }
    assignee {
      id
      name
      displayName
      email
      avatarUrl
    }
    creator {
      id
      name
      displayName
    }
    project {
      id
      name
    }
    cycle {
      id
      name
      number
    }
    labels {
      nodes {
        id
        name
        color
      }
    }
  }
`;

// ============================================================================
// Queries
// ============================================================================

export const ISSUES_QUERY = `
  ${ISSUE_FRAGMENT}
  query Issues($first: Int!, $after: String, $filter: IssueFilter) {
    issues(first: $first, after: $after, filter: $filter) {
      nodes {
        ...IssueFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const ISSUE_BY_ID_QUERY = `
  ${ISSUE_FRAGMENT}
  query Issue($id: String!) {
    issue(id: $id) {
      ...IssueFields
    }
  }
`;

export const ISSUE_BY_IDENTIFIER_QUERY = `
  ${ISSUE_FRAGMENT}
  query IssueByIdentifier($id: String!) {
    issueVcsBranchSearch(branchName: $id) {
      ...IssueFields
    }
  }
`;

export const PROJECTS_QUERY = `
  ${PROJECT_FRAGMENT}
  query Projects($first: Int!, $after: String) {
    projects(first: $first, after: $after) {
      nodes {
        ...ProjectFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const CYCLES_QUERY = `
  ${CYCLE_FRAGMENT}
  query Cycles($first: Int!, $after: String, $filter: CycleFilter) {
    cycles(first: $first, after: $after, filter: $filter) {
      nodes {
        ...CycleFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const USERS_QUERY = `
  ${USER_FRAGMENT}
  query Users($first: Int!, $after: String) {
    users(first: $first, after: $after) {
      nodes {
        ...UserFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const LABELS_QUERY = `
  ${LABEL_FRAGMENT}
  query IssueLabels($first: Int!, $after: String) {
    issueLabels(first: $first, after: $after) {
      nodes {
        ...LabelFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const WORKFLOW_STATES_QUERY = `
  ${WORKFLOW_STATE_FRAGMENT}
  query WorkflowStates($first: Int!) {
    workflowStates(first: $first) {
      nodes {
        ...WorkflowStateFields
      }
    }
  }
`;

export const VIEWER_QUERY = `
  query Viewer {
    viewer {
      id
      name
      email
    }
  }
`;

export const TEAMS_QUERY = `
  query Teams {
    teams {
      nodes {
        id
        name
        key
      }
    }
  }
`;

// ============================================================================
// Mutations
// ============================================================================

export const CREATE_ISSUE_MUTATION = `
  ${ISSUE_FRAGMENT}
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        ...IssueFields
      }
    }
  }
`;

export const UPDATE_ISSUE_MUTATION = `
  ${ISSUE_FRAGMENT}
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        ...IssueFields
      }
    }
  }
`;

export const ARCHIVE_ISSUE_MUTATION = `
  mutation IssueArchive($id: String!) {
    issueArchive(id: $id) {
      success
    }
  }
`;

export const CREATE_COMMENT_MUTATION = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id
        body
        createdAt
        user {
          id
          name
        }
      }
    }
  }
`;
