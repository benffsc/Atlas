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
      `SELECT clinic_day_id FROM ops.clinic_days WHERE clinic_date = $1`,
      [date]
    );

    if (!clinicDay) {
      clinicDay = await queryOne<{ clinic_day_id: string }>(
        `INSERT INTO ops.clinic_days (clinic_date, clinic_type)
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
      `SELECT COUNT(*)::int as count FROM ops.clinic_day_entries WHERE clinic_day_id = $1`,
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
        `INSERT INTO ops.clinic_day_entries (
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
          entered_by,
          -- Extended parsing columns (MIG_900)
          is_foster,
          foster_parent_name,
          is_shelter,
          org_code,
          shelter_animal_id,
          org_name,
          is_address,
          parsed_address,
          parsed_cat_color,
          contact_phone,
          alt_contact_name,
          alt_contact_phone
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)`,
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
          // Extended fields
          entry.is_foster,
          entry.foster_parent_name,
          entry.is_shelter,
          entry.org_code,
          entry.shelter_animal_id,
          entry.org_name,
          entry.is_address,
          entry.parsed_address,
          entry.parsed_cat_color,
          entry.contact_phone,
          entry.alt_contact_name,
          entry.alt_contact_phone,
        ]
      );
      inserted++;
    }

    // Run smart matching (MIG_900)
    // Apply all strategies: owner_name → cat_name → sex → cardinality
    const matchPasses = await queryRows<{
      pass: string;
      entries_matched: number;
    }>(
      `SELECT * FROM trapper.apply_smart_master_list_matches($1)`,
      [date]
    );

    // Sum up results from all passes
    const matchResult = {
      entries_matched: matchPasses.reduce((sum, p) => sum + (p.entries_matched || 0), 0),
      by_pass: Object.fromEntries(matchPasses.map(p => [p.pass, p.entries_matched || 0])),
    };

    // Create entity relationships from successful matches
    await queryRows(
      `SELECT * FROM trapper.create_master_list_relationships($1)`,
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

    // Count extended parsing results
    const extendedSummary = {
      foster_entries: entries.filter((e) => e.is_foster).length,
      shelter_entries: entries.filter((e) => e.is_shelter).length,
      address_entries: entries.filter((e) => e.is_address).length,
      with_phone: entries.filter((e) => e.contact_phone).length,
    };

    return NextResponse.json({
      success: true,
      clinic_day_id: clinicDay.clinic_day_id,
      imported: inserted,
      trappers_resolved: trappersResolved,
      trappers_total: summary.with_trapper,
      matched: matchResult?.entries_matched || 0,
      match_details: matchResult?.by_pass || {},
      summary: {
        ...summary,
        ...extendedSummary,
      },
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
      `SELECT clinic_day_id FROM ops.clinic_days WHERE clinic_date = $1`,
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
        DELETE FROM ops.clinic_day_entries
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
  // Extended parsing (MIG_900)
  is_foster: boolean;
  foster_parent_name: string | null;
  is_shelter: boolean;
  org_code: string | null;
  shelter_animal_id: string | null;
  org_name: string | null;
  is_address: boolean;
  parsed_address: string | null;
  parsed_cat_color: string | null;
  contact_phone: string | null;
  alt_contact_name: string | null;
  alt_contact_phone: string | null;
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

    // Parse extended signals from client name
    const extendedParsed = parseClientNameExtended(clientName);

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
      // Use enhanced parsing (falls back to legacy)
      parsed_owner_name: extendedParsed.owner_name ?? extractOwnerName(clientName),
      parsed_trapper_alias: extendedParsed.trapper_alias ?? extractTrapperName(clientName),
      parsed_cat_name: extendedParsed.cat_name ?? extractCatName(clientName),
      // Extended fields (MIG_900)
      is_foster: extendedParsed.is_foster,
      foster_parent_name: extendedParsed.foster_parent,
      is_shelter: extendedParsed.is_shelter,
      org_code: extendedParsed.org_code,
      shelter_animal_id: extendedParsed.shelter_id,
      org_name: extendedParsed.org_name,
      is_address: extendedParsed.is_address,
      parsed_address: extendedParsed.address,
      parsed_cat_color: extendedParsed.cat_color,
      contact_phone: extendedParsed.contact_phone,
      alt_contact_name: extendedParsed.alt_contact_name,
      alt_contact_phone: extendedParsed.alt_phone,
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

/**
 * Extended client name parser (MIG_900)
 * Extracts all signals from complex client name formats:
 * - Foster: "Foster 'Asher' (Chiaroni)"
 * - Shelter: "SCAS A439019" or "RPAS 12345"
 * - Org: "Cat Rescue of Cloverdale 'Sylvester' - call 707-280-4556"
 * - Address: "5403 San Antonio Red - Trp Toni"
 * - Alt Contact: "Kathleen Frey - call Rose 707-331-0812"
 */
interface ExtendedParsedName {
  owner_name: string | null;
  cat_name: string | null;
  trapper_alias: string | null;
  is_foster: boolean;
  foster_parent: string | null;
  is_shelter: boolean;
  org_code: string | null;
  shelter_id: string | null;
  org_name: string | null;
  is_address: boolean;
  address: string | null;
  cat_color: string | null;
  contact_phone: string | null;
  alt_contact_name: string | null;
  alt_phone: string | null;
}

function parseClientNameExtended(clientName: string | null): ExtendedParsedName {
  const result: ExtendedParsedName = {
    owner_name: null,
    cat_name: null,
    trapper_alias: null,
    is_foster: false,
    foster_parent: null,
    is_shelter: false,
    org_code: null,
    shelter_id: null,
    org_name: null,
    is_address: false,
    address: null,
    cat_color: null,
    contact_phone: null,
    alt_contact_name: null,
    alt_phone: null,
  };

  if (!clientName) return result;

  const original = clientName.trim();

  // Pattern 1: Foster entry - "Foster 'CatName' (FosterParent)"
  const fosterMatch = original.match(/^Foster\s+['"]([^'"]+)['"]\s*\(([^)]+)\)/i);
  if (fosterMatch) {
    result.is_foster = true;
    result.cat_name = fosterMatch[1].trim();
    result.foster_parent = fosterMatch[2].trim();
    // Extract trapper if present after foster info
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    return result;
  }

  // Pattern 2: Shelter ID - "SCAS A439019" or "RPAS 12345" (known shelter codes)
  // Common codes: SCAS (Sonoma County Animal Services), RPAS (Rohnert Park Animal Shelter)
  const shelterMatch = original.match(/^(SCAS|RPAS|HSOS|SHS|MCAS)\s+([A-Z]?\d{5,})/i);
  if (shelterMatch) {
    result.is_shelter = true;
    result.org_code = shelterMatch[1].toUpperCase();
    result.shelter_id = shelterMatch[2];
    // Extract cat name if present in quotes
    const catMatch = original.match(/['"]([^'"]+)['"]/);
    if (catMatch) result.cat_name = catMatch[1].trim();
    // Extract trapper if present
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    return result;
  }

  // Pattern 3: Organization with cat name and phone
  // "Cat Rescue of Cloverdale 'Sylvester' - call 707-280-4556"
  const orgCatPhoneMatch = original.match(/^(.+?)\s+['"]([^'"]+)['"]\s*-\s*call.+?([\d-]{10,})/i);
  if (orgCatPhoneMatch && !orgCatPhoneMatch[1].match(/^\d/)) {
    result.org_name = orgCatPhoneMatch[1].trim();
    result.cat_name = orgCatPhoneMatch[2].trim();
    result.contact_phone = normalizePhone(orgCatPhoneMatch[3]);
    // Try to identify if this is a known shelter
    if (result.org_name.match(/animal\s+(services?|shelter|control)/i)) {
      result.is_shelter = true;
    }
    return result;
  }

  // Pattern 4: Address + Cat Color - "5403 San Antonio Red - Trp Toni"
  // Starts with house number, includes color word before trapper
  const addressColorMatch = original.match(
    /^(\d+\s+[A-Za-z\s]+?)\s+(Black|White|Orange|Gray|Grey|Tabby|Red|Calico|Tortie|Brown|Buff|Cream|Blue)\s*-/i
  );
  if (addressColorMatch) {
    result.is_address = true;
    result.address = addressColorMatch[1].trim();
    result.cat_color = addressColorMatch[2].trim();
    // Extract trapper
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    // Extract cat name if present
    const catMatch = original.match(/['"]([^'"]+)['"]/);
    if (catMatch) result.cat_name = catMatch[1].trim();
    return result;
  }

  // Pattern 5: Owner + Alt Contact - "Kathleen Frey - call Rose 707-331-0812"
  const altContactMatch = original.match(/^(.+?)\s*-\s*call\s+([A-Za-z]+)\s+([\d-]{10,})/i);
  if (altContactMatch && !altContactMatch[1].match(/^Foster|^SCAS|^RPAS|^\d/i)) {
    result.owner_name = altContactMatch[1].trim();
    result.alt_contact_name = altContactMatch[2].trim();
    result.alt_phone = normalizePhone(altContactMatch[3]);
    // Extract cat name if in quotes
    const catMatch = original.match(/['"]([^'"]+)['"]/);
    if (catMatch) result.cat_name = catMatch[1].trim();
    // Extract trapper if also present
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    return result;
  }

  // Pattern 6: Standard format with phone - extract phone from anywhere
  const phoneMatch = original.match(/(\d{3}[-.]?\d{3}[-.]?\d{4})/);
  if (phoneMatch) {
    result.contact_phone = normalizePhone(phoneMatch[1]);
  }

  // Extract cat name from quotes (common across all formats)
  const catMatch = original.match(/['"]([^'"]+)['"]/);
  if (catMatch) {
    result.cat_name = catMatch[1].trim();
  }

  // Extract trapper
  const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
  if (trapperMatch) {
    result.trapper_alias = trapperMatch[1].trim();
  }

  // Default: Try to extract owner name (what's left after removing cat name and trapper)
  if (!result.owner_name && !result.is_foster && !result.is_shelter && !result.is_address) {
    let ownerName = original
      .replace(/\s*-\s*Trp\s+.+$/i, "")
      .replace(/['"][^'"]+['"]/g, "")
      .replace(/\s*\([^)]+\)/g, "")
      .replace(/\s*-\s*call.+$/i, "")
      .trim();
    if (ownerName) result.owner_name = ownerName;
  }

  return result;
}

function normalizePhone(phone: string): string {
  // Remove all non-digits
  return phone.replace(/\D/g, "");
}
