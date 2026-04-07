import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

const VALID_CATEGORIES = ["pet_spay", "emergency_vet", "ffsc", "general"];

interface ResourceRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  phone: string | null;
  address: string | null;
  hours: string | null;
  website_url: string | null;
  icon: string;
  urgency: string;
  display_order: number;
  scrape_status: string | null;
  last_verified_at: string | null;
  verify_by: string | null;
  county_served: string | null;
  region: string | null;
  priority: number | null;
}

/**
 * GET /api/resources?category=pet_spay&county=Marin
 *
 * Serves active community resources by category.
 * Returns in TippyResourceCard-compatible format for direct kiosk use.
 *
 * Query params:
 *   - category (required): pet_spay, emergency_vet, ffsc, general
 *   - county (optional): filter to a single county_served value (e.g., 'Marin').
 *                        Statewide resources are always included when this is set.
 *                        FFS-1184 — used by the out-of-service-area email template.
 *   - include_verification (optional): if "true", includes scrape status info
 *
 * FFS-1114, FFS-1184
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const county = searchParams.get("county");
    const includeVerification = searchParams.get("include_verification") === "true";

    if (!category) {
      return apiBadRequest("category parameter is required");
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return apiBadRequest(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
    }

    // Build query — county filter is optional. When set, also include 'statewide' rows.
    const params: (string | null)[] = [category];
    let countyClause = "";
    if (county) {
      params.push(county);
      countyClause = ` AND (county_served = $2 OR county_served = 'statewide')`;
    }

    const resources = await queryRows<ResourceRow>(
      `SELECT id, slug, name, category, description, phone, address, hours,
              website_url, icon, urgency, display_order,
              scrape_status, last_verified_at::text, verify_by::text,
              county_served, region, priority
       FROM ops.community_resources
       WHERE category = $1
         AND is_active = TRUE
         ${countyClause}
       ORDER BY
         ${county ? `(county_served = 'statewide') ASC, priority ASC, ` : ""}
         display_order, name`,
      params,
    );

    const result = resources.map((r) => ({
      // TippyResourceCard-compatible fields
      name: r.name,
      description: r.description || "",
      phone: r.phone || undefined,
      address: r.address || undefined,
      hours: r.hours || undefined,
      icon: r.icon,
      urgency: r.urgency as "emergency" | "soon" | "info",
      // Extra fields for admin/management
      slug: r.slug,
      website_url: r.website_url,
      county_served: r.county_served,
      region: r.region,
      priority: r.priority,
      ...(includeVerification
        ? {
            scrape_status: r.scrape_status,
            last_verified_at: r.last_verified_at,
            verify_by: r.verify_by,
          }
        : {}),
    }));

    return apiSuccess(result);
  } catch (error) {
    console.error("Resources API error:", error);
    return apiServerError("Failed to fetch resources");
  }
}
