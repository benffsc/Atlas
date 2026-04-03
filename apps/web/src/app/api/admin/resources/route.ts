import { NextRequest } from "next/server";
import { execute } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

/**
 * PUT /api/admin/resources
 *
 * Update a single community resource by slug.
 * Accepts partial updates — only provided fields are changed.
 * Clears scrape_status to 'pending' to trigger re-verification.
 *
 * FFS-1099 (Digital Lobby Kiosk)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { slug, ...fields } = body;

    if (!slug || typeof slug !== "string") {
      return apiBadRequest("slug is required");
    }

    // Build dynamic SET clause from provided fields
    const ALLOWED_FIELDS = [
      "name",
      "phone",
      "address",
      "hours",
      "description",
      "icon",
      "urgency",
      "is_active",
      "website_url",
      "scrape_url",
      "display_order",
    ];

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const field of ALLOWED_FIELDS) {
      if (field in fields) {
        setClauses.push(`${field} = $${paramIdx}`);
        values.push(fields[field]);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) {
      return apiBadRequest("No valid fields to update");
    }

    // Always update timestamp and reset scrape status
    setClauses.push(`updated_at = NOW()`);
    setClauses.push(`scrape_status = 'pending'`);

    values.push(slug);

    const result = await execute(
      `UPDATE ops.community_resources
       SET ${setClauses.join(", ")}
       WHERE slug = $${paramIdx}`,
      values,
    );

    if (result.rowCount === 0) {
      return apiBadRequest(`Resource with slug '${slug}' not found`);
    }

    return apiSuccess({ updated: slug });
  } catch (error) {
    console.error("[ADMIN-RESOURCES] Update error:", error);
    return apiServerError("Failed to update resource");
  }
}
