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
 *   "Smith Tabby F 8834 12.15.25.pdf"
 *   → { lastName: "Smith", description: "Tabby F", last4Chip: "8834", date: "2025-12-15" }
 *
 *   "O'Brien Orange M 1122 1.20.26.pdf"
 *   → { lastName: "O'Brien", description: "Orange M", last4Chip: "1122", date: "2026-01-20" }
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
 * Pattern: {LastName} {Description...} {4-digit chip} {M.D.YY}.pdf
 * - LastName: First token (may contain apostrophes/hyphens)
 * - Description: Everything between last name and last4 chip
 * - Last4Chip: 4-digit number (last 4 of microchip)
 * - Date: M.D.YY format (dots as separators, 2-digit year)
 */
export function parseWaiverFilename(filename: string): WaiverParseResult {
  const raw = filename;

  // Strip .pdf extension (case insensitive)
  const name = filename.replace(/\.pdf$/i, "").trim();
  if (!name) {
    return { success: false, error: "Empty filename", raw };
  }

  // Pattern: {stuff} {4digits} {M.D.YY}
  // The date is always at the end: 1-2 digit month . 1-2 digit day . 2-digit year
  // The 4-digit chip is always right before the date
  const match = name.match(
    /^(.+?)\s+(\d{4})\s+(\d{1,2})\.(\d{1,2})\.(\d{2})$/
  );

  if (!match) {
    return {
      success: false,
      error: "Filename does not match expected pattern: {Name} {Desc} {4-digit chip} {M.D.YY}.pdf",
      raw,
    };
  }

  const [, nameAndDesc, last4Chip, monthStr, dayStr, yearStr] = match;

  // Parse date
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  let year = parseInt(yearStr, 10);

  // 2-digit year: 00-49 → 2000-2049, 50-99 → 1950-1999
  year = year < 50 ? 2000 + year : 1900 + year;

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { success: false, error: `Invalid date: ${monthStr}.${dayStr}.${yearStr}`, raw };
  }

  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Validate the date is real
  const dateObj = new Date(dateStr);
  if (isNaN(dateObj.getTime())) {
    return { success: false, error: `Invalid date: ${dateStr}`, raw };
  }

  // Split nameAndDesc into lastName (first token) and description (rest)
  const parts = nameAndDesc.trim().split(/\s+/);
  if (parts.length < 1) {
    return { success: false, error: "Could not extract last name", raw };
  }

  const lastName = parts[0];
  const description = parts.slice(1).join(" ") || "";

  return {
    success: true,
    data: {
      lastName,
      description,
      last4Chip,
      date: dateStr,
      raw,
    },
  };
}

/**
 * Parse multiple filenames and return results for each.
 */
export function parseWaiverFilenames(filenames: string[]): WaiverParseResult[] {
  return filenames.map(parseWaiverFilename);
}
