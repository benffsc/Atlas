/**
 * Email Resource Renderer (FFS-1185)
 *
 * Renders dynamic <p>-block resource cards for the
 * out_of_service_area email template. Used by:
 *   - sendOutOfServiceAreaEmail() in lib/email.ts
 *   - /api/emails/preview-out-of-service-area route
 *
 * The shape of each row is whatever ops.get_neighbor_county_resources()
 * returns (MIG_3059):
 *   slug, name, description, phone, address, website_url,
 *   county_served, region, priority
 */

import { queryRows } from "./db";

export interface CountyResourceRow {
  slug: string;
  name: string;
  description: string | null;
  phone: string | null;
  address: string | null;
  website_url: string | null;
  county_served: string | null;
  region: string | null;
  priority: number | null;
}

export interface RenderedResources {
  countyHtml: string;
  statewideHtml: string;
  nearbyHtml: string;
  countyText: string;
  statewideText: string;
  nearbyText: string;
  rows: CountyResourceRow[];
}

/**
 * California county adjacency map — which counties border which.
 * Used to show "nearby" resources when a county has no direct matches.
 */
const COUNTY_NEIGHBORS: Record<string, string[]> = {
  "Sonoma":       ["Marin", "Napa", "Lake", "Mendocino", "Solano"],
  "Marin":        ["Sonoma", "San Francisco", "Contra Costa"],
  "Napa":         ["Sonoma", "Solano", "Lake", "Yolo"],
  "Lake":         ["Sonoma", "Mendocino", "Napa", "Colusa", "Yolo"],
  "Mendocino":    ["Sonoma", "Lake", "Humboldt", "Trinity", "Glenn"],
  "Solano":       ["Sonoma", "Napa", "Contra Costa", "Sacramento", "Yolo"],
  "San Francisco":["Marin", "San Mateo", "Contra Costa"],
  "Contra Costa": ["Marin", "Solano", "Alameda", "San Joaquin", "Sacramento"],
  "Alameda":      ["Contra Costa", "San Joaquin", "Santa Clara", "San Mateo"],
  "San Mateo":    ["San Francisco", "Alameda", "Santa Clara", "Santa Cruz"],
  "Sacramento":   ["Solano", "Yolo", "Contra Costa", "San Joaquin", "El Dorado", "Placer", "Sutter"],
  "Yolo":         ["Solano", "Napa", "Lake", "Colusa", "Sutter", "Sacramento"],
  "Santa Clara":  ["Alameda", "San Mateo", "Santa Cruz", "San Benito", "Stanislaus", "Merced"],
  "Humboldt":     ["Mendocino", "Trinity", "Del Norte", "Siskiyou"],
  "Del Norte":    ["Humboldt", "Siskiyou"],
};

/**
 * Escape a user-controlled string for safe HTML interpolation.
 */
function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRowHtml(row: CountyResourceRow): string {
  const parts: string[] = [];
  parts.push(`<strong>${escapeHtml(row.name)}</strong>`);
  if (row.description) {
    parts.push(`<br><span style="color:#555;">${escapeHtml(row.description)}</span>`);
  }
  if (row.address) {
    parts.push(`<br>${escapeHtml(row.address)}`);
  }
  if (row.phone) {
    parts.push(`<br>${escapeHtml(row.phone)}`);
  }
  if (row.website_url) {
    const safeUrl = encodeURI(row.website_url);
    parts.push(
      `<br><a href="${escapeHtml(safeUrl)}" style="color:#2563eb;">${escapeHtml(row.website_url)}</a>`
    );
  }
  return `<p style="margin:14px 0;">${parts.join("")}</p>`;
}

function renderRowText(row: CountyResourceRow): string {
  const lines: string[] = [];
  lines.push(`* ${row.name}`);
  if (row.description) lines.push(`  ${row.description}`);
  if (row.address) lines.push(`  ${row.address}`);
  if (row.phone) lines.push(`  ${row.phone}`);
  if (row.website_url) lines.push(`  ${row.website_url}`);
  return lines.join("\n");
}

/**
 * Render community resources for the given county into HTML + text
 * blocks ready to drop into the out_of_service_area email template.
 *
 * When a county has no direct resources, also pulls from neighboring
 * counties so the recipient isn't left with just statewide directories.
 */
export async function renderCountyResources(
  county: string | null | undefined
): Promise<RenderedResources> {
  const targetCounty = county && county.trim() ? county.trim() : "Sonoma";

  const rows = await queryRows<CountyResourceRow>(
    `SELECT slug, name, description, phone, address, website_url,
            county_served, region, priority
       FROM ops.get_neighbor_county_resources($1)`,
    [targetCounty]
  );

  const countyRows = rows.filter((r) => r.county_served === targetCounty);
  const statewideRows = rows.filter((r) => r.county_served === "statewide");

  // If no county-specific resources, fetch from neighboring counties
  let nearbyRows: CountyResourceRow[] = [];
  if (countyRows.length === 0) {
    const neighbors = COUNTY_NEIGHBORS[targetCounty] || [];
    if (neighbors.length > 0) {
      const allNearby = await queryRows<CountyResourceRow>(
        `SELECT slug, name, description, phone, address, website_url,
                county_served, region, priority
           FROM ops.community_resources
          WHERE is_active = TRUE
            AND county_served = ANY($1)
            AND county_served != 'Sonoma'
            AND county_served != 'statewide'
          ORDER BY county_served, priority, name`,
        [neighbors]
      );
      nearbyRows = allNearby;
    }
  }

  // County-specific section
  const countyHtml = countyRows.length
    ? countyRows.map(renderRowHtml).join("\n")
    : `<p style="margin:14px 0;color:#555;">We don't have specific contacts in ${escapeHtml(targetCounty)} County yet, but we've included nearby resources and statewide directories below.</p>`;

  const countyText = countyRows.length
    ? countyRows.map(renderRowText).join("\n\n")
    : `(No county-specific resources currently listed for ${targetCounty} County — see nearby and statewide resources below.)`;

  // Nearby counties section (only when county has no direct resources)
  let nearbyHtml = "";
  let nearbyText = "";
  if (nearbyRows.length > 0) {
    // Group by county for display
    const byCounty = new Map<string, CountyResourceRow[]>();
    for (const r of nearbyRows) {
      const c = r.county_served || "Other";
      if (!byCounty.has(c)) byCounty.set(c, []);
      byCounty.get(c)!.push(r);
    }

    const sections: string[] = [];
    const textSections: string[] = [];
    for (const [c, cRows] of byCounty) {
      sections.push(
        `<p style="margin:18px 0 6px; font-weight:600; color:#5a5a5a;">${escapeHtml(c)} County</p>\n` +
        cRows.map(renderRowHtml).join("\n")
      );
      textSections.push(
        `--- ${c} County ---\n` + cRows.map(renderRowText).join("\n\n")
      );
    }
    nearbyHtml = sections.join("\n");
    nearbyText = textSections.join("\n\n");
  }

  // Statewide section
  const statewideHtml = statewideRows.length
    ? statewideRows.map(renderRowHtml).join("\n")
    : `<p style="margin:14px 0;color:#888;font-style:italic;">No statewide directories are currently listed.</p>`;

  const statewideText = statewideRows.length
    ? statewideRows.map(renderRowText).join("\n\n")
    : "(No statewide directories currently listed.)";

  return { countyHtml, statewideHtml, nearbyHtml, countyText, statewideText, nearbyText, rows };
}
