/**
 * POST /api/admin/email-templates/[key]/preview
 *
 * Part of FFS-1181 Follow-Up Phase 6. Generic template preview.
 * Renders any template with the shared org render context merged with
 * a caller-provided sample payload. Returns the rendered subject +
 * HTML + text body plus a list of placeholders that were never
 * substituted.
 *
 * Body: { sample_payload?: Record<string, string>, version_number?: number }
 *
 * Admin-only. Never sends, never logs.
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiBadRequest,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
  apiNotFound,
} from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { buildOrgRenderContext } from "@/lib/email-render-context";

function replacePlaceholders(
  template: string,
  values: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, "g"),
      value || ""
    );
  }
  return result;
}

function findMissingPlaceholders(rendered: string): string[] {
  const regex = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  const unique = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = regex.exec(rendered))) unique.add(m[1]);
  return Array.from(unique);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin" && session.auth_role !== "staff") {
    return apiForbidden("Only staff can preview templates");
  }

  try {
    const { key } = await params;
    const body = await request.json().catch(() => ({}));
    const samplePayload = (body.sample_payload ?? {}) as Record<string, string>;
    const versionNumber = body.version_number as number | undefined;

    type TemplateRow = {
      subject: string;
      body_html: string;
      body_text: string | null;
      placeholders: string[] | null;
    };
    let template: TemplateRow | null;

    if (versionNumber) {
      template = await queryOne<TemplateRow>(
        `SELECT subject, body_html, body_text, placeholders
           FROM ops.email_template_versions
          WHERE template_key = $1 AND version_number = $2`,
        [key, versionNumber]
      );
    } else {
      template = await queryOne<TemplateRow>(
        `SELECT subject, body_html, body_text, placeholders
           FROM ops.email_templates
          WHERE template_key = $1 AND is_active = TRUE`,
        [key]
      );
    }

    if (!template) {
      return apiNotFound(
        versionNumber ? "template_version" : "template",
        versionNumber ? `${key}@${versionNumber}` : key
      );
    }

    // Shared org context + caller sample payload
    const merged: Record<string, string> = {
      ...(await buildOrgRenderContext()),
      ...samplePayload,
    };

    const subject = replacePlaceholders(template.subject, merged);
    const bodyHtml = replacePlaceholders(template.body_html, merged);
    const bodyText = template.body_text
      ? replacePlaceholders(template.body_text, merged)
      : null;

    // Anything still wrapped in {{...}} never got substituted
    const missing = Array.from(
      new Set([
        ...findMissingPlaceholders(subject),
        ...findMissingPlaceholders(bodyHtml),
        ...findMissingPlaceholders(bodyText ?? ""),
      ])
    );

    return apiSuccess({
      template_key: key,
      version_number: versionNumber ?? null,
      subject,
      body_html: bodyHtml,
      body_text: bodyText,
      missing_placeholders: missing,
      declared_placeholders: template.placeholders ?? [],
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return apiBadRequest("Invalid JSON body");
    }
    console.error("template preview error:", err);
    return apiServerError("Failed to render template preview");
  }
}
