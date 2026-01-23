import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface PartnerOrgCatRow {
  cat_id: string;
  display_name: string;
  microchip: string | null;
  sex: string | null;
  altered_status: string | null;
  appointment_date: string;
  service_type: string | null;
  origin_address: string | null;
  origin_place_id: string | null;
  partner_org_id: string;
  partner_org_name: string;
  partner_org_short: string | null;
}

interface OrgSummary {
  org_id: string;
  org_name: string;
  org_name_short: string | null;
  cat_count: number;
  appointment_count: number;
  first_date: string | null;
  last_date: string | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const orgId = searchParams.get("org_id");
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const alteredStatus = searchParams.get("altered_status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const format = searchParams.get("format"); // 'csv' for export

  try {
    // Get summary of all orgs with cat counts
    const orgSummaryResult = await queryRows<OrgSummary>(`
      SELECT
        po.org_id,
        po.org_name,
        po.org_name_short,
        COUNT(DISTINCT a.cat_id) as cat_count,
        COUNT(*) as appointment_count,
        MIN(a.appointment_date)::TEXT as first_date,
        MAX(a.appointment_date)::TEXT as last_date
      FROM trapper.partner_organizations po
      JOIN trapper.sot_appointments a ON a.partner_org_id = po.org_id
      WHERE po.is_active = true
      GROUP BY po.org_id, po.org_name, po.org_name_short
      ORDER BY cat_count DESC
    `);

    // Build query for cats from partner orgs
    const conditions: string[] = ["a.partner_org_id IS NOT NULL"];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (orgId) {
      conditions.push(`a.partner_org_id = $${paramIndex}`);
      params.push(orgId);
      paramIndex++;
    }

    if (startDate) {
      conditions.push(`a.appointment_date >= $${paramIndex}`);
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      conditions.push(`a.appointment_date <= $${paramIndex}`);
      params.push(endDate);
      paramIndex++;
    }

    if (alteredStatus) {
      conditions.push(`c.altered_status ILIKE $${paramIndex}`);
      params.push(alteredStatus);
      paramIndex++;
    }

    const whereClause = conditions.join(" AND ");

    // Get cat data
    const catsResult = await queryRows<PartnerOrgCatRow>(`
      SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        c.cat_id,
        c.display_name,
        (SELECT id_value FROM trapper.cat_identifiers WHERE cat_id = c.cat_id AND id_type = 'microchip' LIMIT 1) as microchip,
        c.sex,
        c.altered_status,
        a.appointment_date::TEXT as appointment_date,
        a.service_type,
        p.formatted_address as origin_address,
        a.inferred_place_id as origin_place_id,
        po.org_id as partner_org_id,
        po.org_name as partner_org_name,
        po.org_name_short as partner_org_short
      FROM trapper.sot_appointments a
      JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
      JOIN trapper.partner_organizations po ON po.org_id = a.partner_org_id
      LEFT JOIN trapper.places p ON p.place_id = a.inferred_place_id
      WHERE ${whereClause}
      ORDER BY a.cat_id, a.appointment_date DESC, a.appointment_id
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    // Get total count
    const countResult = await query(`
      SELECT COUNT(DISTINCT (a.cat_id, a.appointment_date)) as total
      FROM trapper.sot_appointments a
      JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
      JOIN trapper.partner_organizations po ON po.org_id = a.partner_org_id
      LEFT JOIN trapper.places p ON p.place_id = a.inferred_place_id
      WHERE ${whereClause}
    `, params);

    const total = parseInt(countResult.rows[0]?.total || "0", 10);

    // CSV export
    if (format === "csv") {
      const csvRows = [
        ["Cat Name", "Microchip", "Sex", "Altered Status", "Appointment Date", "Service", "Origin Address", "Partner Org"].join(","),
        ...catsResult.map(row => [
          `"${(row.display_name || "").replace(/"/g, '""')}"`,
          `"${(row.microchip || "").replace(/"/g, '""')}"`,
          `"${(row.sex || "").replace(/"/g, '""')}"`,
          `"${(row.altered_status || "").replace(/"/g, '""')}"`,
          `"${row.appointment_date}"`,
          `"${(row.service_type || "").replace(/"/g, '""')}"`,
          `"${(row.origin_address || "").replace(/"/g, '""')}"`,
          `"${(row.partner_org_short || row.partner_org_name || "").replace(/"/g, '""')}"`
        ].join(","))
      ];

      return new NextResponse(csvRows.join("\n"), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="partner-org-cats-${new Date().toISOString().split("T")[0]}.csv"`
        }
      });
    }

    return NextResponse.json({
      organizations: orgSummaryResult,
      cats: catsResult,
      total,
      limit,
      offset
    });
  } catch (error) {
    console.error("Error fetching partner org cats:", error);
    return NextResponse.json(
      { error: "Failed to fetch partner org cats" },
      { status: 500 }
    );
  }
}
