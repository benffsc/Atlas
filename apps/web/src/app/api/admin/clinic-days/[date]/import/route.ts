import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, execute } from "@/lib/db";
import { getSession } from "@/lib/auth";
import * as xlsx from "xlsx";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * POST /api/admin/clinic-days/[date]/import
 * Import master list Excel or CSV file for a clinic day
 *
 * Accepts multipart form data with 'file' field containing Excel (.xlsx) or CSV (.csv) file
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Require auth
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    const isCSV = fileName.endsWith(".csv");
    const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

    if (!isCSV && !isExcel) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload an Excel (.xlsx) or CSV (.csv) file." },
        { status: 400 }
      );
    }

    // Read file as buffer and parse with xlsx library (handles both Excel and CSV)
    const buffer = await file.arrayBuffer();
    const workbook = xlsx.read(buffer, { type: "buffer" });

    // Parse the master list
    const { entries, extractedDate } = parseMasterList(workbook);

    if (entries.length === 0) {
      return NextResponse.json(
        { error: "No entries found in the file" },
        { status: 400 }
      );
    }

    // Get or create clinic day
    let clinicDay = await queryOne<{ clinic_day_id: string }>(
      `SELECT clinic_day_id FROM trapper.clinic_days WHERE clinic_date = $1`,
      [date]
    );

    if (!clinicDay) {
      clinicDay = await queryOne<{ clinic_day_id: string }>(
        `INSERT INTO trapper.clinic_days (clinic_date, clinic_type)
         VALUES ($1, trapper.get_default_clinic_type($1))
         RETURNING clinic_day_id`,
        [date]
      );
    }

    if (!clinicDay) {
      return NextResponse.json(
        { error: "Failed to get or create clinic day" },
        { status: 500 }
      );
    }

    // Check for existing entries
    const existingCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM trapper.clinic_day_entries WHERE clinic_day_id = $1`,
      [clinicDay.clinic_day_id]
    );

    if (existingCount && existingCount.count > 0) {
      return NextResponse.json(
        {
          error: `${existingCount.count} entries already exist for this date. Delete existing entries first or use a different date.`,
          existingCount: existingCount.count,
        },
        { status: 409 }
      );
    }

    // Import entries
    let inserted = 0;
    let trappersResolved = 0;

    for (const entry of entries) {
      // Resolve trapper alias
      const trapperResult = entry.parsed_trapper_alias
        ? await queryOne<{ person_id: string | null }>(
            `SELECT trapper.resolve_trapper_alias($1) as person_id`,
            [entry.parsed_trapper_alias]
          )
        : null;

      const trapperPersonId = trapperResult?.person_id || null;
      if (trapperPersonId) trappersResolved++;

      await execute(
        `INSERT INTO trapper.clinic_day_entries (
          clinic_day_id,
          line_number,
          source_description,
          raw_client_name,
          parsed_owner_name,
          parsed_cat_name,
          parsed_trapper_alias,
          trapper_person_id,
          cat_count,
          female_count,
          male_count,
          was_altered,
          is_walkin,
          is_already_altered,
          fee_code,
          notes,
          status,
          source_system,
          entered_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          clinicDay.clinic_day_id,
          entry.line_number,
          entry.raw_client_name,
          entry.raw_client_name,
          entry.parsed_owner_name,
          entry.parsed_cat_name,
          entry.parsed_trapper_alias,
          trapperPersonId,
          1, // Each row is 1 cat
          entry.is_female ? 1 : 0,
          entry.is_male ? 1 : 0,
          entry.was_altered,
          entry.is_walkin,
          entry.is_already_altered,
          entry.fee_code,
          entry.notes,
          "completed",
          "master_list",
          session.staff_id,
        ]
      );
      inserted++;
    }

    // Run matching
    const matchResult = await queryOne<{
      entries_matched: number;
      high_confidence: number;
      medium_confidence: number;
      low_confidence: number;
    }>(
      `SELECT * FROM trapper.apply_master_list_matches($1, 'medium')`,
      [date]
    );

    // Get summary counts
    const summary = {
      females_altered: entries.filter((e) => e.female_altered).length,
      males_altered: entries.filter((e) => e.male_altered).length,
      walkin: entries.filter((e) => e.is_walkin).length,
      already_altered: entries.filter((e) => e.is_already_altered).length,
      with_trapper: entries.filter((e) => e.parsed_trapper_alias).length,
      with_cat_name: entries.filter((e) => e.parsed_cat_name).length,
    };

    return NextResponse.json({
      success: true,
      clinic_day_id: clinicDay.clinic_day_id,
      imported: inserted,
      trappers_resolved: trappersResolved,
      trappers_total: summary.with_trapper,
      matched: matchResult?.entries_matched || 0,
      match_details: {
        high_confidence: matchResult?.high_confidence || 0,
        medium_confidence: matchResult?.medium_confidence || 0,
        low_confidence: matchResult?.low_confidence || 0,
      },
      summary,
      extracted_date: extractedDate,
    });
  } catch (error) {
    console.error("Master list import error:", error);
    return NextResponse.json(
      { error: "Failed to import master list" },
      { status: 500 }
    );
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date } = await params;

    const clinicDay = await queryOne<{ clinic_day_id: string }>(
      `SELECT clinic_day_id FROM trapper.clinic_days WHERE clinic_date = $1`,
      [date]
    );

    if (!clinicDay) {
      return NextResponse.json(
        { error: "Clinic day not found" },
        { status: 404 }
      );
    }

    // Delete entries from master_list source only
    const result = await queryOne<{ count: number }>(
      `WITH deleted AS (
        DELETE FROM trapper.clinic_day_entries
        WHERE clinic_day_id = $1
          AND source_system = 'master_list'
        RETURNING 1
      )
      SELECT COUNT(*)::int as count FROM deleted`,
      [clinicDay.clinic_day_id]
    );

    return NextResponse.json({
      success: true,
      deleted: result?.count || 0,
    });
  } catch (error) {
    console.error("Master list delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete entries" },
      { status: 500 }
    );
  }
}

// --- Parsing functions ---

interface ParsedEntry {
  line_number: number;
  raw_client_name: string;
  is_female: boolean;
  is_male: boolean;
  was_altered: boolean;
  female_altered: boolean;
  male_altered: boolean;
  is_walkin: boolean;
  is_already_altered: boolean;
  fee_code: string | null;
  notes: string | null;
  status: string | null;
  test_requested: string | null;
  test_result: string | null;
  parsed_owner_name: string | null;
  parsed_trapper_alias: string | null;
  parsed_cat_name: string | null;
}

function parseMasterList(workbook: xlsx.WorkBook): {
  entries: ParsedEntry[];
  extractedDate: string | null;
} {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays to handle the non-standard format
  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });

  const entries: ParsedEntry[] = [];
  let headerRowIndex = -1;

  // Find the header row (contains "Client Name")
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] as unknown[];
    if (
      row &&
      row.some((cell) => String(cell).includes("Client Name"))
    ) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return { entries: [], extractedDate: null };
  }

  // Extract date from first row if present
  let extractedDate: string | null = null;
  if (rows[0] && (rows[0] as unknown[]).length > 0) {
    for (const cell of rows[0] as unknown[]) {
      if (
        cell &&
        typeof cell === "string" &&
        cell.match(/\d{1,2}-\w{3}-\d{2}/)
      ) {
        const parts = cell.match(/(\d{1,2})-(\w{3})-(\d{2})/);
        if (parts) {
          const monthMap: Record<string, string> = {
            jan: "01",
            feb: "02",
            mar: "03",
            apr: "04",
            may: "05",
            jun: "06",
            jul: "07",
            aug: "08",
            sep: "09",
            oct: "10",
            nov: "11",
            dec: "12",
          };
          const [, day, mon, yr] = parts;
          const month = monthMap[mon.toLowerCase()];
          const year = parseInt(yr) > 50 ? `19${yr}` : `20${yr}`;
          extractedDate = `${year}-${month}-${day.padStart(2, "0")}`;
        }
      }
    }
  }

  // Parse header to get column indices
  const header = rows[headerRowIndex] as unknown[];
  const colIndex: Record<string, number> = {};
  header.forEach((cell, idx) => {
    const cellStr = String(cell).trim();
    if (cellStr === "F") colIndex.F = idx;
    else if (cellStr === "M") colIndex.M = idx;
    else if (cellStr === "A/W" || cellStr === "A") colIndex.AW = idx;
    else if (cellStr === "#") colIndex.num = idx;
    else if (cellStr.includes("Client Name")) colIndex.clientName = idx;
    else if (cellStr === "Test") colIndex.test = idx;
    else if (cellStr === "Result") colIndex.result = idx;
    else if (cellStr === "$") colIndex.fee = idx;
    else if (cellStr === "MISCELLANEOUS") colIndex.misc = idx;
    else if (cellStr === "Status") colIndex.status = idx;
  });

  if (colIndex.clientName === undefined) {
    return { entries: [], extractedDate };
  }

  // Process data rows
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const lineNum = row[colIndex.num];
    const clientName = String(row[colIndex.clientName] || "").trim();

    // Skip empty rows or summary rows
    if (!clientName || !lineNum) continue;
    if (isNaN(parseInt(String(lineNum)))) continue;

    const fValue = String(row[colIndex.F] || "").trim();
    const mValue = String(row[colIndex.M] || "").trim();
    const awValue = String(row[colIndex.AW] || "").trim();

    const entry: ParsedEntry = {
      line_number: parseInt(String(lineNum)),
      raw_client_name: clientName,
      is_female:
        fValue === "1" || fValue === "x" || fValue.toLowerCase() === "x",
      is_male:
        mValue === "1" || mValue === "x" || mValue.toLowerCase() === "x",
      was_altered: fValue === "1" || mValue === "1",
      female_altered: fValue === "1",
      male_altered: mValue === "1",
      is_walkin: awValue.toUpperCase() === "W",
      is_already_altered: awValue.toUpperCase() === "A",
      fee_code: String(row[colIndex.fee] || "").trim() || null,
      notes: String(row[colIndex.misc] || "").trim() || null,
      status: String(row[colIndex.status] || "").trim() || null,
      test_requested: String(row[colIndex.test] || "").trim() || null,
      test_result: String(row[colIndex.result] || "").trim() || null,
      parsed_owner_name: extractOwnerName(clientName),
      parsed_trapper_alias: extractTrapperName(clientName),
      parsed_cat_name: extractCatName(clientName),
    };

    entries.push(entry);
  }

  return { entries, extractedDate };
}

function extractOwnerName(clientName: string | null): string | null {
  if (!clientName) return null;

  let name = clientName
    .replace(/\s*-\s*Trp\s+.+$/i, "")
    .replace(/"[^"]+"/g, "")
    .replace(/'[^"']+"/g, "")
    .replace(/\s*\([^)]+\)/g, "")
    .trim();

  return name || null;
}

function extractTrapperName(clientName: string | null): string | null {
  if (!clientName) return null;

  const match = clientName.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

function extractCatName(clientName: string | null): string | null {
  if (!clientName) return null;

  let match = clientName.match(/"+"?([^"']+)"+"?/);
  if (match) {
    return match[1].trim();
  }
  match = clientName.match(/'([^"']+)"/);
  if (match) {
    return match[1].trim();
  }
  return null;
}
