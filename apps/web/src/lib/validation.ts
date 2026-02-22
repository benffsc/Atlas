const GARBAGE_PATTERNS = [
  /^unknown$/i,
  /^n\/?a$/i,
  /^none$/i,
  /^test$/i,
  /^asdf/i,
  /^xxx+$/i,
  /^aaa+$/i,
  /^zzz+$/i,
  /^\d+$/, // all numbers
  /^(.)\1+$/, // all same character
  /^null$/i,
  /^undefined$/i,
  /^delete$/i,
  /^remove$/i,
];

// UUID validation regex (v1-v5 UUIDs)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate that a string is a valid UUID.
 * Use this in API routes to prevent SQL errors from malformed IDs.
 */
export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Validate pagination parameters and return safe values.
 * Prevents negative values and enforces reasonable limits.
 */
export function validatePagination(
  limitStr: string | null,
  offsetStr: string | null,
  maxLimit = 100,
  defaultLimit = 50
): { limit: number; offset: number } {
  const limit = Math.max(1, Math.min(parseInt(limitStr || String(defaultLimit), 10) || defaultLimit, maxLimit));
  const offset = Math.max(0, parseInt(offsetStr || "0", 10) || 0);
  return { limit, offset };
}

export function validatePersonName(name: string): { valid: boolean; error?: string; warning?: string } {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "Name is required" };
  }

  if (trimmed.length < 2) {
    return { valid: false, error: "Name must be at least 2 characters" };
  }

  for (const pattern of GARBAGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: `"${trimmed}" is not a valid name` };
    }
  }

  // Warn on ALL CAPS (but allow save)
  if (trimmed.length > 2 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return { valid: true, warning: "Name is in ALL CAPS — consider using proper case" };
  }

  return { valid: true };
}
