/**
 * Waiver Filename Parser
 *
 * Parses scanned waiver PDF filenames into structured data.
 * FFSC waiver naming convention: "{LastName} {Description} {last4chip} {date}.pdf"
 *
 * Examples:
 *   "Martinez DSH Black 2107 3.4.26.pdf"
 *   → { lastName: "Martinez", description: "DSH Black", last4Chip: "2107", date: "2026-03-04" }
 *
 *   "Avila Stitch 0848 4.2.2026.pdf"
 *   → { lastName: "Avila", description: "Stitch", last4Chip: "0848", date: "2026-04-02" }
 *
 *   "Alvarado DMH brown tabby with white 5.96lbs 3.18.26.pdf"  (no chip — weight instead)
 *   → { lastName: "Alvarado", description: "DMH brown tabby with white 5.96lbs", last4Chip: "", date: "2026-03-18" }
 *
 *   "Cochran Ivy  3.30.26.pdf"  (no chip, no weight)
 *   → { lastName: "Cochran", description: "Ivy", last4Chip: "", date: "2026-03-30" }
 */

export interface WaiverFilenameData {
  lastName: string;
  description: string;
  last4Chip: string;
  date: string; // ISO format YYYY-MM-DD
  raw: string;
}

export type WaiverParseResult =
  | { success: true; data: WaiverFilenameData }
  | { success: false; error: string; raw: string };

/**
 * Parse a waiver PDF filename into structured data.
 *
 * Supports multiple patterns:
 * 1. {LastName} {Desc} {4-digit chip} {M.D.YY}.pdf  (standard with chip)
 * 2. {LastName} {Desc} {4-digit chip} {M.D.YYYY}.pdf  (4-digit year variant)
 * 3. {LastName} {Desc} {M.D.YY}.pdf  (no chip — weight or cat name before date)
 * 4. {LastName} {Desc} {M.D.YYYY}.pdf  (no chip, 4-digit year)
 *
 * Skips staff files: "Staff Roster", "Master List", "Clinic Roster"
 */
export function parseWaiverFilename(filename: string): WaiverParseResult {
  const raw = filename;

  // Strip .pdf extension (case insensitive)
  const name = filename.replace(/\.pdf$/i, "").trim();
  if (!name) {
    return { success: false, error: "Empty filename", raw };
  }

  // Skip known non-waiver files
  const lowerName = name.toLowerCase();
  if (lowerName.includes("staff roster") || lowerName.includes("master list") || lowerName.includes("clinic roster")) {
    return { success: false, error: "Staff/admin file, not a waiver", raw };
  }

  // Try pattern 1/2: {stuff} {4-digit chip} {M.D.YY or M.D.YYYY}
  const matchWithChip = name.match(
    /^(.+?)\s+(\d{4})\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/
  );

  if (matchWithChip) {
    const [, nameAndDesc, last4Chip, monthStr, dayStr, yearStr] = matchWithChip;
    const dateResult = parseDate(monthStr, dayStr, yearStr);
    if (!dateResult.success) {
      return { success: false, error: dateResult.error, raw };
    }

    const { lastName, description } = splitNameAndDesc(nameAndDesc);
    return {
      success: true,
      data: { lastName, description, last4Chip, date: dateResult.date, raw },
    };
  }

  // Try pattern 3/4: {stuff} {M.D.YY or M.D.YYYY} (no 4-digit chip)
  // Date is always at the end, optionally preceded by "0" prefix on month
  const matchNoChip = name.match(
    /^(.+?)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/
  );

  if (matchNoChip) {
    const [, nameAndDesc, monthStr, dayStr, yearStr] = matchNoChip;
    const dateResult = parseDate(monthStr, dayStr, yearStr);
    if (!dateResult.success) {
      return { success: false, error: dateResult.error, raw };
    }

    const { lastName, description } = splitNameAndDesc(nameAndDesc);
    return {
      success: true,
      data: { lastName, description, last4Chip: "", date: dateResult.date, raw },
    };
  }

  return {
    success: false,
    error: "Filename does not match expected pattern: {Name} {Desc} [chip] {M.D.YY}.pdf",
    raw,
  };
}

function parseDate(monthStr: string, dayStr: string, yearStr: string): { success: true; date: string } | { success: false; error: string } {
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  let year = parseInt(yearStr, 10);

  // 2-digit year: 00-49 → 2000-2049, 50-99 → 1950-1999
  // 4-digit year: use as-is
  if (year < 50) year = 2000 + year;
  else if (year < 100) year = 1900 + year;

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { success: false, error: `Invalid date: ${monthStr}.${dayStr}.${yearStr}` };
  }

  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const dateObj = new Date(dateStr);
  if (isNaN(dateObj.getTime())) {
    return { success: false, error: `Invalid date: ${dateStr}` };
  }

  return { success: true, date: dateStr };
}

function splitNameAndDesc(nameAndDesc: string): { lastName: string; description: string } {
  const parts = nameAndDesc.trim().split(/\s+/);
  return {
    lastName: parts[0] || "",
    description: parts.slice(1).join(" ") || "",
  };
}

/**
 * Parse multiple filenames and return results for each.
 */
export function parseWaiverFilenames(filenames: string[]): WaiverParseResult[] {
  return filenames.map(parseWaiverFilename);
}
