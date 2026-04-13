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
  countyText: string;
  statewideText: string;
  rows: CountyResourceRow[];
}

/**
 * Escape a user-controlled string for safe HTML interpolation.
 * Resource fields are admin-controlled today (FFS-1117) but we still
 * escape because some come from external scrape verification.
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
 * Always queries via the helper function (MIG_3059) so the merge
 * order (county first, statewide last, priority asc) is consistent.
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

  const countyHtml = countyRows.length
    ? countyRows.map(renderRowHtml).join("\n")
    : `<p style="margin:14px 0;color:#888;font-style:italic;">No county-specific resources are currently listed for ${escapeHtml(targetCounty)} County.</p>`;

  const statewideHtml = statewideRows.length
    ? statewideRows.map(renderRowHtml).join("\n")
    : `<p style="margin:14px 0;color:#888;font-style:italic;">No statewide directories are currently listed.</p>`;

  const countyText = countyRows.length
    ? countyRows.map(renderRowText).join("\n\n")
    : `(No county-specific resources currently listed for ${targetCounty} County.)`;

  const statewideText = statewideRows.length
    ? statewideRows.map(renderRowText).join("\n\n")
    : "(No statewide directories currently listed.)";

  return { countyHtml, statewideHtml, countyText, statewideText, rows };
}
