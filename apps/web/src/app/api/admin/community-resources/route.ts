import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  apiSuccess,
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
} from "@/lib/api-response";

interface CommunityResourceRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  phone: string | null;
  address: string | null;
  hours: string | null;
  website_url: string | null;
  scrape_url: string | null;
  icon: string;
  urgency: string;
  display_order: number;
  is_active: boolean;
  last_verified_at: string | null;
  last_verified_by: string | null;
  verify_by: string | null;
  county_served: string | null;
  region: string | null;
  priority: number | null;
}

/**
 * GET /api/admin/community-resources
 * List all community resources, ordered by county then display_order.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();

  try {
    const resources = await queryRows<CommunityResourceRow>(
      `SELECT id, slug, name, category, description, phone, address, hours,
              website_url, scrape_url, icon, urgency, display_order, is_active,
              last_verified_at, last_verified_by, verify_by, county_served,
              region, priority
       FROM ops.community_resources
       ORDER BY county_served NULLS LAST, display_order, name`
    );

    // Collect distinct counties for the filter dropdown
    const counties = [
      ...new Set(
        resources
          .map((r) => r.county_served)
          .filter((c): c is string => c !== null)
      ),
    ].sort();

    return apiSuccess({ resources, counties });
  } catch (error) {
    console.error("[ADMIN-COMMUNITY-RESOURCES] GET error:", error);
    return apiServerError("Failed to fetch community resources");
  }
}

/**
 * POST /api/admin/community-resources
 * Create a new community resource. Admin only.
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin")
    return apiForbidden("Only admins can create resources");

  try {
    const body = await request.json();
    const { name, county_served, phone, address, website_url, description, is_active, category, hours, icon, urgency, display_order, priority, scrape_url, region } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return apiBadRequest("Name is required");
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const created = await queryOne<CommunityResourceRow>(
      `INSERT INTO ops.community_resources
         (slug, name, category, description, phone, address, hours,
          website_url, scrape_url, icon, urgency, display_order, is_active,
          county_served, region, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, slug, name, category, description, phone, address, hours,
                 website_url, scrape_url, icon, urgency, display_order, is_active,
                 last_verified_at, last_verified_by, verify_by, county_served,
                 region, priority`,
      [
        slug,
        name.trim(),
        category || null,
        description || null,
        phone || null,
        address || null,
        hours || null,
        website_url || null,
        scrape_url || null,
        icon || "heart",
        urgency || "info",
        display_order ?? 0,
        is_active !== false,
        county_served || null,
        region || null,
        priority ?? 0,
      ]
    );

    return apiSuccess({ resource: created });
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate")) {
      return apiBadRequest("A resource with this slug already exists");
    }
    console.error("[ADMIN-COMMUNITY-RESOURCES] POST error:", error);
    return apiServerError("Failed to create community resource");
  }
}

/**
 * PATCH /api/admin/community-resources
 * Update a community resource by id. Admin only.
 * Body: { id: string, ...fields }
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin")
    return apiForbidden("Only admins can update resources");

  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id || typeof id !== "string") {
      return apiBadRequest("id is required");
    }

    const ALLOWED_FIELDS = [
      "name",
      "category",
      "description",
      "phone",
      "address",
      "hours",
      "website_url",
      "scrape_url",
      "icon",
      "urgency",
      "display_order",
      "is_active",
      "county_served",
      "region",
      "priority",
      "last_verified_at",
      "last_verified_by",
      "verify_by",
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

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const updated = await queryOne<CommunityResourceRow>(
      `UPDATE ops.community_resources
       SET ${setClauses.join(", ")}
       WHERE id = $${paramIdx}
       RETURNING id, slug, name, category, description, phone, address, hours,
                 website_url, scrape_url, icon, urgency, display_order, is_active,
                 last_verified_at, last_verified_by, verify_by, county_served,
                 region, priority`,
      values
    );

    if (!updated) {
      return apiBadRequest(`Resource with id '${id}' not found`);
    }

    return apiSuccess({ resource: updated });
  } catch (error) {
    console.error("[ADMIN-COMMUNITY-RESOURCES] PATCH error:", error);
    return apiServerError("Failed to update community resource");
  }
}

/**
 * DELETE /api/admin/community-resources?id=UUID
 * Delete a community resource. Admin only.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin")
    return apiForbidden("Only admins can delete resources");

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return apiBadRequest("Missing 'id' query param");

    const deleted = await queryOne<{ id: string; name: string }>(
      `DELETE FROM ops.community_resources
       WHERE id = $1
       RETURNING id, name`,
      [id]
    );

    if (!deleted) {
      return apiBadRequest(`Resource with id '${id}' not found`);
    }

    return apiSuccess({ deleted: deleted.name });
  } catch (error) {
    console.error("[ADMIN-COMMUNITY-RESOURCES] DELETE error:", error);
    return apiServerError("Failed to delete community resource");
  }
}
