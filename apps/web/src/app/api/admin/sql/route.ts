import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api-response";

/**
 * Admin SQL Query Endpoint for E2E Accuracy Tests (FFS-91)
 *
 * Executes read-only SQL queries for test verification.
 * Replaces the anti-pattern of asking Tippy to run SQL
 * (which wasted an API call per verification query).
 *
 * Only accessible in development/test environments.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return apiError("Not available in production", 403);
  }

  let body: { query?: string; readOnly?: boolean };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const { query } = body;

  if (!query || typeof query !== "string") {
    return apiError("query parameter is required", 400);
  }

  // Enforce read-only: query must start with SELECT
  const trimmed = query.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT")) {
    return apiError("Only SELECT queries are allowed", 400);
  }

  // Block dangerous patterns
  const dangerous = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;
  if (dangerous.test(query)) {
    return apiError("Query contains disallowed statements", 400);
  }

  try {
    const rows = await queryRows(query);
    return apiSuccess({ rows });
  } catch (error) {
    console.error("SQL query error:", error);
    return apiError(
      error instanceof Error ? error.message : "Query failed",
      500
    );
  }
}
