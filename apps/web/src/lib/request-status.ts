/**
 * Request Status System - Single Source of Truth
 *
 * This module consolidates ALL status-related logic for requests.
 * It implements MIG_2530's simplified 4-state system while maintaining
 * backwards compatibility with legacy statuses.
 *
 * ARCHITECTURE:
 * - 4 PRIMARY statuses: new, working, paused, completed
 * - 2 SPECIAL statuses: redirected, handed_off (terminal states)
 * - 8 LEGACY statuses: mapped to primary for display/filtering
 *
 * USAGE:
 * - Import this module instead of hardcoding status values
 * - Use getStatusDisplay() for UI labels
 * - Use getStatusColor() for badge/chip colors
 * - Use mapLegacyStatus() when querying or filtering
 * - Use VALID_TRANSITIONS for workflow validation
 *
 * @see sql/schema/v2/MIG_2530__simplified_request_status.sql
 */

// =============================================================================
// STATUS DEFINITIONS
// =============================================================================

/**
 * Primary statuses - the simplified 4-state system
 * These are the only statuses that should be SET on new requests.
 */
export const PRIMARY_STATUSES = ["new", "working", "paused", "completed"] as const;
export type PrimaryStatus = (typeof PRIMARY_STATUSES)[number];

/**
 * Special terminal statuses - used for request handoffs
 */
export const SPECIAL_STATUSES = ["redirected", "handed_off"] as const;
export type SpecialStatus = (typeof SPECIAL_STATUSES)[number];

/**
 * Legacy statuses - kept for backwards compatibility with historical data
 * These should NEVER be set on new requests, only read from existing data.
 */
export const LEGACY_STATUSES = [
  "triaged",      // → maps to "new"
  "scheduled",    // → maps to "working"
  "in_progress",  // → maps to "working"
  "on_hold",      // → maps to "paused"
  "cancelled",    // → maps to "completed"
  "partial",      // → maps to "completed"
  "needs_review", // → maps to "new"
  "active",       // → maps to "working"
] as const;
export type LegacyStatus = (typeof LEGACY_STATUSES)[number];

/**
 * All valid status values (for validation)
 * This is what the database accepts.
 */
export const ALL_STATUSES = [
  ...PRIMARY_STATUSES,
  ...SPECIAL_STATUSES,
  ...LEGACY_STATUSES,
] as const;
export type RequestStatus = (typeof ALL_STATUSES)[number];

// =============================================================================
// STATUS MAPPING
// =============================================================================

/**
 * Maps legacy statuses to their primary equivalents.
 * Used for display and filtering.
 */
export const LEGACY_TO_PRIMARY: Record<LegacyStatus, PrimaryStatus> = {
  triaged: "new",
  scheduled: "working",
  in_progress: "working",
  on_hold: "paused",
  cancelled: "completed",
  partial: "completed",
  needs_review: "new",
  active: "working",
};

/**
 * Maps special statuses to their display column (for kanban).
 * Special statuses are terminal, so they map to "completed" column.
 */
export const SPECIAL_TO_COLUMN: Record<SpecialStatus, PrimaryStatus> = {
  redirected: "completed",
  handed_off: "completed",
};

/**
 * Get the primary status equivalent for any status value.
 * Use this for filtering and display logic.
 */
export function mapToPrimaryStatus(status: RequestStatus): PrimaryStatus {
  if (PRIMARY_STATUSES.includes(status as PrimaryStatus)) {
    return status as PrimaryStatus;
  }
  if (SPECIAL_STATUSES.includes(status as SpecialStatus)) {
    return SPECIAL_TO_COLUMN[status as SpecialStatus];
  }
  if (LEGACY_STATUSES.includes(status as LegacyStatus)) {
    return LEGACY_TO_PRIMARY[status as LegacyStatus];
  }
  // Fallback for unknown values
  console.warn(`Unknown status value: ${status}, defaulting to "new"`);
  return "new";
}

/**
 * Get all statuses that map to a given primary status.
 * Use this for database queries to include legacy records.
 *
 * @example
 * // To find all "working" requests (includes scheduled, in_progress, active)
 * const statuses = getStatusesForPrimary("working");
 * // Returns: ["working", "scheduled", "in_progress", "active"]
 */
export function getStatusesForPrimary(primary: PrimaryStatus): RequestStatus[] {
  const result: RequestStatus[] = [primary];

  // Add legacy statuses that map to this primary
  for (const [legacy, mapped] of Object.entries(LEGACY_TO_PRIMARY)) {
    if (mapped === primary) {
      result.push(legacy as LegacyStatus);
    }
  }

  // Add special statuses if primary is "completed"
  if (primary === "completed") {
    result.push(...SPECIAL_STATUSES);
  }

  return result;
}

/**
 * Build SQL IN clause for a primary status (includes legacy mappings).
 * Returns a string like: ('working', 'scheduled', 'in_progress', 'active')
 */
export function buildStatusInClause(primary: PrimaryStatus): string {
  const statuses = getStatusesForPrimary(primary);
  return `(${statuses.map(s => `'${s}'`).join(", ")})`;
}

// =============================================================================
// DISPLAY LABELS
// =============================================================================

/**
 * Human-readable labels for all statuses.
 * For legacy statuses, shows the modern equivalent label.
 */
export const STATUS_LABELS: Record<RequestStatus, string> = {
  // Primary
  new: "New",
  working: "Working",
  paused: "Paused",
  completed: "Completed",
  // Special
  redirected: "Redirected",
  handed_off: "Handed Off",
  // Legacy (display as modern equivalent)
  triaged: "New",
  scheduled: "Working",
  in_progress: "Working",
  on_hold: "Paused",
  cancelled: "Completed",
  partial: "Completed",
  needs_review: "New",
  active: "Working",
};

/**
 * Get the display label for a status.
 */
export function getStatusLabel(status: RequestStatus): string {
  return STATUS_LABELS[status] || status;
}

/**
 * Detailed labels that show the original status (for admin/debugging).
 */
export const STATUS_LABELS_DETAILED: Record<RequestStatus, string> = {
  // Primary
  new: "New",
  working: "Working",
  paused: "Paused",
  completed: "Completed",
  // Special
  redirected: "Redirected",
  handed_off: "Handed Off",
  // Legacy (show original name)
  triaged: "Triaged (legacy)",
  scheduled: "Scheduled (legacy)",
  in_progress: "In Progress (legacy)",
  on_hold: "On Hold (legacy)",
  cancelled: "Cancelled",
  partial: "Partial (legacy)",
  needs_review: "Needs Review (legacy)",
  active: "Active (legacy)",
};

// =============================================================================
// COLORS
// =============================================================================

export interface StatusColorScheme {
  bg: string;
  color: string;
  border: string;
}

/**
 * Color schemes for status badges.
 * Primary statuses have their own colors.
 * Legacy statuses use the color of their primary equivalent.
 */
export const STATUS_COLORS: Record<RequestStatus, StatusColorScheme> = {
  // Primary statuses
  new: { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },        // Blue
  working: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },    // Amber
  paused: { bg: "#fce7f3", color: "#9d174d", border: "#f9a8d4" },     // Pink
  completed: { bg: "#d1fae5", color: "#065f46", border: "#6ee7b7" },  // Green

  // Special statuses
  redirected: { bg: "#e0e7ff", color: "#3730a3", border: "#a5b4fc" }, // Indigo
  handed_off: { bg: "#e0e7ff", color: "#3730a3", border: "#a5b4fc" }, // Indigo

  // Legacy statuses - use their primary equivalent colors
  triaged: { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },    // → new (Blue)
  scheduled: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },  // → working (Amber)
  in_progress: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" }, // → working (Amber)
  on_hold: { bg: "#fce7f3", color: "#9d174d", border: "#f9a8d4" },    // → paused (Pink)
  cancelled: { bg: "#f3f4f6", color: "#4b5563", border: "#d1d5db" },  // Gray (distinct from completed)
  partial: { bg: "#fef9c3", color: "#854d0e", border: "#fde047" },    // Yellow (distinct)
  needs_review: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" }, // Red
  active: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },     // → working (Amber)
};

/**
 * Get color scheme for a status.
 */
export function getStatusColor(status: RequestStatus): StatusColorScheme {
  return STATUS_COLORS[status] || STATUS_COLORS.new;
}

// =============================================================================
// TRANSITIONS
// =============================================================================

/**
 * Valid status transitions for the simplified system.
 * Only primary statuses are targets.
 *
 * Workflow:
 *   new ──────→ working ──────→ completed
 *    │              │               ▲
 *    │              ▼               │
 *    └─────────→ paused ───────────┘
 *
 * Special statuses (redirected, handed_off) can be reached from any active status.
 */
export const VALID_TRANSITIONS: Record<PrimaryStatus | SpecialStatus, (PrimaryStatus | SpecialStatus)[]> = {
  // Primary status transitions
  new: ["working", "paused", "completed", "redirected", "handed_off"],
  working: ["paused", "completed", "redirected", "handed_off"],
  paused: ["new", "working", "completed", "redirected", "handed_off"],
  completed: [], // Terminal

  // Special statuses are terminal
  redirected: [],
  handed_off: [],
};

/**
 * Check if a transition is valid.
 * Handles legacy statuses by mapping to their primary equivalent first.
 */
export function isValidTransition(from: RequestStatus, to: RequestStatus): boolean {
  // Map legacy "from" status to primary
  const fromPrimary = mapToPrimaryStatus(from);

  // Terminal statuses can't transition
  if (fromPrimary === "completed" || SPECIAL_STATUSES.includes(from as SpecialStatus)) {
    return false;
  }

  // Check if target is valid
  const validTargets = VALID_TRANSITIONS[fromPrimary];
  return validTargets.includes(to as PrimaryStatus | SpecialStatus);
}

/**
 * Get valid transition targets for a status.
 */
export function getValidTransitions(status: RequestStatus): (PrimaryStatus | SpecialStatus)[] {
  const primary = mapToPrimaryStatus(status);
  return VALID_TRANSITIONS[primary] || [];
}

// =============================================================================
// RESOLUTION OUTCOMES (FFS-155)
// =============================================================================

/**
 * Resolution outcomes — WHY a case was closed.
 * Only set when status = completed. Cleared on reopen.
 * Follows Jira pattern: status (where) vs resolution (why).
 */
export const RESOLUTION_OUTCOMES = [
  "successful",
  "partial",
  "unable_to_complete",
  "no_longer_needed",
  "referred_out",
] as const;
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

export const RESOLUTION_OUTCOME_LABELS: Record<ResolutionOutcome, string> = {
  successful: "TNR Successful",
  partial: "Partial Success",
  unable_to_complete: "Unable to Complete",
  no_longer_needed: "No Longer Needed",
  referred_out: "Referred Out",
};

export const RESOLUTION_OUTCOME_COLORS: Record<ResolutionOutcome, StatusColorScheme> = {
  successful: { bg: "#d1fae5", color: "#065f46", border: "#6ee7b7" },          // Green
  partial: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },             // Amber
  unable_to_complete: { bg: "#ffedd5", color: "#9a3412", border: "#fdba74" },   // Orange
  no_longer_needed: { bg: "#f3f4f6", color: "#4b5563", border: "#d1d5db" },     // Gray
  referred_out: { bg: "#e0e7ff", color: "#3730a3", border: "#a5b4fc" },         // Indigo
};

export const RESOLUTION_OUTCOME_ICONS: Record<ResolutionOutcome, string> = {
  successful: "check-circle",
  partial: "minus-circle",
  unable_to_complete: "x-circle",
  no_longer_needed: "slash",
  referred_out: "external-link",
};

export function getOutcomeLabel(outcome: ResolutionOutcome | string): string {
  return RESOLUTION_OUTCOME_LABELS[outcome as ResolutionOutcome] || outcome;
}

export function getOutcomeColor(outcome: ResolutionOutcome | string): StatusColorScheme {
  return RESOLUTION_OUTCOME_COLORS[outcome as ResolutionOutcome] || RESOLUTION_OUTCOME_COLORS.no_longer_needed;
}

export function isValidOutcome(value: unknown): value is ResolutionOutcome {
  return typeof value === "string" && RESOLUTION_OUTCOMES.includes(value as ResolutionOutcome);
}

// =============================================================================
// KANBAN BOARD HELPERS
// =============================================================================

export interface KanbanColumn {
  status: PrimaryStatus;
  label: string;
  color: string;
  bgColor: string;
  description: string;
}

/**
 * Kanban board columns in display order.
 */
export const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    status: "new",
    label: "New",
    color: "#3b82f6",
    bgColor: "#dbeafe",
    description: "Awaiting initial review",
  },
  {
    status: "working",
    label: "Working",
    color: "#f59e0b",
    bgColor: "#fef3c7",
    description: "Actively being handled",
  },
  {
    status: "paused",
    label: "Paused",
    color: "#ec4899",
    bgColor: "#fce7f3",
    description: "On hold",
  },
  {
    status: "completed",
    label: "Completed",
    color: "#10b981",
    bgColor: "#d1fae5",
    description: "Finished",
  },
];

/**
 * Get the kanban column for any status.
 */
export function getKanbanColumn(status: RequestStatus): PrimaryStatus {
  return mapToPrimaryStatus(status);
}

// =============================================================================
// FILTER HELPERS
// =============================================================================

/**
 * Preset filter definitions for the requests list.
 * Uses primary statuses but queries include legacy mappings.
 */
export interface StatusFilter {
  id: string;
  name: string;
  statuses: PrimaryStatus[];
  description?: string;
}

export const PRESET_STATUS_FILTERS: StatusFilter[] = [
  {
    id: "all-active",
    name: "All Active",
    statuses: ["new", "working", "paused"],
    description: "All requests that aren't completed",
  },
  {
    id: "needs-attention",
    name: "Needs Attention",
    statuses: ["new"],
    description: "New requests awaiting triage",
  },
  {
    id: "in-progress",
    name: "In Progress",
    statuses: ["working"],
    description: "Requests being actively worked",
  },
  {
    id: "on-hold",
    name: "On Hold",
    statuses: ["paused"],
    description: "Requests waiting for something",
  },
  {
    id: "completed",
    name: "Completed",
    statuses: ["completed"],
    description: "Finished requests",
  },
];

/**
 * Expand primary statuses to include legacy equivalents for database queries.
 *
 * @example
 * expandStatusFilter(["working"])
 * // Returns: ["working", "scheduled", "in_progress", "active"]
 */
export function expandStatusFilter(primaries: PrimaryStatus[]): RequestStatus[] {
  const result: RequestStatus[] = [];
  for (const primary of primaries) {
    result.push(...getStatusesForPrimary(primary));
  }
  return [...new Set(result)]; // Dedupe
}

// =============================================================================
// STATUS DROPDOWN OPTIONS
// =============================================================================

export interface StatusOption {
  value: PrimaryStatus | SpecialStatus;
  label: string;
  description?: string;
}

/**
 * Options for status dropdown menus.
 * Only shows primary and special statuses (not legacy).
 */
export const STATUS_OPTIONS: StatusOption[] = [
  { value: "new", label: "New", description: "Awaiting initial review" },
  { value: "working", label: "Working", description: "Actively being handled" },
  { value: "paused", label: "Paused", description: "On hold" },
  { value: "completed", label: "Completed", description: "Finished" },
  { value: "redirected", label: "Redirected", description: "Sent to another organization" },
  { value: "handed_off", label: "Handed Off", description: "Transferred to another request" },
];

/**
 * Options for quick status change (excludes terminal states).
 */
export const QUICK_STATUS_OPTIONS: StatusOption[] = STATUS_OPTIONS.filter(
  opt => !["completed", "redirected", "handed_off"].includes(opt.value)
);

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Check if a value is a valid request status.
 */
export function isValidStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" && ALL_STATUSES.includes(value as RequestStatus);
}

/**
 * Check if a status is a primary status (not legacy or special).
 */
export function isPrimaryStatus(status: RequestStatus): status is PrimaryStatus {
  return PRIMARY_STATUSES.includes(status as PrimaryStatus);
}

/**
 * Check if a status is a legacy status.
 */
export function isLegacyStatus(status: RequestStatus): status is LegacyStatus {
  return LEGACY_STATUSES.includes(status as LegacyStatus);
}

/**
 * Check if a status is terminal (no further transitions possible).
 */
export function isTerminalStatus(status: RequestStatus): boolean {
  const primary = mapToPrimaryStatus(status);
  return primary === "completed" || SPECIAL_STATUSES.includes(status as SpecialStatus);
}

/**
 * Check if a status represents an active request (not completed).
 */
export function isActiveStatus(status: RequestStatus): boolean {
  return !isTerminalStatus(status);
}

// =============================================================================
// TIMELINE / PIPELINE VISUALIZATION
// =============================================================================

/**
 * Simplified workflow visualization for StatusPipeline component.
 */
export const WORKFLOW_DIAGRAM = {
  mainFlow: ["new", "working", "completed"] as PrimaryStatus[],
  branchFlow: ["paused"] as PrimaryStatus[],
  specialFlow: ["redirected", "handed_off"] as SpecialStatus[],
  description: `
    Main: new → working → completed
    Branch: Any active status can go to "paused"
    Special: Any active status can be "redirected" or "handed_off"
  `,
};
