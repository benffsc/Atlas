import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * GET /api/places/[id]/contexts
 *
 * Returns all active classifications for a place, including:
 * - Context type and label
 * - Organization details (if organization context)
 * - Colony details (if linked to a colony)
 * - Verification status
 */

interface PlaceClassification {
  context_id: string;
  context_type: string;
  context_label: string;
  is_verified: boolean;
  confidence: number;
  evidence_type: string | null;
  valid_from: string | null;
  assigned_by: string | null;
  assigned_at: string;
  // Organization fields
  organization_name: string | null;
  known_org_id: string | null;
  known_org_name: string | null;
  known_org_type: string | null;
  // Colony fields
  colony_id: string | null;
  colony_name: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    // Check if place exists (and handle merged places)
    const placeCheck = await queryOne<{
      place_id: string;
      merged_into_place_id: string | null;
      formatted_address: string | null;
    }>(
      `SELECT place_id, merged_into_place_id, formatted_address
       FROM sot.places WHERE place_id = $1`,
      [id]
    );

    if (!placeCheck) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const placeId = placeCheck.merged_into_place_id || id;

    // Fetch all active contexts with org and colony details
    const contexts = await queryRows<PlaceClassification>(
      `SELECT
         pc.context_id,
         pc.context_type,
         pct.display_label AS context_label,
         pc.is_verified,
         pc.confidence,
         pc.evidence_type,
         pc.valid_from,
         pc.assigned_by,
         pc.assigned_at,
         -- Organization fields
         pc.organization_name,
         pc.known_org_id,
         ko.canonical_name AS known_org_name,
         ko.org_type AS known_org_type,
         -- Colony fields (if place is in a colony)
         cp.colony_id,
         c.colony_name
       FROM sot.place_contexts pc
       JOIN sot.place_context_types pct ON pct.context_type = pc.context_type
       LEFT JOIN sot.known_organizations ko ON ko.org_id = pc.known_org_id
       LEFT JOIN sot.colony_places cp ON cp.place_id = pc.place_id
       LEFT JOIN sot.colonies c ON c.colony_id = cp.colony_id
       WHERE pc.place_id = $1
         AND pc.valid_to IS NULL
       ORDER BY pct.sort_order`,
      [placeId]
    );

    return NextResponse.json({
      place_id: placeId,
      address: placeCheck.formatted_address,
      contexts: contexts || [],
      _merged_from: placeCheck.merged_into_place_id ? id : undefined,
    });
  } catch (error) {
    console.error("Error fetching place contexts:", error);
    return NextResponse.json(
      { error: "Failed to fetch place contexts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/places/[id]/contexts
 *
 * Adds a new classification to a place.
 * Body: {
 *   context_type: string,       // Required: 'organization', 'colony_site', etc.
 *   organization_name?: string, // For organization contexts
 *   known_org_id?: string,      // Link to known_organizations registry
 *   notes?: string,             // Evidence notes
 *   assigned_by?: string        // Staff name/ID
 * }
 *
 * Classifications added via UI are always marked as manual/verified.
 */

interface AddContextBody {
  context_type: string;
  organization_name?: string;
  known_org_id?: string;
  notes?: string;
  assigned_by?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: AddContextBody = await request.json();

    if (!body.context_type) {
      return NextResponse.json(
        { error: "context_type is required" },
        { status: 400 }
      );
    }

    // Validate context type exists
    const contextTypeCheck = await queryOne<{ context_type: string }>(
      `SELECT context_type FROM sot.place_context_types
       WHERE context_type = $1 AND is_active = TRUE`,
      [body.context_type]
    );

    if (!contextTypeCheck) {
      return NextResponse.json(
        { error: `Invalid context type: ${body.context_type}` },
        { status: 400 }
      );
    }

    // Check if place exists (and handle merged places)
    const placeCheck = await queryOne<{
      place_id: string;
      merged_into_place_id: string | null;
    }>(
      `SELECT place_id, merged_into_place_id
       FROM sot.places WHERE place_id = $1`,
      [id]
    );

    if (!placeCheck) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const placeId = placeCheck.merged_into_place_id || id;

    // Use the set_place_classification function (creates manual/verified contexts)
    const result = await queryOne<{ context_id: string }>(
      `SELECT trapper.set_place_classification(
         p_place_id := $1,
         p_context_type := $2,
         p_assigned_by := $3,
         p_organization_name := $4,
         p_known_org_id := $5,
         p_notes := $6
       ) AS context_id`,
      [
        placeId,
        body.context_type,
        body.assigned_by || "staff",
        body.organization_name || null,
        body.known_org_id || null,
        body.notes || null,
      ]
    );

    if (!result?.context_id) {
      return NextResponse.json(
        { error: "Failed to create classification" },
        { status: 500 }
      );
    }

    // Fetch the created context to return full details
    const context = await queryOne<PlaceClassification>(
      `SELECT
         pc.context_id,
         pc.context_type,
         pct.display_label AS context_label,
         pc.is_verified,
         pc.confidence,
         pc.evidence_type,
         pc.valid_from,
         pc.assigned_by,
         pc.assigned_at,
         pc.organization_name,
         pc.known_org_id,
         ko.canonical_name AS known_org_name,
         ko.org_type AS known_org_type,
         cp.colony_id,
         c.colony_name
       FROM sot.place_contexts pc
       JOIN sot.place_context_types pct ON pct.context_type = pc.context_type
       LEFT JOIN sot.known_organizations ko ON ko.org_id = pc.known_org_id
       LEFT JOIN sot.colony_places cp ON cp.place_id = pc.place_id
       LEFT JOIN sot.colonies c ON c.colony_id = cp.colony_id
       WHERE pc.context_id = $1`,
      [result.context_id]
    );

    return NextResponse.json(context, { status: 201 });
  } catch (error) {
    console.error("Error adding place context:", error);
    return NextResponse.json(
      { error: "Failed to add classification" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/places/[id]/contexts
 *
 * Removes a classification from a place.
 * Query params: ?type=organization (the context_type to remove)
 *
 * This ends the context (sets valid_to) rather than deleting, preserving history.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const contextType = searchParams.get("type");

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  if (!contextType) {
    return NextResponse.json(
      { error: "Context type is required (use ?type=...)" },
      { status: 400 }
    );
  }

  try {
    // Check if place exists (and handle merged places)
    const placeCheck = await queryOne<{
      place_id: string;
      merged_into_place_id: string | null;
    }>(
      `SELECT place_id, merged_into_place_id
       FROM sot.places WHERE place_id = $1`,
      [id]
    );

    if (!placeCheck) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const placeId = placeCheck.merged_into_place_id || id;

    // Use the remove_place_classification function
    const result = await queryOne<{ removed: boolean }>(
      `SELECT trapper.remove_place_classification($1, $2) AS removed`,
      [placeId, contextType]
    );

    if (!result?.removed) {
      return NextResponse.json(
        { error: "Classification not found or already removed" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Removed ${contextType} classification from place`,
    });
  } catch (error) {
    console.error("Error removing place context:", error);
    return NextResponse.json(
      { error: "Failed to remove classification" },
      { status: 500 }
    );
  }
}
