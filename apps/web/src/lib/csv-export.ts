/**
 * CSV Export Utility
 *
 * Client-side CSV generation and download. No server roundtrip needed.
 */

/**
 * Escapes a value for CSV output.
 * Wraps in quotes if value contains comma, quote, or newline.
 */
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates a CSV string from headers and rows.
 *
 * @param headers - Column header labels
 * @param rows - Array of row data (each row is an array matching headers order)
 * @returns CSV content string
 */
export function generateCsv(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): string {
  const headerLine = headers.map(escapeCsvValue).join(",");
  const dataLines = rows.map((row) => row.map(escapeCsvValue).join(","));
  return [headerLine, ...dataLines].join("\n");
}

/**
 * Triggers a browser download of CSV content.
 *
 * @param content - CSV string content
 * @param filename - Download filename (should end in .csv)
 */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
