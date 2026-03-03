/**
 * API Response Helpers for E2E Tests
 *
 * Atlas API routes use apiSuccess() which wraps responses:
 * { success: true, data: T, meta?: {...} }
 *
 * These helpers extract the inner data payload for cleaner test assertions.
 */

/**
 * Standard API response wrapper from apiSuccess()
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    total?: number;
    limit?: number;
    offset?: number;
    [key: string]: unknown;
  };
}

/**
 * API error response format
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
 * Combined API response type
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Check if response is a success response
 */
export function isSuccessResponse<T>(
  response: unknown
): response is ApiSuccessResponse<T> {
  const res = response as { success?: boolean };
  return res?.success === true;
}

/**
 * Check if response is an error response
 */
export function isErrorResponse(response: unknown): response is ApiErrorResponse {
  const res = response as { success?: boolean };
  return res?.success === false;
}

/**
 * Unwrap apiSuccess() response format to get the inner data.
 *
 * API routes return: { success: true, data: { ... } }
 * This helper extracts the `data` field.
 *
 * @example
 * const response = await request.get("/api/beacon/summary");
 * const wrapped = await response.json();
 * const data = unwrapApiResponse<BeaconSummary>(wrapped);
 * expect(data.summary.total_cats).toBeGreaterThan(0);
 */
export function unwrapApiResponse<T>(response: unknown): T {
  if (isSuccessResponse<T>(response)) {
    return response.data;
  }
  // Fallback for non-wrapped responses or direct data
  return response as T;
}

/**
 * Get the error message from an API error response.
 */
export function getErrorMessage(response: unknown): string | null {
  if (isErrorResponse(response)) {
    return response.error.message;
  }
  return null;
}

/**
 * Type guard to ensure response was successful and extract data.
 * Throws if response is an error.
 *
 * @example
 * const data = requireSuccess<BeaconSummary>(wrapped);
 * // TypeScript knows data is BeaconSummary, not error
 */
export function requireSuccess<T>(response: unknown): T {
  if (isErrorResponse(response)) {
    throw new Error(`API returned error: ${response.error.message}`);
  }
  return unwrapApiResponse<T>(response);
}

/**
 * Fetch JSON and unwrap apiSuccess format in one step.
 *
 * @example
 * const data = await fetchApiData<BeaconSummary>(page.request, "/api/beacon/summary");
 * if (data) {
 *   expect(data.summary.total_cats).toBeGreaterThan(0);
 * }
 */
export async function fetchApiData<T>(
  request: {
    get: (url: string) => Promise<{ ok(): boolean; json(): Promise<unknown> }>;
  },
  url: string
): Promise<T | null> {
  const res = await request.get(url);
  if (!res.ok()) return null;
  const wrapped = await res.json();
  return unwrapApiResponse<T>(wrapped);
}

/**
 * Fetch JSON with POST and unwrap apiSuccess format.
 */
export async function postApiData<T>(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{ ok(): boolean; json(): Promise<unknown> }>;
  },
  url: string,
  data: unknown
): Promise<T | null> {
  const res = await request.post(url, { data });
  if (!res.ok()) return null;
  const wrapped = await res.json();
  return unwrapApiResponse<T>(wrapped);
}
