import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PersonAddress {
  place_id: string;
  formatted_address: string | null;
  display_name: string | null;
  role: string;
  confidence: number | null;
}

/**
 * GET /api/people/[id]/addresses
 *
 * Returns all addresses associated with a person from person_place_relationships.
 * Used for address autofill in intake forms.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    const addresses = await queryRows<PersonAddress>(
      `
      SELECT
        ppr.place_id,
        pl.formatted_address,
        pl.display_name,
        ppr.role,
        ppr.confidence
      FROM sot.person_place_relationships ppr
      JOIN sot.places pl ON pl.place_id = ppr.place_id
      WHERE ppr.person_id = $1
        AND pl.merged_into_place_id IS NULL
      ORDER BY
        ppr.confidence DESC NULLS LAST,
        CASE ppr.role
          WHEN 'resident' THEN 1
          WHEN 'owner' THEN 2
          WHEN 'requester' THEN 3
          ELSE 4
        END,
        ppr.created_at DESC
      `,
      [id]
    );

    return NextResponse.json({ addresses });
  } catch (error) {
    console.error("Error fetching person addresses:", error);
    return NextResponse.json(
      { error: "Failed to fetch addresses" },
      { status: 500 }
    );
  }
}
