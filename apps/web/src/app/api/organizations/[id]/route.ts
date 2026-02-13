import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface Organization {
  org_id: string;
  parent_org_id: string | null;
  org_code: string;
  display_name: string;
  org_type: "parent" | "department" | "program";
  description: string | null;
  is_internal: boolean;
  created_at: string;
  parent_name: string | null;
}

interface Member {
  link_id: string;
  person_id: string;
  display_name: string;
  link_type: string;
  link_reason: string | null;
  email: string | null;
  phone: string | null;
  staff_role: string | null;
  staff_department: string | null;
  created_at: string;
}

interface OrgCat {
  relationship_id: string;
  cat_id: string;
  cat_name: string | null;
  relationship_type: string;
  original_account_name: string | null;
  sex: string | null;
  microchip: string | null;
  created_at: string;
}

interface ChildOrg {
  org_id: string;
  org_code: string;
  display_name: string;
  org_type: string;
  member_count: number;
  cat_count: number;
}

// GET - Get organization by ID with members and cats
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get organization details
    const org = await queryOne<Organization>(`
      SELECT
        o.org_id,
        o.parent_org_id,
        o.org_code,
        o.display_name,
        o.org_type,
        o.description,
        o.is_internal,
        o.created_at,
        parent.display_name AS parent_name
      FROM sot.organizations o
      LEFT JOIN sot.organizations parent ON parent.org_id = o.parent_org_id
      WHERE o.org_id::text = $1 OR o.org_code = $1
    `, [id]);

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Get members (people linked to this org)
    const members = await queryRows<Member>(`
      SELECT
        pol.link_id,
        pol.person_id,
        p.display_name,
        pol.link_type,
        pol.link_reason,
        p.primary_email AS email,
        p.primary_phone AS phone,
        s.role AS staff_role,
        s.department AS staff_department,
        pol.created_at
      FROM trapper.person_organization_link pol
      JOIN sot.people p ON p.person_id = pol.person_id
      LEFT JOIN ops.staff s ON s.person_id = pol.person_id AND s.is_active = true
      WHERE pol.org_id = $1
      ORDER BY p.display_name
    `, [org.org_id]);

    // Get cats linked to this org
    const cats = await queryRows<OrgCat>(`
      SELECT
        cor.relationship_id,
        cor.cat_id,
        c.display_name AS cat_name,
        cor.relationship_type,
        cor.original_account_name,
        c.sex,
        ci.id_value AS microchip,
        cor.created_at
      FROM trapper.cat_organization_relationships cor
      JOIN sot.cats c ON c.cat_id = cor.cat_id
      LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
      WHERE cor.org_id = $1
      ORDER BY c.display_name
      LIMIT 100
    `, [org.org_id]);

    // Get child organizations (for parent org)
    const children = await queryRows<ChildOrg>(`
      SELECT
        o.org_id,
        o.org_code,
        o.display_name,
        o.org_type,
        COALESCE(members.count, 0)::int AS member_count,
        COALESCE(cats.count, 0)::int AS cat_count
      FROM sot.organizations o
      LEFT JOIN (
        SELECT org_id, COUNT(*) as count
        FROM trapper.person_organization_link
        GROUP BY org_id
      ) members ON members.org_id = o.org_id
      LEFT JOIN (
        SELECT org_id, COUNT(*) as count
        FROM trapper.cat_organization_relationships
        GROUP BY org_id
      ) cats ON cats.org_id = o.org_id
      WHERE o.parent_org_id = $1
      ORDER BY o.display_name
    `, [org.org_id]);

    // Get total cat count for org (cats may exceed limit)
    const catCount = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int AS count
      FROM trapper.cat_organization_relationships
      WHERE org_id = $1
    `, [org.org_id]);

    return NextResponse.json({
      organization: org,
      members,
      cats,
      cat_count: catCount?.count || cats.length,
      children,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      }
    });
  } catch (err) {
    console.error("Error fetching organization:", err);
    return NextResponse.json(
      { error: "Failed to fetch organization" },
      { status: 500 }
    );
  }
}
