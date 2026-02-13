import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";

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
  // Computed fields
  person_display_name: string | null;
  matching_person_count: number;
  matches_24h: number;
  matches_7d: number;
  matches_total: number;
}

interface OrgStats {
  total_orgs: number;
  active_orgs: number;
  linked_orgs: number;
  matches_24h: number;
  pending_review: number;
}

// GET - List all known organizations with stats
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeInactive = searchParams.get("include_inactive") === "true";
    const orgType = searchParams.get("org_type");

    let whereClause = includeInactive ? "TRUE" : "ko.is_active = TRUE";
    const params: (boolean | string)[] = [];
    let paramIndex = 1;

    if (orgType) {
      whereClause += ` AND ko.org_type = $${paramIndex}`;
      params.push(orgType);
      paramIndex++;
    }

    const orgs = await queryRows<KnownOrganization>(
      `
      SELECT
        ko.org_id,
        ko.canonical_name,
        ko.short_name,
        ko.aliases,
        ko.org_type,
        ko.street_address,
        ko.city,
        ko.state,
        ko.zip,
        ko.phone,
        ko.email,
        ko.website,
        ko.lat,
        ko.lng,
        ko.service_area,
        ko.name_patterns,
        ko.email_domains,
        ko.phone_patterns,
        ko.match_priority,
        ko.auto_link,
        ko.canonical_person_id,
        ko.canonical_place_id,
        ko.notes,
        ko.is_active,
        ko.created_at,
        ko.updated_at,
        p.display_name AS person_display_name,
        -- Match counts from stats view
        COALESCE(ms.matches_24h, 0) AS matches_24h,
        COALESCE(ms.matches_7d, 0) AS matches_7d,
        COALESCE(ms.matches_total, 0) AS matches_total,
        -- Count potential duplicate person records
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
      LEFT JOIN ops.v_organization_match_stats ms ON ms.org_id = ko.org_id
      WHERE ${whereClause}
      ORDER BY ko.match_priority, ko.canonical_name
      `,
      params
    );

    // Get overall stats
    const stats = await queryOne<OrgStats>(
      `
      SELECT
        COUNT(*)::int AS total_orgs,
        COUNT(*) FILTER (WHERE is_active)::int AS active_orgs,
        COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL)::int AS linked_orgs,
        (
          SELECT COUNT(*)::int
          FROM trapper.organization_match_log
          WHERE created_at > NOW() - INTERVAL '24 hours'
        ) AS matches_24h,
        (
          SELECT COUNT(*)::int
          FROM trapper.organization_match_log
          WHERE decision = 'review'
        ) AS pending_review
      FROM sot.known_organizations
      `
    );

    // Get distinct org types for filtering
    const orgTypes = await queryRows<{ org_type: string; count: number }>(
      `
      SELECT org_type, COUNT(*)::int AS count
      FROM sot.known_organizations
      WHERE is_active = TRUE
      GROUP BY org_type
      ORDER BY count DESC
      `
    );

    return NextResponse.json({
      organizations: orgs,
      stats: stats || {
        total_orgs: 0,
        active_orgs: 0,
        linked_orgs: 0,
        matches_24h: 0,
        pending_review: 0,
      },
      org_types: orgTypes,
    });
  } catch (error) {
    console.error("Error fetching known organizations:", error);
    return NextResponse.json(
      { error: "Failed to fetch known organizations" },
      { status: 500 }
    );
  }
}

// POST - Create a new known organization
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      canonical_name,
      short_name,
      aliases,
      org_type,
      street_address,
      city,
      state,
      zip,
      phone,
      email,
      website,
      lat,
      lng,
      service_area,
      name_patterns,
      email_domains,
      match_priority,
      auto_link,
      notes,
    } = body;

    // Validate required fields
    if (!canonical_name) {
      return NextResponse.json(
        { error: "canonical_name is required" },
        { status: 400 }
      );
    }

    // Valid org types
    const validOrgTypes = ["shelter", "rescue", "clinic", "municipal", "partner", "other"];
    if (org_type && !validOrgTypes.includes(org_type)) {
      return NextResponse.json(
        { error: `Invalid org_type. Must be one of: ${validOrgTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Auto-generate name patterns if not provided
    const finalNamePatterns = name_patterns && name_patterns.length > 0
      ? name_patterns
      : [
          `%${canonical_name}%`,
          ...(short_name ? [`%${short_name}%`] : []),
          ...(aliases || []).map((a: string) => `%${a}%`),
        ];

    // Extract email domain if email provided but email_domains not
    const finalEmailDomains = email_domains && email_domains.length > 0
      ? email_domains
      : email && email.includes("@")
        ? [email.split("@")[1].toLowerCase()]
        : [];

    const result = await queryOne<KnownOrganization>(
      `
      INSERT INTO sot.known_organizations (
        canonical_name,
        short_name,
        aliases,
        org_type,
        street_address,
        city,
        state,
        zip,
        phone,
        email,
        website,
        lat,
        lng,
        service_area,
        name_patterns,
        email_domains,
        match_priority,
        auto_link,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
      `,
      [
        canonical_name,
        short_name || null,
        aliases || [],
        org_type || "other",
        street_address || null,
        city || null,
        state || "CA",
        zip || null,
        phone || null,
        email || null,
        website || null,
        lat || null,
        lng || null,
        service_area || null,
        finalNamePatterns,
        finalEmailDomains,
        match_priority ?? 100,
        auto_link ?? true,
        notes || null,
      ]
    );

    // If address provided, create/link a place
    if (result && street_address && city) {
      const fullAddress = `${street_address}, ${city}, ${state || "CA"} ${zip || ""}`.trim();
      const placeResult = await queryOne<{ place_id: string }>(
        `SELECT sot.find_or_create_place_deduped($1, $2, $3, $4, 'atlas_enrichment') AS place_id`,
        [fullAddress, canonical_name, lat || null, lng || null]
      );

      if (placeResult?.place_id) {
        await execute(
          `UPDATE sot.known_organizations SET canonical_place_id = $1 WHERE org_id = $2`,
          [placeResult.place_id, result.org_id]
        );
      }
    }

    return NextResponse.json({
      success: true,
      organization: result,
    });
  } catch (error: unknown) {
    console.error("Error creating known organization:", error);

    // Check for unique constraint violation
    if (error instanceof Error && error.message?.includes("unique")) {
      return NextResponse.json(
        { error: "An organization with this name already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create known organization" },
      { status: 500 }
    );
  }
}
