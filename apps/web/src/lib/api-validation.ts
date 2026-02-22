/**
 * Centralized API Validation Utilities
 *
 * All API routes MUST use these helpers for validation.
 * See CLAUDE.md invariants 46-51 for rules.
 *
 * @see docs/E2E_TEST_UPGRADE_PLAN.md for rationale
 */

import { NextRequest, NextResponse } from "next/server";

// Re-export existing validators for convenience
export { isValidUUID, validatePagination, validatePersonName } from "./validation";

/**
 * Standardized API error class.
 * Thrown by validation helpers, caught by withErrorHandling().
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Validate UUID parameter and throw ApiError if invalid.
 * Use at the start of all [id] routes.
 *
 * @example
 * export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 *   const { id } = await params;
 *   requireValidUUID(id, "cat");
 *   // ... rest of handler
 * }
 */
export function requireValidUUID(id: string | undefined | null, entityType: string): asserts id is string {
  if (!id) {
    throw new ApiError(`${entityType} ID is required`, 400);
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(id)) {
    throw new ApiError(`Invalid ${entityType} ID format`, 400);
  }
}

/**
 * Parse and validate pagination parameters from URL search params.
 * Returns safe defaults for invalid/missing values.
 *
 * @example
 * const { limit, offset } = parsePagination(request.nextUrl.searchParams);
 * // Or with custom limits:
 * const { limit, offset } = parsePagination(searchParams, { maxLimit: 200 });
 */
export function parsePagination(
  searchParams: URLSearchParams,
  options?: {
    maxLimit?: number;
    defaultLimit?: number;
  }
): { limit: number; offset: number } {
  const maxLimit = options?.maxLimit ?? 100;
  const defaultLimit = options?.defaultLimit ?? 50;

  const limitStr = searchParams.get("limit");
  const offsetStr = searchParams.get("offset");

  // Parse limit: must be positive integer, capped at maxLimit
  let limit = parseInt(limitStr || String(defaultLimit), 10);
  if (isNaN(limit) || limit < 1) {
    limit = defaultLimit;
  }
  limit = Math.min(limit, maxLimit);

  // Parse offset: must be non-negative integer
  let offset = parseInt(offsetStr || "0", 10);
  if (isNaN(offset) || offset < 0) {
    offset = 0;
  }

  return { limit, offset };
}

/**
 * Validate that a value is one of the allowed enum values.
 * Returns null if value is null/undefined, validated value otherwise.
 * Throws ApiError if value is invalid.
 *
 * @example
 * const status = requireValidEnum(body.status, ENTITY_ENUMS.REQUEST_STATUS, "status");
 */
export function requireValidEnum<T extends string>(
  value: string | null | undefined,
  validValues: readonly T[],
  fieldName: string
): T | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!validValues.includes(value as T)) {
    throw new ApiError(
      `Invalid ${fieldName}. Must be one of: ${validValues.join(", ")}`,
      400
    );
  }

  return value as T;
}

/**
 * Validate enum value, but only if provided (non-null).
 * For PATCH operations where field is optional.
 */
export function validateEnumIfProvided<T extends string>(
  value: string | null | undefined,
  validValues: readonly T[],
  fieldName: string
): void {
  if (value !== null && value !== undefined) {
    requireValidEnum(value, validValues, fieldName);
  }
}

/**
 * Error handler wrapper for API routes.
 * Catches ApiError and other errors, returns standardized responses.
 *
 * @example
 * export const GET = withErrorHandling(async (request, { params }) => {
 *   const { id } = await params;
 *   requireValidUUID(id, "cat");
 *   // ... handler logic
 *   return NextResponse.json(data);
 * });
 */
export function withErrorHandling<
  TContext extends { params: Promise<Record<string, string>> }
>(
  handler: (request: NextRequest, context: TContext) => Promise<NextResponse>
): (request: NextRequest, context: TContext) => Promise<NextResponse> {
  return async (request: NextRequest, context: TContext) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) {
        const errorBody: { message: string; code: number; details?: unknown } = {
          message: error.message,
          code: error.status,
        };
        if (error.details !== undefined) {
          errorBody.details = error.details;
        }
        return NextResponse.json(
          {
            success: false,
            error: errorBody,
          },
          { status: error.status }
        );
      }

      // Log unexpected errors
      console.error("Unhandled API error:", error);

      return NextResponse.json(
        {
          success: false,
          error: {
            message: "Internal server error",
            code: 500,
          },
        },
        { status: 500 }
      );
    }
  };
}

/**
 * Require that a request body field is present and non-empty.
 */
export function requireField<T>(
  value: T | null | undefined,
  fieldName: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new ApiError(`${fieldName} is required`, 400);
  }
}

/**
 * Require that a string field is non-empty after trimming.
 */
export function requireNonEmptyString(
  value: string | null | undefined,
  fieldName: string
): string {
  if (!value || value.trim() === "") {
    throw new ApiError(`${fieldName} is required and cannot be empty`, 400);
  }
  return value.trim();
}
