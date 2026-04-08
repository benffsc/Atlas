import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiNotFound, apiConflict, apiServerError } from "@/lib/api-response";
import * as xlsx from "xlsx";
import { ingestMasterListWorkbook } from "@/lib/master-list-ingest";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * POST /api/admin/clinic-days/[date]/import
 * Import master list Excel or CSV file for a clinic day
 *
 * Accepts multipart form data with 'file' field containing Excel (.xlsx) or CSV (.csv) file.
 *
 * Refactored 2026-04-07 (FFS-1088): parser + DB insert + CDS run extracted to
 * lib/master-list-parser.ts + lib/master-list-ingest.ts so the cron route can
 * share the same logic.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { date } = await params;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return apiBadRequest("No file provided");
    }

    const fileName = file.name.toLowerCase();
    const isCSV = fileName.endsWith(".csv");
    const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

    if (!isCSV && !isExcel) {
      return apiBadRequest("Invalid file type. Please upload an Excel (.xlsx) or CSV (.csv) file.");
    }

    const buffer = await file.arrayBuffer();
    const workbook = xlsx.read(buffer, { type: "buffer" });

    // Manual upload route uses the URL date as authoritative and refuses to
    // overwrite existing entries (skipIfExists=false → throws on conflict).
    // Cron uses skipIfExists=true for idempotency.
    let result;
    try {
      result = await ingestMasterListWorkbook(workbook, {
        dateOverride: date,
        enteredBy: session.staff_id,
        sourceSystem: "master_list",
        skipIfExists: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exist")) {
        return apiConflict(msg);
      }
      throw err;
    }

    if (result.status === "no_entries") {
      return apiBadRequest("No entries found in the file");
    }
    if (result.status === "no_date") {
      return apiBadRequest("Could not extract date from file");
    }

    return apiSuccess({
      clinic_day_id: result.clinic_day_id,
      imported: result.imported,
      trappers_resolved: result.trappers_resolved,
      matched: result.matched_after,
      cds: {
        run_id: result.cds_run_id,
        phases: result.cds_phases,
        matched_after: result.matched_after,
        unmatched_remaining: result.unmatched_remaining,
      },
      // Backward compat: composite_matching shape (some legacy callers expect it)
      composite_matching: {
        already_matched: 0, // not tracked separately in the new lib path
        newly_matched: result.matched_after,
        unmatched: result.unmatched_remaining,
      },
      extracted_date: result.extracted_date_from_file,
    });
  } catch (error) {
    console.error("Master list import error:", error);
    return apiServerError("Failed to import master list");
  }
}

/**
 * DELETE /api/admin/clinic-days/[date]/import
 * Clear all master list entries for a clinic day
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return apiUnauthorized();
    }

    const { date } = await params;

    const clinicDay = await queryOne<{ clinic_day_id: string }>(
      `SELECT clinic_day_id FROM ops.clinic_days WHERE clinic_date = $1`,
      [date]
    );

    if (!clinicDay) {
      return apiNotFound("clinic day", date);
    }

    const result = await queryOne<{ count: number }>(
      `WITH deleted AS (
        DELETE FROM ops.clinic_day_entries
        WHERE clinic_day_id = $1
          AND source_system IN ('master_list', 'master_list_sharepoint_sync')
        RETURNING 1
      )
      SELECT COUNT(*)::int as count FROM deleted`,
      [clinicDay.clinic_day_id]
    );

    return apiSuccess({
      deleted: result?.count || 0,
    });
  } catch (error) {
    console.error("Master list delete error:", error);
    return apiServerError("Failed to delete entries");
  }
}
