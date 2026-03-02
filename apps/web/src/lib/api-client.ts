/**
 * Client-side API utilities for fetching from Atlas API routes.
 *
 * All Atlas API routes use the apiSuccess/apiError response format:
 * - Success: { success: true, data: T, meta?: { total, limit, offset } }
 * - Error:   { success: false, error: { message, code, details? } }
 *
 * This utility automatically unwraps the response to extract the data,
 * providing backwards compatibility with both old and new response formats.
 *
 * IMPORTANT: Use these utilities for ALL internal API calls to prevent
 * breakage when API routes are standardized.
 */

import type { PaginationMeta } from "./api-response";

/**
 * API error thrown when a request fails.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public code: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Result of an API call with optional pagination metadata.
 */
export interface ApiResult<T> {
  data: T;
  meta?: PaginationMeta;
}

/**
 * Fetch from an Atlas API route and automatically unwrap the response.
 *
 * Handles both the new apiSuccess format and legacy raw responses for
 * backwards compatibility during the migration period.
 *
 * @example
 * // Simple fetch
 * const { submission } = await fetchApi<{ submission: IntakeSubmission }>(
 *   `/api/intake/queue/${id}`
 * );
 *
 * // With pagination info
 * const result = await fetchApiWithMeta<{ cats: Cat[] }>('/api/cats?limit=50');
 * console.log(result.data.cats, result.meta?.total);
 *
 * @throws {ApiError} When the API returns an error response
 */
export async function fetchApi<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    // Try to parse error response
    try {
      const errorJson = await response.json();
      if (errorJson.error?.message) {
        throw new ApiError(
          errorJson.error.message,
          errorJson.error.code || response.status,
          errorJson.error.details
        );
      }
      throw new ApiError(
        errorJson.message || `Request failed with status ${response.status}`,
        response.status
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(`Request failed with status ${response.status}`, response.status);
    }
  }

  const json = await response.json();

  // Handle apiSuccess wrapper format: { success: true, data: T }
  // Also handle legacy format where data is at root level
  if (json.success === true && "data" in json) {
    return json.data as T;
  }

  // Legacy format - return as-is
  return json as T;
}

/**
 * Fetch from an Atlas API route and return both data and pagination metadata.
 *
 * Use this when you need pagination info (total count, hasMore, etc.)
 *
 * @example
 * const result = await fetchApiWithMeta<{ submissions: Submission[] }>(
 *   '/api/intake/queue?limit=50&offset=0'
 * );
 * setSubmissions(result.data.submissions);
 * setTotal(result.meta?.total);
 */
export async function fetchApiWithMeta<T>(
  url: string,
  options?: RequestInit
): Promise<ApiResult<T>> {
  const response = await fetch(url, options);

  if (!response.ok) {
    try {
      const errorJson = await response.json();
      if (errorJson.error?.message) {
        throw new ApiError(
          errorJson.error.message,
          errorJson.error.code || response.status,
          errorJson.error.details
        );
      }
      throw new ApiError(
        errorJson.message || `Request failed with status ${response.status}`,
        response.status
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(`Request failed with status ${response.status}`, response.status);
    }
  }

  const json = await response.json();

  // Handle apiSuccess wrapper format
  if (json.success === true && "data" in json) {
    return {
      data: json.data as T,
      meta: json.meta,
    };
  }

  // Legacy format
  return { data: json as T };
}

/**
 * Helper to unwrap an already-fetched JSON response.
 *
 * Use this when you need to handle the response manually but still want
 * to unwrap the apiSuccess format.
 *
 * @example
 * const response = await fetch('/api/cats');
 * const json = await response.json();
 * const cats = unwrapApiResponse<{ cats: Cat[] }>(json);
 */
export function unwrapApiResponse<T>(json: unknown): T {
  if (
    typeof json === "object" &&
    json !== null &&
    "success" in json &&
    (json as { success: boolean }).success === true &&
    "data" in json
  ) {
    return (json as { data: T }).data;
  }
  return json as T;
}

/**
 * POST/PATCH/PUT helper that sends JSON and unwraps the response.
 *
 * @example
 * const result = await postApi<{ submission: Submission }>(
 *   `/api/intake/queue/${id}`,
 *   { submission_status: 'reviewed' }
 * );
 */
export async function postApi<T>(
  url: string,
  body: unknown,
  options?: Omit<RequestInit, "method" | "body" | "headers"> & {
    method?: "POST" | "PATCH" | "PUT" | "DELETE";
    headers?: Record<string, string>;
  }
): Promise<T> {
  return fetchApi<T>(url, {
    method: options?.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    body: JSON.stringify(body),
    ...options,
  });
}
