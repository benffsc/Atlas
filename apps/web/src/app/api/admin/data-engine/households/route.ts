import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Data Engine Households API
 *
 * GET: List households with members
 */

interface Household {
  household_id: string;
  primary_place_id: string;
  place_address: string | null;
  household_name: string | null;
  household_type: string | null;
  member_count: number;
  created_at: string;
  source_system: string | null;
}

interface HouseholdMember {
  membership_id: string;
  person_id: string;
  display_name: string | null;
  role: string | null;
  confidence: number;
  inferred_from: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");
  const householdId = searchParams.get("household_id");

  try {
    // If specific household requested, return full details
    if (householdId) {
      const household = await queryOne<Household>(`
        SELECT
          h.household_id::text,
          h.primary_place_id::text,
          p.formatted_address as place_address,
          h.household_name,
          h.household_type,
          h.member_count,
          h.created_at::text,
          h.source_system
        FROM sot.households h
        LEFT JOIN sot.places p ON p.place_id = h.primary_place_id
        WHERE h.household_id = $1::uuid
      `, [householdId]);

      if (!household) {
        return NextResponse.json({ error: "Household not found" }, { status: 404 });
      }

      const members = await queryRows<HouseholdMember>(`
        SELECT
          hm.membership_id::text,
          hm.person_id::text,
          p.display_name,
          hm.role,
          hm.confidence::numeric,
          hm.inferred_from
        FROM sot.household_members hm
        JOIN sot.people p ON p.person_id = hm.person_id
        WHERE hm.household_id = $1::uuid
          AND hm.valid_to IS NULL
        ORDER BY hm.created_at ASC
      `, [householdId]);

      return NextResponse.json({
        household,
        members,
      });
    }

    // List households
    const households = await queryRows<Household>(`
      SELECT
        h.household_id::text,
        h.primary_place_id::text,
        p.formatted_address as place_address,
        h.household_name,
        h.household_type,
        h.member_count,
        h.created_at::text,
        h.source_system
      FROM sot.households h
      LEFT JOIN sot.places p ON p.place_id = h.primary_place_id
      ORDER BY h.member_count DESC, h.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countResult = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int as count FROM sot.households
    `);

    return NextResponse.json({
      households,
      pagination: {
        total: countResult?.count || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching households:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
