import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";
import { NextRequest } from "next/server";

/**
 * SAC (Shelter Animals Count) Reporting API
 *
 * Returns SAC-formatted data from ops.v_sac_report for grant reporting.
 * Supports year/quarter filtering and CSV export.
 */

interface SacReportRow {
  report_year: number;
  report_quarter: number;
  report_month: number;
  sac_intake_type: string;
  sac_intake_label: string;
  sac_outcome_type: string;
  sac_outcome_label: string;
  cat_count: number | null;
  county: string | null;
  is_emergency: boolean;
  has_kittens: boolean;
  call_type: string;
  ownership_status: string;
  resolution_outcome: string | null;
  request_status: string | null;
  submitted_at: string;
}

interface SacSummary {
  total_intakes: number;
  total_cats: number;
  by_intake_type: Array<{ type: string; label: string; count: number; cats: number }>;
  by_outcome_type: Array<{ type: string; label: string; count: number }>;
  by_quarter: Array<{ year: number; quarter: number; intakes: number; cats: number }>;
  by_county: Array<{ county: string; count: number }>;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const quarter = searchParams.get("quarter");
    const format = searchParams.get("format"); // "csv" for export

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (year) {
      conditions.push(`report_year = $${paramIdx}`);
      params.push(parseInt(year));
      paramIdx++;
    }
    if (quarter) {
      conditions.push(`report_quarter = $${paramIdx}`);
      params.push(parseInt(quarter));
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // CSV export
    if (format === "csv") {
      const rows = await queryRows<SacReportRow>(
        `SELECT
          report_year, report_quarter, report_month,
          sac_intake_type, sac_intake_label,
          sac_outcome_type, sac_outcome_label,
          cat_count, county, is_emergency, has_kittens,
          call_type, ownership_status, resolution_outcome,
          request_status, submitted_at
        FROM ops.v_sac_report
        ${whereClause}
        ORDER BY submitted_at DESC`,
        params
      );

      const headers = [
        "Year", "Quarter", "Month",
        "SAC Intake Type", "SAC Intake Label",
        "SAC Outcome Type", "SAC Outcome Label",
        "Cat Count", "County", "Emergency", "Has Kittens",
        "FFSC Call Type", "Ownership Status", "Resolution Outcome",
        "Request Status", "Submitted At",
      ];

      const csvRows = rows.map((r) => [
        r.report_year, r.report_quarter, r.report_month,
        r.sac_intake_type, r.sac_intake_label,
        r.sac_outcome_type, r.sac_outcome_label,
        r.cat_count ?? "", r.county ?? "", r.is_emergency, r.has_kittens,
        r.call_type, r.ownership_status, r.resolution_outcome ?? "",
        r.request_status ?? "", r.submitted_at,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));

      const csv = [headers.join(","), ...csvRows].join("\n");

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="sac-report-${year || "all"}-Q${quarter || "all"}.csv"`,
        },
      });
    }

    // JSON summary
    const [summary, byIntake, byOutcome, byQuarter, byCounty] = await Promise.all([
      queryOne<{ total_intakes: number; total_cats: number }>(
        `SELECT
          COUNT(*)::int as total_intakes,
          COALESCE(SUM(cat_count), 0)::int as total_cats
        FROM ops.v_sac_report ${whereClause}`,
        params
      ),
      queryRows<{ type: string; label: string; count: number; cats: number }>(
        `SELECT
          sac_intake_type as type,
          sac_intake_label as label,
          COUNT(*)::int as count,
          COALESCE(SUM(cat_count), 0)::int as cats
        FROM ops.v_sac_report ${whereClause}
        GROUP BY sac_intake_type, sac_intake_label
        ORDER BY count DESC`,
        params
      ),
      queryRows<{ type: string; label: string; count: number }>(
        `SELECT
          sac_outcome_type as type,
          sac_outcome_label as label,
          COUNT(*)::int as count
        FROM ops.v_sac_report ${whereClause}
        GROUP BY sac_outcome_type, sac_outcome_label
        ORDER BY count DESC`,
        params
      ),
      queryRows<{ year: number; quarter: number; intakes: number; cats: number }>(
        `SELECT
          report_year as year,
          report_quarter as quarter,
          COUNT(*)::int as intakes,
          COALESCE(SUM(cat_count), 0)::int as cats
        FROM ops.v_sac_report ${whereClause}
        GROUP BY report_year, report_quarter
        ORDER BY report_year DESC, report_quarter DESC`,
        params
      ),
      queryRows<{ county: string; count: number }>(
        `SELECT
          COALESCE(county, 'Unknown') as county,
          COUNT(*)::int as count
        FROM ops.v_sac_report ${whereClause}
        GROUP BY county
        ORDER BY count DESC`,
        params
      ),
    ]);

    // Available years for filter dropdown
    const years = await queryRows<{ year: number }>(
      `SELECT DISTINCT report_year as year FROM ops.v_sac_report ORDER BY report_year DESC`
    );

    const result: SacSummary & { available_years: number[] } = {
      total_intakes: summary?.total_intakes || 0,
      total_cats: summary?.total_cats || 0,
      by_intake_type: byIntake,
      by_outcome_type: byOutcome,
      by_quarter: byQuarter,
      by_county: byCounty,
      available_years: years.map((y) => y.year),
    };

    return apiSuccess(result);
  } catch (error) {
    console.error("SAC report error:", error);
    return apiServerError(error instanceof Error ? error.message : "Failed to generate SAC report");
  }
}
