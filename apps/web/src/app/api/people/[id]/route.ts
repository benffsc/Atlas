import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { logFieldEdits, detectChanges, type FieldChange } from "@/lib/audit";

interface PartnerOrg {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  org_type: string;
  role: string;
  appointments_count: number;
  cats_processed: number;
}

interface PersonDetailRow {
  person_id: string;
  display_name: string;
  merged_into_person_id: string | null;
  created_at: string;
  updated_at: string;
  cats: object[] | null;
  places: object[] | null;
  person_relationships: object[] | null;
  cat_count: number;
  place_count: number;
  is_valid_name: boolean;
  primary_address_id: string | null;
  primary_address: string | null;
  primary_address_locality: string | null;
  data_source: string | null;
  identifiers: object[] | null;
  entity_type: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  partner_orgs: PartnerOrg[] | null;
  associated_places: object[] | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    // Use original v_person_detail (all people) so direct links work,
    // but add is_valid_name flag so UI can show warning for suspect entries
    const sql = `
      SELECT
        pd.person_id,
        pd.display_name,
        pd.merged_into_person_id,
        pd.created_at,
        pd.updated_at,
        pd.cats,
        pd.places,
        pd.person_relationships,
        pd.cat_count,
        pd.place_count,
        trapper.is_valid_person_name(pd.display_name) AS is_valid_name,
        p.primary_address_id,
        a.formatted_address AS primary_address,
        a.locality AS primary_address_locality,
        p.data_source,
        p.entity_type,
        p.verified_at,
        p.verified_by,
        s.display_name AS verified_by_name,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id_type', pi.id_type,
            'id_value', pi.id_value_norm,
            'source_system', pi.source_system,
            'source_table', pi.source_table
          ) ORDER BY pi.id_type)
          FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id
        ) AS identifiers,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'org_id', po.org_id,
            'org_name', po.org_name,
            'org_name_short', po.org_name_short,
            'org_type', po.org_type,
            'role', 'representative',
            'appointments_count', po.appointments_count,
            'cats_processed', po.cats_processed
          ) ORDER BY po.org_name)
          FROM trapper.partner_organizations po
          WHERE po.contact_person_id = p.person_id
            AND po.is_active = TRUE
        ) AS partner_orgs,
        (
          SELECT jsonb_agg(ap ORDER BY ap.source_type, ap.display_name)
          FROM (
            SELECT DISTINCT ON (sub.place_id)
              sub.place_id,
              sub.display_name,
              sub.formatted_address,
              sub.place_kind,
              sub.locality,
              sub.source_type
            FROM (
              -- From person_place_relationships
              SELECT
                ppr.place_id,
                COALESCE(pl.display_name, split_part(pl.formatted_address, ',', 1)) AS display_name,
                pl.formatted_address,
                pl.place_kind,
                sa.locality,
                'relationship' AS source_type,
                ppr.confidence
              FROM trapper.person_place_relationships ppr
              JOIN trapper.places pl ON pl.place_id = ppr.place_id
              LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
              WHERE ppr.person_id = p.person_id

              UNION ALL

              -- From requests where this person is requester
              SELECT
                r.place_id,
                COALESCE(pl2.display_name, split_part(pl2.formatted_address, ',', 1)) AS display_name,
                pl2.formatted_address,
                pl2.place_kind,
                sa2.locality,
                'request' AS source_type,
                0.5 AS confidence
              FROM trapper.sot_requests r
              JOIN trapper.places pl2 ON pl2.place_id = r.place_id
              LEFT JOIN trapper.sot_addresses sa2 ON sa2.address_id = pl2.sot_address_id
              WHERE r.requester_person_id = p.person_id
                AND r.place_id IS NOT NULL

              UNION ALL

              -- From intake submissions matched to this person
              SELECT
                COALESCE(ws.selected_address_place_id, ws.place_id) AS place_id,
                COALESCE(pl3.display_name, split_part(pl3.formatted_address, ',', 1)) AS display_name,
                pl3.formatted_address,
                pl3.place_kind,
                sa3.locality,
                'intake' AS source_type,
                0.4 AS confidence
              FROM trapper.web_intake_submissions ws
              JOIN trapper.places pl3 ON pl3.place_id = COALESCE(ws.selected_address_place_id, ws.place_id)
              LEFT JOIN trapper.sot_addresses sa3 ON sa3.address_id = pl3.sot_address_id
              WHERE ws.matched_person_id = p.person_id
                AND COALESCE(ws.selected_address_place_id, ws.place_id) IS NOT NULL
            ) sub
            ORDER BY sub.place_id, sub.confidence DESC
          ) ap
        ) AS associated_places
      FROM trapper.v_person_detail pd
      JOIN trapper.sot_people p ON p.person_id = pd.person_id
      LEFT JOIN trapper.sot_addresses a ON a.address_id = p.primary_address_id
      LEFT JOIN trapper.staff s ON p.verified_by = s.staff_id::text
      WHERE pd.person_id = $1
    `;

    const person = await queryOne<PersonDetailRow>(sql, [id]);

    if (!person) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(person);
  } catch (error) {
    console.error("Error fetching person detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch person detail" },
      { status: 500 }
    );
  }
}

// Valid entity types for a person
const VALID_ENTITY_TYPES = [
  "individual",
  "household",
  "organization",
  "clinic",
  "rescue",
] as const;

// Valid trapping skill levels
const VALID_TRAPPING_SKILLS = [
  "novice",
  "intermediate",
  "experienced",
  "expert",
] as const;

interface UpdatePersonBody {
  display_name?: string;
  entity_type?: string;
  trapping_skill?: string;
  trapping_skill_notes?: string;
  // Audit info
  changed_by?: string;
  change_reason?: string;
}

interface CurrentPersonData {
  display_name: string | null;
  entity_type: string | null;
  trapping_skill: string | null;
  trapping_skill_notes: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Person ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: UpdatePersonBody = await request.json();
    const changed_by = body.changed_by || "web_user";
    const change_reason = body.change_reason || "manual_update";

    // Validate entity_type if provided
    if (body.entity_type !== undefined) {
      if (body.entity_type !== null && !VALID_ENTITY_TYPES.includes(body.entity_type as typeof VALID_ENTITY_TYPES[number])) {
        return NextResponse.json(
          { error: `Invalid entity_type. Must be one of: ${VALID_ENTITY_TYPES.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Validate trapping_skill if provided
    if (body.trapping_skill !== undefined) {
      if (body.trapping_skill !== null && !VALID_TRAPPING_SKILLS.includes(body.trapping_skill as typeof VALID_TRAPPING_SKILLS[number])) {
        return NextResponse.json(
          { error: `Invalid trapping_skill. Must be one of: ${VALID_TRAPPING_SKILLS.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Validate display_name if provided
    if (body.display_name !== undefined && body.display_name.trim() === "") {
      return NextResponse.json(
        { error: "display_name cannot be empty" },
        { status: 400 }
      );
    }

    // Get current values for audit comparison
    const currentSql = `
      SELECT display_name, entity_type, trapping_skill, trapping_skill_notes
      FROM trapper.sot_people
      WHERE person_id = $1
    `;
    const current = await queryOne<CurrentPersonData>(currentSql, [id]);

    if (!current) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Track changes for audit logging
    const auditChanges: FieldChange[] = [];

    if (body.display_name !== undefined) {
      const newVal = body.display_name.trim();
      if (newVal !== current.display_name) {
        auditChanges.push({
          field: "display_name",
          oldValue: current.display_name,
          newValue: newVal,
        });
        updates.push(`display_name = $${paramIndex}`);
        values.push(newVal);
        paramIndex++;
      }
    }

    if (body.entity_type !== undefined) {
      if (body.entity_type !== current.entity_type) {
        auditChanges.push({
          field: "entity_type",
          oldValue: current.entity_type,
          newValue: body.entity_type,
        });
        updates.push(`entity_type = $${paramIndex}`);
        values.push(body.entity_type);
        paramIndex++;
      }
    }

    if (body.trapping_skill !== undefined) {
      if (body.trapping_skill !== current.trapping_skill) {
        auditChanges.push({
          field: "trapping_skill",
          oldValue: current.trapping_skill,
          newValue: body.trapping_skill,
        });
        updates.push(`trapping_skill = $${paramIndex}`);
        values.push(body.trapping_skill);
        paramIndex++;
        // Also update the timestamp
        updates.push(`trapping_skill_updated_at = NOW()`);
      }
    }

    if (body.trapping_skill_notes !== undefined) {
      if (body.trapping_skill_notes !== current.trapping_skill_notes) {
        auditChanges.push({
          field: "trapping_skill_notes",
          oldValue: current.trapping_skill_notes,
          newValue: body.trapping_skill_notes,
        });
        updates.push(`trapping_skill_notes = $${paramIndex}`);
        values.push(body.trapping_skill_notes);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Log changes to centralized entity_edits table
    if (auditChanges.length > 0) {
      await logFieldEdits("person", id, auditChanges, {
        editedBy: changed_by,
        reason: change_reason,
        editSource: "web_ui",
      });
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add person_id to values
    values.push(id);

    const sql = `
      UPDATE trapper.sot_people
      SET ${updates.join(", ")}
      WHERE person_id = $${paramIndex}
      RETURNING person_id, display_name, entity_type, trapping_skill, trapping_skill_notes
    `;

    const result = await queryOne<{
      person_id: string;
      display_name: string;
      entity_type: string | null;
      trapping_skill: string | null;
      trapping_skill_notes: string | null;
    }>(sql, values);

    if (!result) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      person: result,
    });
  } catch (error) {
    console.error("Error updating person:", error);
    return NextResponse.json(
      { error: "Failed to update person" },
      { status: 500 }
    );
  }
}
