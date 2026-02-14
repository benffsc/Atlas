import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * Admin Query Endpoint for E2E Testing
 *
 * Allows querying specific views for test validation.
 * Only accessible in development/test environments.
 */

// Whitelist of views that can be queried
const ALLOWED_VIEWS = [
  "v_foster_program_stats",
  "v_foster_program_ytd",
  "v_foster_program_quarterly",
  "v_county_cat_stats",
  "v_county_cat_ytd",
  "v_county_cat_quarterly",
  "v_lmfm_stats",
  "v_lmfm_quarterly",
  "v_program_comparison_quarterly",
  "v_program_comparison_ytd",
  "v_request_alteration_stats",
];

export async function GET(request: NextRequest) {
  // Only allow in development/test
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Not available in production" },
      { status: 403 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const viewName = searchParams.get("view");
  const year = searchParams.get("year");
  const limit = searchParams.get("limit");

  if (!viewName) {
    return NextResponse.json(
      { error: "view parameter is required" },
      { status: 400 }
    );
  }

  // Validate view name is in whitelist
  if (!ALLOWED_VIEWS.includes(viewName)) {
    return NextResponse.json(
      { error: `View ${viewName} is not in the allowed list` },
      { status: 400 }
    );
  }

  try {
    // Build query with optional filters
    let query = `SELECT * FROM ops.${viewName}`;
    const conditions: string[] = [];

    if (year) {
      conditions.push(`year = ${parseInt(year, 10)}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    // Add order by if there's a year column
    if (viewName.includes("stats") || viewName.includes("quarterly")) {
      query += ` ORDER BY year DESC`;
      if (viewName.includes("quarterly")) {
        query += `, quarter DESC`;
      } else if (viewName.includes("stats")) {
        query += `, month DESC`;
      }
    }

    if (limit) {
      query += ` LIMIT ${parseInt(limit, 10)}`;
    }

    const rows = await queryRows(query);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Query error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Query failed",
      },
      { status: 500 }
    );
  }
}
