/**
 * Central registry of FFSC print documents.
 *
 * Add new document types here. All documents share:
 *   - CSS: PRINT_BASE_CSS + PRINT_EDITABLE_CSS from print-styles.ts
 *   - Components: PrintPrimitives from components/print/
 *   - Helpers: formatPrintValue, formatPrintDate from print-helpers.ts
 *
 * To add a new document:
 *   1. Add entry to PRINT_DOCUMENTS below
 *   2. Create page at the specified route
 *   3. Import shared CSS + components
 *   4. Add links in SidebarLayout.tsx and relevant detail pages
 */

export const PRINT_DOCUMENTS = {
  help_request: {
    key: "help_request",
    title: "Help Request Form",
    route: "/intake/print",
    description: "Public intake form for requesting assistance",
    audience: "Public" as const,
    prefillable: false,
  },
  tnr_call_sheet: {
    key: "tnr_call_sheet",
    title: "TNR Call Sheet",
    route: "/requests/print",
    blankRoute: "/requests/print?blank=true",
    description:
      "Standardized phone script for trappers calling people back",
    audience: "Trappers" as const,
    prefillable: true,
  },
  trapper_sheet: {
    key: "trapper_sheet",
    title: "Trapper Assignment Sheet",
    routeForRequest: (requestId: string) =>
      `/requests/${requestId}/trapper-sheet`,
    description: "Pre-filled field trapping assignment with recon mode",
    audience: "Trappers" as const,
    prefillable: true,
  },
  call_sheet_print: {
    key: "call_sheet_print",
    title: "Call Sheet (Tracked)",
    routeForCallSheet: (callSheetId: string) =>
      `/admin/call-sheets/${callSheetId}/print`,
    description: "Tracked call sheet with contacts and disposition columns",
    audience: "Coordinator" as const,
    prefillable: false,
  },
} as const;

export type PrintDocumentKey = keyof typeof PRINT_DOCUMENTS;

/**
 * Build a prefill URL for the TNR Call Sheet from request/contact data.
 * Pass only the fields you have — nulls are filtered out.
 */
export function buildCallSheetUrl(data: {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
}): string {
  const params = new URLSearchParams(
    Object.entries(data).filter(
      (entry): entry is [string, string] => !!entry[1]
    )
  );
  const qs = params.toString();
  return qs ? `/requests/print?${qs}` : "/requests/print";
}
