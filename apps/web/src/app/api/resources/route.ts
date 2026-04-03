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
}

/**
 * GET /api/resources?category=pet_spay
 *
 * Serves active community resources by category.
 * Returns in TippyResourceCard-compatible format for direct kiosk use.
 *
 * Query params:
 *   - category (required): pet_spay, emergency_vet, ffsc, general
 *   - include_verification (optional): if "true", includes scrape status info
 *
 * FFS-1114
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const includeVerification = searchParams.get("include_verification") === "true";

    if (!category) {
      return apiBadRequest("category parameter is required");
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return apiBadRequest(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
    }

    const resources = await queryRows<ResourceRow>(
      `SELECT id, slug, name, category, description, phone, address, hours,
              website_url, icon, urgency, display_order,
              scrape_status, last_verified_at::text, verify_by::text
       FROM ops.community_resources
       WHERE category = $1
         AND is_active = TRUE
       ORDER BY display_order, name`,
      [category],
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
