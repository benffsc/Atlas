import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/db";

interface KnownOrganization {
  org_id: string;
  canonical_name: string;
  short_name: string | null;
  aliases: string[];
  org_type: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  service_area: string | null;
  name_patterns: string[];
  email_domains: string[];
  phone_patterns: string[];
  match_priority: number;
  auto_link: boolean;
  canonical_person_id: string | null;
  canonical_place_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// GET - Get a single organization with full details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const org = await queryOne<KnownOrganization & {
      person_display_name: string | null;
      place_address: string | null;
      matching_person_count: number;
    }>(
      `
      SELECT
        ko.*,
        p.display_name AS person_display_name,
        pl.formatted_address AS place_address,
        (
          SELECT COUNT(*)::int
          FROM sot.people sp
          WHERE sp.merged_into_person_id IS NULL
            AND (
              LOWER(sp.display_name) ILIKE '%' || LOWER(ko.canonical_name) || '%'
              OR (ko.short_name IS NOT NULL AND LOWER(sp.display_name) ILIKE '%' || LOWER(ko.short_name) || '%')
            )
        ) AS matching_person_count
      FROM sot.known_organizations ko
      LEFT JOIN sot.people p ON p.person_id = ko.canonical_person_id
      LEFT JOIN sot.places pl ON pl.place_id = ko.canonical_place_id
      WHERE ko.org_id = $1
      `,
      [id]
    );

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ organization: org });
  } catch (error) {
    console.error("Error fetching organization:", error);
    return NextResponse.json(
      { error: "Failed to fetch organization" },
      { status: 500 }
    );
  }
}

// PATCH - Update an organization
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Build dynamic update query
    const allowedFields = [
      "canonical_name",
      "short_name",
      "aliases",
      "org_type",
      "street_address",
      "city",
      "state",
      "zip",
      "phone",
      "email",
      "website",
      "lat",
      "lng",
      "service_area",
      "name_patterns",
      "email_domains",
      "phone_patterns",
      "match_priority",
      "auto_link",
      "canonical_person_id",
      "canonical_place_id",
      "notes",
      "is_active",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(body[field]);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);

    values.push(id);
    const result = await queryOne<KnownOrganization>(
      `
      UPDATE sot.known_organizations
      SET ${updates.join(", ")}
      WHERE org_id = $${paramIndex}
      RETURNING *
      `,
      values
    );

    if (!result) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ organization: result });
  } catch (error) {
    console.error("Error updating organization:", error);
    return NextResponse.json(
      { error: "Failed to update organization" },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete an organization (set is_active = FALSE)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await queryOne<{ org_id: string }>(
      `
      UPDATE sot.known_organizations
      SET is_active = FALSE, updated_at = NOW()
      WHERE org_id = $1
      RETURNING org_id
      `,
      [id]
    );

    if (!result) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error("Error deleting organization:", error);
    return NextResponse.json(
      { error: "Failed to delete organization" },
      { status: 500 }
    );
  }
}
