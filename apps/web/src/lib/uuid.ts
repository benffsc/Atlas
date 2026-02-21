/**
 * Atlas UUID Utilities
 *
 * Centralized UUID validation and generation.
 * All entity IDs (person_id, place_id, cat_id, request_id) use UUIDs.
 *
 * IMPORTANT: Entity UUIDs are permanent stable handles (INV-3).
 * Never generate new UUIDs for existing entities — always preserve them.
 */

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * UUID v4 regex pattern.
 * Validates the standard 8-4-4-4-12 format with proper version/variant bits.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Loose UUID pattern (accepts any hex in version/variant positions).
 * Use this for legacy data that might not strictly conform to v4.
 */
const UUID_LOOSE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a UUID string (strict v4 format).
 *
 * @example
 * isValidUUID('550e8400-e29b-41d4-a716-446655440000') // true
 * isValidUUID('invalid') // false
 * isValidUUID(null) // false
 */
export function isValidUUID(value: string | null | undefined): value is string {
  if (!value) return false;
  return UUID_REGEX.test(value);
}

/**
 * Validate a UUID string (loose format).
 * Accepts any valid hex pattern, regardless of version/variant bits.
 *
 * @example
 * isValidUUIDLoose('00000000-0000-0000-0000-000000000000') // true (nil UUID)
 */
export function isValidUUIDLoose(value: string | null | undefined): value is string {
  if (!value) return false;
  return UUID_LOOSE_REGEX.test(value);
}

/**
 * Assert that a value is a valid UUID, throwing if not.
 *
 * @throws Error if the value is not a valid UUID
 *
 * @example
 * assertUUID(params.id); // throws if invalid
 * // Now TypeScript knows params.id is a string
 */
export function assertUUID(value: string | null | undefined, fieldName = 'ID'): asserts value is string {
  if (!isValidUUID(value)) {
    throw new Error(`Invalid ${fieldName}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

// =============================================================================
// PARSING
// =============================================================================

/**
 * Parse a potential UUID, returning null if invalid.
 * Useful for route params and query strings.
 *
 * @example
 * const id = parseUUID(params.id);
 * if (!id) return notFound();
 */
export function parseUUID(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isValidUUID(trimmed) ? trimmed : null;
}

/**
 * Parse a potential UUID, returning undefined if invalid.
 * Useful for optional fields.
 *
 * @example
 * const filter = { placeId: parseUUIDOptional(params.placeId) };
 */
export function parseUUIDOptional(value: string | null | undefined): string | undefined {
  const parsed = parseUUID(value);
  return parsed ?? undefined;
}

/**
 * Parse an array of potential UUIDs, filtering out invalid ones.
 *
 * @example
 * const ids = parseUUIDs(['valid-uuid', 'invalid', 'another-uuid']);
 * // Returns array with only valid UUIDs
 */
export function parseUUIDs(values: (string | null | undefined)[]): string[] {
  return values
    .map(v => parseUUID(v))
    .filter((v): v is string => v !== null);
}

// =============================================================================
// GENERATION
// =============================================================================

/**
 * Generate a new UUID v4.
 * Uses crypto.randomUUID() in browsers/Node 19+, falls back to manual generation.
 *
 * WARNING: Only use this for NEW entities. Never regenerate UUIDs for existing entities.
 * Entity UUIDs are permanent stable handles (CLAUDE.md INV-3).
 */
export function generateUUID(): string {
  // Use native crypto.randomUUID if available (Node 19+, modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format a UUID for display (lowercase, hyphenated).
 * Returns the input if already valid, null if invalid.
 */
export function formatUUID(value: string | null | undefined): string | null {
  const parsed = parseUUID(value);
  return parsed ? parsed.toLowerCase() : null;
}

/**
 * Abbreviate a UUID for display (first 8 chars).
 * Useful for tables and compact views.
 *
 * @example
 * abbreviateUUID('550e8400-e29b-41d4-a716-446655440000') // '550e8400'
 */
export function abbreviateUUID(value: string | null | undefined): string | null {
  const parsed = parseUUID(value);
  return parsed ? parsed.slice(0, 8) : null;
}

// =============================================================================
// COMPARISON
// =============================================================================

/**
 * Compare two UUIDs for equality (case-insensitive).
 *
 * @example
 * uuidEquals('ABC...', 'abc...') // true
 */
export function uuidEquals(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Check if a UUID is in a list (case-insensitive).
 *
 * @example
 * uuidInList(id, [id1, id2, id3])
 */
export function uuidInList(
  uuid: string | null | undefined,
  list: (string | null | undefined)[]
): boolean {
  if (!uuid) return false;
  const uuidLower = uuid.toLowerCase();
  return list.some(item => item && item.toLowerCase() === uuidLower);
}

// =============================================================================
// ENTITY ID HELPERS
// =============================================================================

/**
 * Type guard for entity IDs from route params.
 * Ensures the ID is valid before database queries.
 *
 * @example
 * const { id } = params;
 * if (!isEntityId(id)) {
 *   return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
 * }
 */
export function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && isValidUUID(value);
}

/**
 * Safe entity ID extraction from route params.
 * Returns null if the param is missing or invalid.
 *
 * @example
 * const personId = getEntityId(params, 'id');
 * if (!personId) return notFound();
 */
export function getEntityId(
  params: Record<string, string | string[] | undefined>,
  key: string
): string | null {
  const value = params[key];
  if (Array.isArray(value)) {
    return parseUUID(value[0]);
  }
  return parseUUID(value);
}

// =============================================================================
// NIL UUID
// =============================================================================

/**
 * The nil UUID (all zeros).
 * Rarely used, but valid as a sentinel value.
 */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Check if a UUID is the nil UUID.
 */
export function isNilUUID(value: string | null | undefined): boolean {
  return value?.toLowerCase() === NIL_UUID;
}
