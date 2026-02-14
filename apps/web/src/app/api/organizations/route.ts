import { NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface Organization {
  org_id: string;
  parent_org_id: string | null;
  org_code: string;
  display_name: string;
  org_type: "parent" | "department" | "program";
  description: string | null;
  is_internal: boolean;
  created_at: string;
  member_count: number;
  cat_count: number;
}

// GET - List all organizations with member/cat counts
// Parent orgs include totals from all child departments
export async function GET() {
  try {
    const organizations = await queryRows<Organization>(`
      WITH org_direct_counts AS (
        -- Direct counts per org
        SELECT
          o.org_id,
          COALESCE(members.count, 0)::int AS direct_member_count,
          COALESCE(cats.count, 0)::int AS direct_cat_count
        FROM sot.organizations o
        LEFT JOIN (
          SELECT org_id, COUNT(*) as count
          FROM ops.partner_organizations
          GROUP BY org_id
        ) members ON members.org_id = o.org_id
        LEFT JOIN (
          SELECT org_id, COUNT(*) as count
          FROM ops.partner_organizations
          GROUP BY org_id
        ) cats ON cats.org_id = o.org_id
      ),
      child_totals AS (
        -- For parent orgs, sum up child department counts
        SELECT
          parent.org_id as parent_org_id,
          SUM(odc.direct_member_count)::int AS child_member_total,
          SUM(odc.direct_cat_count)::int AS child_cat_total
        FROM sot.organizations parent
        JOIN sot.organizations child ON child.parent_org_id = parent.org_id
        JOIN org_direct_counts odc ON odc.org_id = child.org_id
        WHERE parent.org_type = 'parent'
        GROUP BY parent.org_id
      )
      SELECT
        o.org_id,
        o.parent_org_id,
        o.org_code,
        o.display_name,
        o.org_type,
        o.description,
        o.is_internal,
        o.created_at,
        -- For parent orgs: include direct + all child counts
        -- For others: just direct counts
        CASE WHEN o.org_type = 'parent'
          THEN odc.direct_member_count + COALESCE(ct.child_member_total, 0)
          ELSE odc.direct_member_count
        END AS member_count,
        CASE WHEN o.org_type = 'parent'
          THEN odc.direct_cat_count + COALESCE(ct.child_cat_total, 0)
          ELSE odc.direct_cat_count
        END AS cat_count
      FROM sot.organizations o
      JOIN org_direct_counts odc ON odc.org_id = o.org_id
      LEFT JOIN child_totals ct ON ct.parent_org_id = o.org_id
      ORDER BY
        CASE o.org_type
          WHEN 'parent' THEN 1
          WHEN 'department' THEN 2
          WHEN 'program' THEN 3
        END,
        o.display_name
    `);

    return NextResponse.json({
      organizations,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      }
    });
  } catch (err) {
    console.error("Error fetching organizations:", err);
    return NextResponse.json(
      { error: "Failed to fetch organizations" },
      { status: 500 }
    );
  }
}
