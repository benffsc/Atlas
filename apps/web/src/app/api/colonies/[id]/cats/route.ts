import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface LinkedCat {
  cat_id: string;
  cat_name: string | null;
  microchip: string | null;
  sex: string | null;
  ownership_type: string;
  is_owned_cat: boolean;
  is_altered: boolean;
  place_id: string;
  place_address: string | null;
  linked_at: string;
}

// GET /api/colonies/[id]/cats - Get all cats linked to colony places
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: colonyId } = await params;

  try {
    // Verify colony exists
    const colony = await queryOne<{ colony_id: string }>(
      `SELECT colony_id FROM sot.colonies WHERE colony_id = $1`,
      [colonyId]
    );

    if (!colony) {
      return NextResponse.json({ error: "Colony not found" }, { status: 404 });
    }

    // Get linked cats with place info
    const cats = await queryRows<LinkedCat>(
      `SELECT DISTINCT ON (lc.cat_id)
        lc.cat_id,
        lc.cat_name,
        lc.microchip,
        lc.sex,
        lc.ownership_type,
        lc.is_owned_cat,
        lc.is_altered,
        lc.place_id,
        p.formatted_address as place_address,
        lc.linked_at
      FROM ops.v_colony_linked_cats lc
      JOIN sot.places p ON p.place_id = lc.place_id
      WHERE lc.colony_id = $1
      ORDER BY lc.cat_id, lc.linked_at DESC`,
      [colonyId]
    );

    // Separate community cats from owned cats
    const communityCats = cats.filter((c) => !c.is_owned_cat);
    const ownedCats = cats.filter((c) => c.is_owned_cat);

    // Calculate stats
    const stats = {
      total: cats.length,
      community: communityCats.length,
      owned: ownedCats.length,
      community_altered: communityCats.filter((c) => c.is_altered).length,
      community_unaltered: communityCats.filter((c) => !c.is_altered).length,
    };

    return NextResponse.json({
      cats: communityCats,
      owned_cats: ownedCats,
      stats,
    });
  } catch (error) {
    console.error("Error fetching colony cats:", error);
    return NextResponse.json(
      { error: "Failed to fetch cats" },
      { status: 500 }
    );
  }
}
