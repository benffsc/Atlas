import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/known-organizations
 *
 * Search/list known external organizations (shelters, rescues, businesses)
 * for the organization dropdown in place classification.
 *
 * Query params:
 *   - search: text to search in name/aliases
 *   - type: filter by org_type (shelter, rescue, clinic, municipal, partner, other)
 *   - limit: max results (default 50)
 */

interface KnownOrganization {
  org_id: string;
  canonical_name: string;
  short_name: string | null;
  org_type: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  canonical_place_id: string | null;
  is_active: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const orgType = searchParams.get("type");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    let sql = `
      SELECT
        org_id,
        canonical_name,
        short_name,
        org_type,
        city,
        phone,
        email,
        canonical_place_id,
        is_active
      FROM sot.known_organizations
      WHERE is_active = TRUE
    `;

    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (search) {
      sql += ` AND (
        canonical_name ILIKE $${paramIndex}
        OR short_name ILIKE $${paramIndex}
        OR $${paramIndex + 1} = ANY(aliases)
      )`;
      params.push(`%${search}%`, search.toLowerCase());
      paramIndex += 2;
    }

    if (orgType) {
      sql += ` AND org_type = $${paramIndex}`;
      params.push(orgType);
      paramIndex++;
    }

    sql += ` ORDER BY canonical_name LIMIT $${paramIndex}`;
    params.push(limit);

    const organizations = await queryRows<KnownOrganization>(sql, params);

    return NextResponse.json({
      organizations: organizations || [],
      count: (organizations || []).length,
    });
  } catch (error) {
    console.error("Error fetching known organizations:", error);
    return NextResponse.json(
      { error: "Failed to fetch organizations" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/known-organizations
 *
 * Creates a new organization in the known_organizations registry.
 * Body: {
 *   canonical_name: string,     // Required: official name
 *   short_name?: string,        // Common abbreviation
 *   org_type?: string,          // Default: 'other'
 *   street_address?: string,
 *   city?: string,
 *   phone?: string,
 *   email?: string,
 *   notes?: string
 * }
 */

interface CreateOrgBody {
  canonical_name: string;
  short_name?: string;
  org_type?: string;
  street_address?: string;
  city?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateOrgBody = await request.json();

    if (!body.canonical_name?.trim()) {
      return NextResponse.json(
        { error: "canonical_name is required" },
        { status: 400 }
      );
    }

    // Check for existing org with same name
    const existing = await queryOne<{ org_id: string }>(
      `SELECT org_id FROM sot.known_organizations
       WHERE LOWER(canonical_name) = LOWER($1)`,
      [body.canonical_name.trim()]
    );

    if (existing) {
      return NextResponse.json(
        { error: "Organization with this name already exists", org_id: existing.org_id },
        { status: 409 }
      );
    }

    // Create the organization
    const result = await queryOne<KnownOrganization>(
      `INSERT INTO sot.known_organizations (
         canonical_name,
         short_name,
         org_type,
         street_address,
         city,
         phone,
         email,
         notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING
         org_id,
         canonical_name,
         short_name,
         org_type,
         city,
         phone,
         email,
         canonical_place_id,
         is_active`,
      [
        body.canonical_name.trim(),
        body.short_name?.trim() || null,
        body.org_type || "other",
        body.street_address?.trim() || null,
        body.city?.trim() || null,
        body.phone?.trim() || null,
        body.email?.trim() || null,
        body.notes?.trim() || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create organization" },
        { status: 500 }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error creating organization:", error);
    return NextResponse.json(
      { error: "Failed to create organization" },
      { status: 500 }
    );
  }
}
