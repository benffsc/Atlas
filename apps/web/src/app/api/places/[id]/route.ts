import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { logFieldEdits } from "@/lib/audit";

interface PlaceDetailRow {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  created_at: string;
  updated_at: string;
  cats: object[] | null;
  people: object[] | null;
  place_relationships: object[] | null;
  cat_count: number;
  person_count: number;
}

interface PlaceContext {
  context_id: string;
  context_type: string;
  context_label: string;
  valid_from: string | null;
  evidence_type: string | null;
  confidence: number;
  is_verified: boolean;
  assigned_at: string;
  source_system: string | null;
}

interface PartnerOrgInfo {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  org_type: string | null;
  relationship_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  appointments_count: number | null;
  cats_processed: number | null;
  first_appointment_date: string | null;
  last_appointment_date: string | null;
}

interface VerificationInfo {
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
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
    // First check if this place was merged into another
    const mergeCheck = await queryOne<{ merged_into_place_id: string | null }>(
      `SELECT merged_into_place_id FROM sot.places WHERE place_id = $1`,
      [id]
    );

    // If place was merged, use the canonical place ID
    const placeId = mergeCheck?.merged_into_place_id || id;

    const sql = `
      SELECT
        v.place_id,
        v.display_name,
        v.original_display_name,
        v.formatted_address,
        v.place_kind,
        v.is_address_backed,
        v.has_cat_activity,
        sa.city AS locality,
        sa.postal_code,
        sa.state AS state_province,
        v.coordinates,
        v.created_at,
        v.updated_at,
        v.cats,
        v.people,
        v.place_relationships,
        v.cat_count,
        v.person_count
      FROM sot.v_place_detail_v2 v
      LEFT JOIN sot.places p ON p.place_id = v.place_id
      LEFT JOIN sot.addresses sa ON sa.address_id = p.sot_address_id
      WHERE v.place_id = $1
    `;

    let place = await queryOne<PlaceDetailRow>(sql, [placeId]);

    // Fallback: v_place_detail_v2 filters is_address_backed=true.
    // Places with coordinates but no geocoded address (2,494 places) would
    // 404 without this fallback. Query the places table directly.
    // V2: Uses sot.cat_place and sot.person_place (not *_relationships suffix)
    if (!place) {
      const fallbackSql = `
        SELECT
          p.place_id,
          COALESCE(p.display_name, p.formatted_address, 'Unknown Place') AS display_name,
          p.formatted_address,
          p.place_kind::text AS place_kind,
          p.is_address_backed,
          EXISTS(SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = p.place_id) AS has_cat_activity,
          sa.city AS locality,
          sa.postal_code,
          sa.state AS state_province,
          CASE WHEN p.location IS NOT NULL THEN
            json_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry))
          ELSE NULL END AS coordinates,
          p.created_at::text AS created_at,
          p.updated_at::text AS updated_at,
          COALESCE((
            SELECT json_agg(json_build_object(
              'cat_id', c.cat_id, 'cat_name', c.name, 'sex', c.sex,
              'microchip', c.microchip, 'source_system', c.source_system
            ))
            FROM sot.cat_place cp
            JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
            WHERE cp.place_id = p.place_id
          ), '[]'::json) AS cats,
          COALESCE((
            SELECT json_agg(json_build_object(
              'person_id', per.person_id,
              'display_name', per.display_name,
              'role', pp.relationship_type::text
            ))
            FROM sot.person_place pp
            JOIN sot.people per ON per.person_id = pp.person_id
            WHERE pp.place_id = p.place_id
              AND per.merged_into_person_id IS NULL
              AND per.display_name IS NOT NULL
          ), '[]'::json) AS people,
          '[]'::json AS place_relationships,
          COALESCE((SELECT COUNT(DISTINCT cp.cat_id) FROM sot.cat_place cp WHERE cp.place_id = p.place_id), 0) AS cat_count,
          COALESCE((SELECT COUNT(DISTINCT pp.person_id) FROM sot.person_place pp JOIN sot.people per ON per.person_id = pp.person_id WHERE pp.place_id = p.place_id AND per.merged_into_person_id IS NULL AND per.display_name IS NOT NULL), 0) AS person_count
        FROM sot.places p
        LEFT JOIN sot.addresses sa ON sa.address_id = p.sot_address_id
        WHERE p.place_id = $1
          AND p.merged_into_place_id IS NULL
      `;
      place = await queryOne<PlaceDetailRow>(fallbackSql, [placeId]);
    }

    if (!place) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    // Fetch verification info from places table
    const verification = await queryOne<VerificationInfo>(
      `SELECT
         p.verified_at,
         p.verified_by,
         s.display_name AS verified_by_name
       FROM sot.places p
       LEFT JOIN ops.staff s ON p.verified_by = s.staff_id::text
       WHERE p.place_id = $1`,
      [placeId]
    );

    // Fetch place contexts (colony_site, foster_home, etc.)
    const contextsResult = await query<PlaceContext>(
      `SELECT
         pc.id AS context_id,
         pc.context_type,
         pct.display_label AS context_label,
         pc.valid_from,
         pc.evidence_type,
         pc.confidence,
         pc.is_verified,
         pc.created_at AS assigned_at,
         pc.source_system
       FROM sot.place_contexts pc
       JOIN sot.place_context_types pct ON pct.context_type = pc.context_type
       WHERE pc.place_id = $1
         AND pc.valid_to IS NULL
       ORDER BY pct.sort_order, pc.created_at DESC`,
      [placeId]
    );
    const contexts = contextsResult?.rows || [];

    // Partner organizations table doesn't exist in V2 yet
    // When it's created, update this query to use the correct schema
    const partnerOrg: PartnerOrgInfo | null = null;

    const response = {
      ...place,
      verified_at: verification?.verified_at || null,
      verified_by: verification?.verified_by || null,
      verified_by_name: verification?.verified_by_name || null,
      contexts,
      partner_org: partnerOrg || null,
    };

    // Include redirect info if the original ID was merged
    if (mergeCheck?.merged_into_place_id) {
      return NextResponse.json({
        ...response,
        _merged_from: id,
        _canonical_id: placeId,
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching place detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch place detail" },
      { status: 500 }
    );
  }
}

// Valid place kinds matching the database enum
const VALID_PLACE_KINDS = [
  "unknown",
  "residential_house",
  "apartment_unit",
  "apartment_building",
  "business",
  "clinic",
  "neighborhood",
  "outdoor_site",
  "mobile_home_space",
] as const;

interface UpdatePlaceBody {
  display_name?: string | null;
  place_kind?: string;
  // Address correction fields (with audit tracking)
  formatted_address?: string;
  locality?: string;
  postal_code?: string;
  state_province?: string;
  latitude?: number;
  longitude?: number;
  // Audit info
  changed_by?: string;
  change_reason?: string;
  change_notes?: string;
}

export async function PATCH(
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
    const body: UpdatePlaceBody = await request.json();
    const changed_by = body.changed_by || "web_user";
    const change_reason = body.change_reason || "manual_update";
    const change_notes = body.change_notes || null;

    // Validate place_kind if provided
    if (body.place_kind && !VALID_PLACE_KINDS.includes(body.place_kind as typeof VALID_PLACE_KINDS[number])) {
      return NextResponse.json(
        { error: `Invalid place_kind. Must be one of: ${VALID_PLACE_KINDS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate display_name if provided (null clears the label, empty string rejected)
    if (body.display_name !== undefined && body.display_name !== null && body.display_name.trim() === "") {
      return NextResponse.json(
        { error: "display_name cannot be empty string. Pass null to clear." },
        { status: 400 }
      );
    }

    // Fields that require audit tracking
    const auditedFields = ["formatted_address", "locality", "postal_code", "state_province"];
    const simpleFields = ["display_name", "place_kind"];

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Simple fields (no audit needed for display_name and place_kind changes)
    if (body.display_name !== undefined) {
      if (body.display_name === null) {
        // Explicitly clearing the label
        updates.push(`display_name = NULL`);
      } else {
        updates.push(`display_name = $${paramIndex}`);
        values.push(body.display_name.trim());
        paramIndex++;
      }
    }

    if (body.place_kind !== undefined) {
      updates.push(`place_kind = $${paramIndex}`);
      values.push(body.place_kind);
      paramIndex++;
    }

    // Address fields - with audit tracking
    // First, get current values for audit log
    if (body.formatted_address !== undefined || body.locality !== undefined ||
        body.postal_code !== undefined || body.state_province !== undefined ||
        body.latitude !== undefined || body.longitude !== undefined) {

      // Get current place data for audit comparison (V2: addresses use city/state not locality/state_province)
      const currentSql = `
        SELECT p.formatted_address, a.city AS locality, a.postal_code, a.state AS state_province,
               ST_Y(p.location::geometry) as lat, ST_X(p.location::geometry) as lng
        FROM sot.places p
        LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
        WHERE p.place_id = $1
      `;
      const current = await queryOne<{
        formatted_address: string | null;
        locality: string | null;
        postal_code: string | null;
        state_province: string | null;
        lat: number | null;
        lng: number | null;
      }>(currentSql, [id]);

      if (!current) {
        return NextResponse.json({ error: "Place not found" }, { status: 404 });
      }

      // Log changes to place_changes table using parameterized queries (prevents SQL injection)
      const auditChanges: { field: string; oldVal: string | null; newVal: string }[] = [];

      if (body.formatted_address !== undefined && body.formatted_address !== current.formatted_address) {
        auditChanges.push({
          field: 'formatted_address',
          oldVal: current.formatted_address,
          newVal: body.formatted_address
        });
        updates.push(`formatted_address = $${paramIndex}`);
        values.push(body.formatted_address);
        paramIndex++;
      }

      // V2: locality, postal_code, state_province are on addresses table, not places
      // These fields require updating the linked address record, which is not yet implemented
      // For now, log the audit but skip the direct place update
      if (body.locality !== undefined && body.locality !== current.locality) {
        auditChanges.push({
          field: 'locality',
          oldVal: current.locality,
          newVal: body.locality
        });
        // TODO: Update sot.addresses where address_id = (SELECT sot_address_id FROM sot.places WHERE place_id = $1)
      }

      if (body.postal_code !== undefined && body.postal_code !== current.postal_code) {
        auditChanges.push({
          field: 'postal_code',
          oldVal: current.postal_code,
          newVal: body.postal_code
        });
        // TODO: Update sot.addresses
      }

      if (body.state_province !== undefined && body.state_province !== current.state_province) {
        auditChanges.push({
          field: 'state_province',
          oldVal: current.state_province,
          newVal: body.state_province
        });
        // TODO: Update sot.addresses
      }

      // Update coordinates if provided
      if (body.latitude !== undefined && body.longitude !== undefined) {
        const coordChanged = current.lat !== body.latitude || current.lng !== body.longitude;
        if (coordChanged) {
          auditChanges.push({
            field: 'coordinates',
            oldVal: current.lat !== null && current.lng !== null ? `${current.lat},${current.lng}` : null,
            newVal: `${body.latitude},${body.longitude}`
          });
          updates.push(`location = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
          values.push(body.longitude, body.latitude);
          paramIndex += 2;
        }
      }

      // Log changes to centralized entity_edits table
      if (auditChanges.length > 0) {
        await logFieldEdits(
          "place",
          id,
          auditChanges.map((c) => ({
            field: c.field,
            oldValue: c.oldVal,
            newValue: c.newVal,
          })),
          {
            editedBy: changed_by,
            reason: change_reason,
            editSource: "web_ui",
          }
        );
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add place_id to values
    values.push(id);

    const sql = `
      UPDATE sot.places
      SET ${updates.join(", ")}
      WHERE place_id = $${paramIndex}
      RETURNING place_id, display_name, place_kind, is_address_backed, formatted_address
    `;

    const result = await queryOne<{
      place_id: string;
      display_name: string;
      place_kind: string;
      is_address_backed: boolean;
      formatted_address: string | null;
    }>(sql, values);

    if (!result) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      place: result,
    });
  } catch (error) {
    console.error("Error updating place:", error);
    return NextResponse.json(
      { error: "Failed to update place" },
      { status: 500 }
    );
  }
}
