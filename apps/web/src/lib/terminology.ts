/**
 * FFR/TNR Terminology Constants
 *
 * FFSC uses "Find Fix Return" (FFR) for public-facing communications
 * and "Trap-Neuter-Return" (TNR) for internal/staff communications.
 *
 * Use PUBLIC_TERMS for:
 * - Intake forms
 * - Public-facing web pages
 * - Tippy AI responses to general public
 * - Marketing materials
 *
 * Use STAFF_TERMS for:
 * - Internal dashboards
 * - Staff communication
 * - Admin tools
 * - Technical documentation
 */

export const PUBLIC_TERMS = {
  /** Full program name for public */
  program: "Find Fix Return (FFR)",
  /** Short program name */
  programShort: "FFR",
  /** Action verb for public (friendly term for spay/neuter) */
  action: "fix",
  /** Past tense action */
  actionPast: "fixed",
  /** Program description for public */
  description:
    "Find Fix Return helps community cats by humanely trapping, spaying/neutering, and returning them to their outdoor homes.",
  /** Short tagline */
  tagline: "Helping community cats, one at a time.",
} as const;

export const STAFF_TERMS = {
  /** Internal program name */
  program: "TNR",
  /** Full internal program name */
  programFull: "Trap-Neuter-Return",
  /** Action verb for staff (technical term) */
  action: "alter",
  /** Past tense action */
  actionPast: "altered",
} as const;

/**
 * Get the appropriate program term based on context
 * @param isPublic - true for public-facing, false for internal
 */
export function getProgramTerm(isPublic: boolean): string {
  return isPublic ? PUBLIC_TERMS.programShort : STAFF_TERMS.program;
}

/**
 * Get the full program name based on context
 * @param isPublic - true for public-facing, false for internal
 */
export function getProgramFullName(isPublic: boolean): string {
  return isPublic ? PUBLIC_TERMS.program : STAFF_TERMS.programFull;
}

/**
 * Get the action verb based on context
 * @param isPublic - true for public-facing, false for internal
 */
export function getActionTerm(isPublic: boolean): string {
  return isPublic ? PUBLIC_TERMS.action : STAFF_TERMS.action;
}

/**
 * Get the past tense action verb based on context
 * @param isPublic - true for public-facing, false for internal
 */
export function getActionPastTerm(isPublic: boolean): string {
  return isPublic ? PUBLIC_TERMS.actionPast : STAFF_TERMS.actionPast;
}

/**
 * Status labels for cat alteration status
 * Maps internal status values to display labels
 */
export const ALTERATION_STATUS_LABELS: Record<string, { public: string; staff: string }> = {
  spayed: { public: "Fixed (Female)", staff: "Spayed" },
  neutered: { public: "Fixed (Male)", staff: "Neutered" },
  altered: { public: "Fixed", staff: "Altered" },
  intact: { public: "Not Fixed", staff: "Intact" },
  unknown: { public: "Unknown", staff: "Unknown" },
};

/**
 * Get the alteration status label
 * @param status - The internal status value
 * @param isPublic - true for public-facing, false for internal
 */
export function getAlterationStatusLabel(
  status: string,
  isPublic: boolean
): string {
  const labels = ALTERATION_STATUS_LABELS[status.toLowerCase()];
  if (!labels) return status;
  return isPublic ? labels.public : labels.staff;
}
