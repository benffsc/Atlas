import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * GET /api/context-types
 *
 * Returns all available place context types for the classification UI.
 * These are the tags that can be applied to places (organization, colony_site, etc.)
 */

interface ContextType {
  context_type: string;
  display_label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active_only") !== "false";

    const sql = `
      SELECT
        context_type,
        display_label,
        description,
        sort_order,
        is_active
      FROM sot.place_context_types
      ${activeOnly ? "WHERE is_active = TRUE" : ""}
      ORDER BY sort_order, display_label
    `;

    const contextTypes = await queryRows<ContextType>(sql);

    // Group by category for UI convenience
    const categorized = {
      property_types: (contextTypes || []).filter((ct) =>
        ["residential", "multi_unit", "business", "organization", "public_space", "farm_ranch"].includes(
          ct.context_type
        )
      ),
      operational: (contextTypes || []).filter((ct) =>
        ["colony_site", "feeding_station", "foster_home", "adopter_residence"].includes(
          ct.context_type
        )
      ),
      facility: (contextTypes || []).filter((ct) =>
        ["clinic", "shelter", "partner_org", "trap_pickup"].includes(ct.context_type)
      ),
      personnel: (contextTypes || []).filter((ct) =>
        ["trapper_base", "volunteer_location"].includes(ct.context_type)
      ),
    };

    return NextResponse.json({
      all: contextTypes || [],
      categorized,
    });
  } catch (error) {
    console.error("Error fetching context types:", error);
    return NextResponse.json(
      { error: "Failed to fetch context types" },
      { status: 500 }
    );
  }
}
