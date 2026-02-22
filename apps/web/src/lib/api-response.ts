/**
 * Standardized API Response Helpers
 *
 * All API routes SHOULD use these helpers for consistent response format.
 * See CLAUDE.md invariant 50 for rules.
 *
 * Response shapes:
 * - Success: { success: true, data: T, meta?: { total, limit, offset } }
 * - Error:   { success: false, error: { message, code, details? } }
 */

import { NextResponse } from "next/server";

/**
 * Pagination metadata for list responses.
 */
export interface PaginationMeta {
  total?: number;
  limit: number;
  offset: number;
  hasMore?: boolean;
}

/**
 * Standard success response shape.
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

/**
 * Standard error response shape.
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code: number;
    details?: unknown;
  };
}

/**
 * Create a standardized success response.
 *
 * @example
 * // Simple response
 * return apiSuccess({ cat: result });
 *
 * // List response with pagination
 * return apiSuccess(
 *   { cats: results },
 *   { total: count, limit, offset }
 * );
 */
export function apiSuccess<T>(
  data: T,
  meta?: Partial<PaginationMeta>
): NextResponse<ApiSuccessResponse<T>> {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
  };

  if (meta) {
    response.meta = {
      limit: meta.limit ?? 50,
      offset: meta.offset ?? 0,
      ...(meta.total !== undefined && { total: meta.total }),
      ...(meta.hasMore !== undefined && { hasMore: meta.hasMore }),
    };
  }

  return NextResponse.json(response);
}

/**
 * Create a standardized error response.
 *
 * @example
 * return apiError("Cat not found", 404);
 * return apiError("Invalid input", 400, { field: "name", issue: "too short" });
 */
export function apiError(
  message: string,
  status: number,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  const errorBody: ApiErrorResponse["error"] = {
    message,
    code: status,
  };
  if (details !== undefined) {
    errorBody.details = details;
  }
  return NextResponse.json(
    {
      success: false,
      error: errorBody,
    },
    { status }
  );
}

/**
 * Create a 400 Bad Request response.
 */
export function apiBadRequest(
  message: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return apiError(message, 400, details);
}

/**
 * Create a 401 Unauthorized response.
 */
export function apiUnauthorized(
  message = "Unauthorized"
): NextResponse<ApiErrorResponse> {
  return apiError(message, 401);
}

/**
 * Create a 403 Forbidden response.
 */
export function apiForbidden(
  message = "Forbidden"
): NextResponse<ApiErrorResponse> {
  return apiError(message, 403);
}

/**
 * Create a 404 Not Found response.
 */
export function apiNotFound(
  entityType: string,
  id?: string
): NextResponse<ApiErrorResponse> {
  const message = id
    ? `${entityType} with ID ${id} not found`
    : `${entityType} not found`;
  return apiError(message, 404);
}

/**
 * Create a 500 Internal Server Error response.
 * Use sparingly - prefer specific error messages.
 */
export function apiServerError(
  message = "Internal server error",
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return apiError(message, 500, details);
}

/**
 * Create a 409 Conflict response.
 * Use for duplicate entries, merge conflicts, etc.
 */
export function apiConflict(
  message: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return apiError(message, 409, details);
}

/**
 * Create a 422 Unprocessable Entity response.
 * Use for validation errors on well-formed requests.
 */
export function apiUnprocessable(
  message: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return apiError(message, 422, details);
}
