/**
 * Master List Excel/CSV Parser
 *
 * Extracts clinic day entries from FFSC's master list spreadsheet format.
 * Used by:
 *   - apps/web/src/app/api/admin/clinic-days/[date]/import/route.ts (manual upload)
 *   - apps/web/src/app/api/cron/sharepoint-master-list-sync/route.ts (FFS-1088 auto-sync)
 *
 * Master list format:
 *   Row 1: Date (string "DD-Mon-YY" or Excel serial)
 *   Row 2: Headers — F | M | A/W | # | Client Name | Test | Result | Sx End Time | $ | ...
 *   Row 3+: Data rows
 *
 * Client name is a complex field that may contain:
 *   - Owner name
 *   - Cat name in quotes
 *   - Trapper alias after "- Trp"
 *   - Phone numbers
 *   - Foster/shelter/address tags
 *   - Recheck/medical follow-up keywords
 *
 * See parseClientNameExtended for the full pattern catalog.
 *
 * Created: 2026-04-07 (extracted from import/route.ts as part of FFS-1088)
 */

import * as xlsx from "xlsx";

export interface ParsedEntry {
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
  // FFS-105: Recheck detection
  is_recheck: boolean;
  recheck_type: string | null;
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
  // MIG_3043: Weight + surgery end time
  weight_lbs: number | null;
  sx_end_time: string | null;
}

export interface ParseResult {
  entries: ParsedEntry[];
  extractedDate: string | null;
}

export function parseMasterList(workbook: xlsx.WorkBook): ParseResult {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays to handle the non-standard format
  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });

  const entries: ParsedEntry[] = [];
  let headerRowIndex = -1;

  // Find the header row (contains "Client Name" — case-insensitive)
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] as unknown[];
    if (
      row &&
      row.some((cell) => String(cell).toLowerCase().includes("client name"))
    ) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return { entries: [], extractedDate: null };
  }

  // Extract date from first row if present (handles both string and Excel serial number dates)
  let extractedDate: string | null = null;
  if (rows[0] && (rows[0] as unknown[]).length > 0) {
    for (const cell of rows[0] as unknown[]) {
      if (!cell) continue;
      const cellStr = String(cell);

      // Try text date pattern: "DD-Mon-YY" (e.g., "9-Feb-26")
      if (cellStr.match(/\d{1,2}-\w{3}-\d{2}/)) {
        const parts = cellStr.match(/(\d{1,2})-(\w{3})-(\d{2})/);
        if (parts) {
          const monthMap: Record<string, string> = {
            jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
            jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
          };
          const [, day, mon, yr] = parts;
          const month = monthMap[mon.toLowerCase()];
          const year = parseInt(yr) > 50 ? `19${yr}` : `20${yr}`;
          extractedDate = `${year}-${month}-${day.padStart(2, "0")}`;
        }
      }
      // Handle Excel date serial numbers (e.g., 45331 for Feb 9 2024)
      else if (typeof cell === "number" && cell > 40000 && cell < 60000) {
        const parsed = xlsx.SSF.parse_date_code(cell);
        if (parsed) {
          extractedDate = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
        }
      }

      if (extractedDate) break;
    }
  }

  // Parse header to get column indices (case-insensitive matching)
  const header = rows[headerRowIndex] as unknown[];
  const colIndex: Record<string, number> = {};
  header.forEach((cell, idx) => {
    const cellStr = String(cell).trim();
    const cellLower = cellStr.toLowerCase();
    if (cellStr === "F" || cellStr === "f") colIndex.F = idx;
    else if (cellStr === "M" || cellStr === "m") colIndex.M = idx;
    else if (cellLower === "a/w" || cellStr === "A" || cellStr === "a") colIndex.AW = idx;
    else if (cellStr === "#" || cellLower === "no" || cellLower === "no." || cellLower === "line") colIndex.num = idx;
    else if (cellLower.includes("client name")) colIndex.clientName = idx;
    else if (cellLower === "test") colIndex.test = idx;
    else if (cellLower === "result") colIndex.result = idx;
    else if (cellStr === "$") colIndex.fee = idx;
    else if (cellLower === "miscellaneous" || cellLower === "misc") colIndex.misc = idx;
    else if (cellLower === "status") colIndex.status = idx;
    // MIG_3043: Weight and surgery end time columns
    else if (cellLower === "weight" || cellLower === "wt" || cellLower === "weight (lbs)") colIndex.weight = idx;
    else if (cellLower === "sx end time" || cellLower === "sx end" || cellLower === "end time") colIndex.sxEndTime = idx;
  });

  if (colIndex.clientName === undefined) {
    console.warn("[parseMasterList] Could not find 'Client Name' column. Headers found:", header.map(h => String(h).trim()));
    return { entries: [], extractedDate };
  }

  // Fallback: if # column not found, try to detect it by finding the first column
  // before Client Name that contains sequential integers in data rows
  if (colIndex.num === undefined) {
    for (let col = 0; col < (colIndex.clientName || 0); col++) {
      let sequentialCount = 0;
      for (let row = headerRowIndex + 1; row < Math.min(rows.length, headerRowIndex + 6); row++) {
        const val = (rows[row] as unknown[])?.[col];
        if (val && !isNaN(parseInt(String(val)))) sequentialCount++;
      }
      if (sequentialCount >= 2) {
        colIndex.num = col;
        break;
      }
    }
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

    // MIG_3043: Parse weight (validate 0.5-30.0 range for cats)
    let weightLbs: number | null = null;
    if (colIndex.weight !== undefined) {
      const rawWeight = parseFloat(String(row[colIndex.weight] || ""));
      if (!isNaN(rawWeight) && rawWeight >= 0.5 && rawWeight <= 30.0) {
        weightLbs = rawWeight;
      }
    }

    // MIG_3043: Parse surgery end time
    let sxEndTime: string | null = null;
    if (colIndex.sxEndTime !== undefined) {
      const rawTime = String(row[colIndex.sxEndTime] || "").trim();
      if (rawTime) {
        // Handle HH:MM, H:MM, or Excel time serial numbers
        if (typeof row[colIndex.sxEndTime] === "number") {
          const totalMinutes = Math.round((row[colIndex.sxEndTime] as number) * 24 * 60);
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          sxEndTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        } else if (rawTime.match(/^\d{1,2}:\d{2}/)) {
          sxEndTime = rawTime;
        }
      }
    }

    const entry: ParsedEntry = {
      line_number: parseInt(String(lineNum)),
      raw_client_name: clientName,
      is_female: fValue === "1" || fValue === "x" || fValue.toLowerCase() === "x",
      is_male: mValue === "1" || mValue === "x" || mValue.toLowerCase() === "x",
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
      parsed_owner_name: extendedParsed.owner_name ?? extractOwnerName(clientName),
      parsed_trapper_alias: extendedParsed.trapper_alias ?? extractTrapperName(clientName),
      parsed_cat_name: extendedParsed.cat_name ?? extractCatName(clientName),
      is_recheck: extendedParsed.is_recheck,
      recheck_type: extendedParsed.recheck_type,
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
      weight_lbs: weightLbs,
      sx_end_time: sxEndTime,
    };

    entries.push(entry);
  }

  return { entries, extractedDate };
}

function extractOwnerName(clientName: string | null): string | null {
  if (!clientName) return null;
  const name = clientName
    .replace(/\s*-\s*Trp\s+.+$/i, "")
    .replace(/"[^"]+"/g, "")
    .replace(/['"][^"']+['"]/g, "")
    .replace(/\s*\([^)]+\)/g, "")
    .trim();
  return name || null;
}

function extractTrapperName(clientName: string | null): string | null {
  if (!clientName) return null;
  const match = clientName.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
  if (match) return match[1].trim();
  return null;
}

function extractCatName(clientName: string | null): string | null {
  if (!clientName) return null;
  const match = clientName.match(/["']([^"']+)["']/);
  if (match) return match[1].trim();
  return null;
}

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
  is_recheck: boolean;
  recheck_type: string | null;
}

function parseClientNameExtended(clientName: string | null): ExtendedParsedName {
  const result: ExtendedParsedName = {
    owner_name: null, cat_name: null, trapper_alias: null,
    is_foster: false, foster_parent: null,
    is_shelter: false, org_code: null, shelter_id: null, org_name: null,
    is_address: false, address: null, cat_color: null,
    contact_phone: null, alt_contact_name: null, alt_phone: null,
    is_recheck: false, recheck_type: null,
  };

  if (!clientName) return result;

  const original = clientName.trim();

  // Pattern 0: Recheck/follow-up entry
  const recheckMatch = original.match(
    /^(re-?check|weight\s+check|dr\.?\s+follow[- ]?up|medical\s+follow[- ]?up|post[- ]?op)\b/i
  );
  if (recheckMatch) {
    result.is_recheck = true;
    result.recheck_type = recheckMatch[1].toLowerCase().replace(/\s+/g, "_");
    const catMatch = original.match(/['"]([^'"]+)['"]/);
    if (catMatch) result.cat_name = catMatch[1].trim();
    const ownerPart = original
      .replace(recheckMatch[0], "")
      .replace(/['"][^'"]+['"]/g, "")
      .replace(/-\s*Trp\s+.+$/i, "")
      .replace(/^\s*-\s*/, "")
      .trim();
    if (ownerPart) result.owner_name = ownerPart;
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    return result;
  }

  // Pattern 1: Foster — "Foster 'CatName' (FosterParent)"
  const fosterMatch = original.match(/^Foster\s+['"]([^'"]+)['"]\s*\(([^)]+)\)/i);
  if (fosterMatch) {
    result.is_foster = true;
    result.cat_name = fosterMatch[1].trim();
    result.foster_parent = fosterMatch[2].trim();
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    return result;
  }

  // Pattern 2: Shelter — "SCAS A439019" / "RPAS 12345"
  const shelterMatch = original.match(/^(SCAS|RPAS|HSOS|SHS|MCAS)\s+([A-Z]?\d{5,})/i);
  if (shelterMatch) {
    result.is_shelter = true;
    result.org_code = shelterMatch[1].toUpperCase();
    result.shelter_id = shelterMatch[2];
    const catMatch = original.match(/['"]([^'"]+)['"]/);
    if (catMatch) result.cat_name = catMatch[1].trim();
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    return result;
  }

  // Pattern 3: Org with cat name and phone
  const orgCatPhoneMatch = original.match(/^(.+?)\s+['"]([^'"]+)['"]\s*-\s*call.+?([\d-]{10,})/i);
  if (orgCatPhoneMatch && !orgCatPhoneMatch[1].match(/^\d/)) {
    result.org_name = orgCatPhoneMatch[1].trim();
    result.cat_name = orgCatPhoneMatch[2].trim();
    result.contact_phone = normalizePhone(orgCatPhoneMatch[3]);
    if (result.org_name.match(/animal\s+(services?|shelter|control)/i)) {
      result.is_shelter = true;
    }
    return result;
  }

  // Pattern 4: Address + Cat Color
  const addressColorMatch = original.match(
    /^(\d+\s+[A-Za-z\s]+?)\s+(Black|White|Orange|Gray|Grey|Tabby|Red|Calico|Tortie|Brown|Buff|Cream|Blue)\s*-/i
  );
  if (addressColorMatch) {
    result.is_address = true;
    result.address = addressColorMatch[1].trim();
    result.cat_color = addressColorMatch[2].trim();
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    const catMatch = original.match(/['"]([^'"]+)['"]/);
    if (catMatch) result.cat_name = catMatch[1].trim();
    return result;
  }

  // Pattern 5: Owner + Alt Contact
  const altContactMatch = original.match(/^(.+?)\s*-\s*call\s+([A-Za-z]+)\s+([\d-]{10,})/i);
  if (altContactMatch && !altContactMatch[1].match(/^Foster|^SCAS|^RPAS|^\d/i)) {
    result.owner_name = altContactMatch[1].trim();
    result.alt_contact_name = altContactMatch[2].trim();
    result.alt_phone = normalizePhone(altContactMatch[3]);
    const catMatch = original.match(/['"]([^'"]+)['"]/);
    if (catMatch) result.cat_name = catMatch[1].trim();
    const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
    if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();
    return result;
  }

  // Pattern 6: Phone in line
  const phoneMatch = original.match(/(\d{3}[-.]?\d{3}[-.]?\d{4})/);
  if (phoneMatch) result.contact_phone = normalizePhone(phoneMatch[1]);

  const catMatch = original.match(/['"]([^'"]+)['"]/);
  if (catMatch) result.cat_name = catMatch[1].trim();

  const trapperMatch = original.match(/-\s*Trp\s+([^"(-]+?)(?:\s*["(-]|\s+call\s|\s*$)/i);
  if (trapperMatch) result.trapper_alias = trapperMatch[1].trim();

  // FFS-105: Detect rechecks from parenthetical notes
  const parenRecheckMatch = original.match(
    /\((recheck|updates?|follow[- ]?up|drain\s+removal|suture\s+removal|enucleation|post[- ]?op)\b[^)]*\)/i
  );
  if (parenRecheckMatch) {
    result.is_recheck = true;
    result.recheck_type = parenRecheckMatch[1].toLowerCase().replace(/\s+/g, "_");
  }

  // Default: extract owner name
  if (!result.owner_name && !result.is_foster && !result.is_shelter && !result.is_address) {
    const ownerName = original
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
  return phone.replace(/\D/g, "");
}

/**
 * Parse a master list filename to extract the clinic date.
 *
 * Handles all observed naming variants:
 *   "Master List April 1, 2026.xlsx"
 *   "Master List  February 11, 2026.xlsx"        (double space)
 *   "Master List March 2nd 2026.xlsx"            (ordinal, no comma)
 *   "Master List March 30, 2025.xlsx"            (year mismatch — still parses)
 *   "Master List Template April 8, 2026.xlsx"    (template — returns isTemplate=true)
 *
 * Returns null if the filename doesn't match the master list pattern at all.
 *
 * Created: 2026-04-07 for FFS-1088
 */
export interface ParsedMasterListFilename {
  date: string;        // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  isTemplate: boolean;
}

export function parseMasterListFilename(filename: string): ParsedMasterListFilename | null {
  // Strip extension
  const base = filename.replace(/\.xlsx?$/i, "").trim();

  // Must start with "Master List" (case-insensitive). Allow extra whitespace.
  if (!/^master\s+list\b/i.test(base)) return null;

  const isTemplate = /\btemplate\b/i.test(base);

  // Extract month / day / year. Handles:
  //   "April 1, 2026" / "February 11, 2026" / "March 2nd 2026" / "March 30, 2025"
  // The day capture allows ordinal suffixes (1st, 2nd, 3rd, 4th).
  const re = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})/i;
  const m = base.match(re);
  if (!m) return null;

  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const month = monthNames[m[1].toLowerCase()];
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);

  if (!month || !day || !year || day < 1 || day > 31 || year < 2000 || year > 2100) {
    return null;
  }

  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date, year, month, day, isTemplate };
}
