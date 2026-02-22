import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { logFieldEdits, logFieldEdit, detectChanges, type FieldChange } from "@/lib/audit";
import { validatePersonName } from "@/lib/validation";
import { requireValidUUID } from "@/lib/api-validation";
import { PERSON_ENTITY_TYPE, TRAPPING_SKILL } from "@/lib/enums";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError, apiError } from "@/lib/api-response";

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
  data_quality: string | null;
  primary_place_id: string | null;
  partner_orgs: PartnerOrg[] | null;
  associated_places: object[] | null;
  aliases: Array<{
    alias_id: string;
    name_raw: string;
    source_system: string | null;
    source_table: string | null;
    created_at: string;
  }> | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "person");
    // V2: Use v_person_detail view with correct column names
    const sql = `
      SELECT
        pd.person_id,
        pd.display_name,
        p.merged_into_person_id,
        pd.created_at,
        pd.updated_at,
        pd.cats,
        pd.places,
        '[]'::jsonb AS person_relationships,
        pd.cat_count,
        pd.place_count,
        sot.is_valid_person_name(pd.display_name) AS is_valid_name,
        pd.primary_address_id,
        pd.primary_place_address AS primary_address,
        a.city AS primary_address_locality,
        COALESCE(pd.data_source, pd.source_system) AS data_source,
        pd.entity_type,
        pd.data_quality,
        pd.primary_place_id,
        p.verified_at,
        p.verified_by,
        s.display_name AS verified_by_name,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id_type', pi.id_type,
            'id_value', pi.id_value_norm,
            'source_system', pi.source_system,
            'source_table', pi.source_table,
            'confidence', pi.confidence
          ) ORDER BY pi.id_type, pi.confidence DESC)
          FROM sot.person_identifiers pi
          WHERE pi.person_id = p.person_id
        ) AS identifiers,
        -- V2: partner_organizations doesn't have contact_person_id yet
        NULL::jsonb AS partner_orgs,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'alias_id', pa.alias_id,
            'name_raw', pa.name_raw,
            'source_system', pa.source_system,
            'source_table', pa.source_table,
            'created_at', pa.created_at
          ) ORDER BY pa.created_at DESC)
          FROM sot.person_aliases pa
          WHERE pa.person_id = p.person_id
        ) AS aliases,
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
              -- V2: Uses sot.person_place instead of sot.person_place_relationships
              SELECT
                pp.place_id,
                COALESCE(pl.display_name, split_part(pl.formatted_address, ',', 1)) AS display_name,
                pl.formatted_address,
                pl.place_kind,
                sa.city AS locality,
                'relationship' AS source_type,
                pp.confidence
              FROM sot.person_place pp
              JOIN sot.places pl ON pl.place_id = pp.place_id
              LEFT JOIN sot.addresses sa ON sa.address_id = pl.sot_address_id
              WHERE pp.person_id = p.person_id
                AND pl.merged_into_place_id IS NULL

              UNION ALL

              -- From requests where this person is requester
              -- V2: Uses city column (not locality)
              SELECT
                r.place_id,
                COALESCE(pl2.display_name, split_part(pl2.formatted_address, ',', 1)) AS display_name,
                pl2.formatted_address,
                pl2.place_kind,
                sa2.city AS locality,
                'request' AS source_type,
                0.5 AS confidence
              FROM ops.requests r
              JOIN sot.places pl2 ON pl2.place_id = r.place_id
              LEFT JOIN sot.addresses sa2 ON sa2.address_id = pl2.sot_address_id
              WHERE r.requester_person_id = p.person_id
                AND r.place_id IS NOT NULL
                AND pl2.merged_into_place_id IS NULL

              UNION ALL

              -- From intake submissions matched to this person
              -- V2: Uses city column (not locality)
              SELECT
                COALESCE(ws.selected_address_place_id, ws.place_id) AS place_id,
                COALESCE(pl3.display_name, split_part(pl3.formatted_address, ',', 1)) AS display_name,
                pl3.formatted_address,
                pl3.place_kind,
                sa3.city AS locality,
                'intake' AS source_type,
                0.4 AS confidence
              FROM ops.intake_submissions ws
              JOIN sot.places pl3 ON pl3.place_id = COALESCE(ws.selected_address_place_id, ws.place_id)
              LEFT JOIN sot.addresses sa3 ON sa3.address_id = pl3.sot_address_id
              WHERE ws.matched_person_id = p.person_id
                AND COALESCE(ws.selected_address_place_id, ws.place_id) IS NOT NULL
                AND pl3.merged_into_place_id IS NULL
            ) sub
            ORDER BY sub.place_id, sub.confidence DESC
          ) ap
        ) AS associated_places
      FROM sot.v_person_detail pd
      JOIN sot.people p ON p.person_id = pd.person_id
      LEFT JOIN sot.addresses a ON a.address_id = p.primary_address_id
      LEFT JOIN ops.staff s ON p.verified_by = s.staff_id::text
      WHERE pd.person_id = $1
    `;

    const person = await queryOne<PersonDetailRow>(sql, [id]);

    if (!person) {
      return apiNotFound("Person", id);
    }

    return apiSuccess(person);
  } catch (error) {
    // Handle validation errors from requireValidUUID
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    console.error("Error fetching person detail:", error);
    return apiServerError("Failed to fetch person detail");
  }
}

// INV-48: Entity types and trapping skills imported from @/lib/enums

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

  try {
    requireValidUUID(id, "person");

    const body: UpdatePersonBody = await request.json();
    const changed_by = body.changed_by || "web_user";
    const change_reason = body.change_reason || "manual_update";

    // Validate entity_type if provided (INV-48: uses central enum registry)
    if (body.entity_type !== undefined) {
      if (body.entity_type !== null && !PERSON_ENTITY_TYPE.includes(body.entity_type as typeof PERSON_ENTITY_TYPE[number])) {
        return apiBadRequest(`Invalid entity_type. Must be one of: ${PERSON_ENTITY_TYPE.join(", ")}`);
      }
    }

    // Validate trapping_skill if provided (INV-48: uses central enum registry)
    if (body.trapping_skill !== undefined) {
      if (body.trapping_skill !== null && !TRAPPING_SKILL.includes(body.trapping_skill as typeof TRAPPING_SKILL[number])) {
        return apiBadRequest(`Invalid trapping_skill. Must be one of: ${TRAPPING_SKILL.join(", ")}`);
      }
    }

    // Validate display_name if provided
    if (body.display_name !== undefined) {
      const validation = validatePersonName(body.display_name);
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error || "Invalid name" },
          { status: 400 }
        );
      }
    }

    // Get current values for audit comparison
    const currentSql = `
      SELECT display_name, entity_type, trapping_skill, trapping_skill_notes
      FROM sot.people
      WHERE person_id = $1
    `;
    const current = await queryOne<CurrentPersonData>(currentSql, [id]);

    if (!current) {
      return apiNotFound("Person", id);
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
        // Preserve old name as alias (if it's a real name, not garbage)
        if (current.display_name) {
          try {
            const isGarbage = await queryOne<{ is_garbage: boolean }>(
              `SELECT sot.is_garbage_name($1) AS is_garbage`,
              [current.display_name]
            );
            if (!isGarbage?.is_garbage) {
              const nameKey = await queryOne<{ key: string }>(
                `SELECT sot.norm_name_key($1) AS key`,
                [current.display_name]
              );
              if (nameKey?.key) {
                const existing = await queryOne<{ alias_id: string }>(
                  `SELECT alias_id FROM sot.person_aliases
                   WHERE person_id = $1 AND name_key = $2 LIMIT 1`,
                  [id, nameKey.key]
                );
                if (!existing) {
                  await query(
                    `INSERT INTO sot.person_aliases
                     (person_id, name_raw, name_key, source_system, source_table)
                     VALUES ($1, $2, $3, 'atlas_ui', 'name_change')`,
                    [id, current.display_name, nameKey.key]
                  );
                }
              }
            }
          } catch (aliasErr) {
            console.error("Failed to create name alias:", aliasErr);
            // Don't block the name update if alias creation fails
          }
        }

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
      UPDATE sot.people
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
      return apiNotFound("Person", id);
    }

    return apiSuccess({ person: result });
  } catch (error) {
    // Handle validation errors from requireValidUUID
    if (error instanceof Error && error.name === "ApiError") {
      return apiError(error.message, (error as { status?: number }).status || 400);
    }
    console.error("Error updating person:", error);
    return apiServerError("Failed to update person");
  }
}
