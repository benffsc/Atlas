/**
 * POST /api/admin/email-settings/flows/create
 *
 * Creates a new email flow (ops.email_flows) and its starter template
 * (ops.email_templates) in one transaction. Admin-only.
 *
 * Body:
 *   display_name            - required, human-readable name
 *   flow_slug               - required, kebab-case key (becomes PK)
 *   description             - optional
 *   subject                 - required, default template subject
 *   send_via                - "outlook" | "resend" (default "outlook")
 *   outlook_account_email   - optional, shown when send_via=outlook
 *   enabled                 - boolean (default false)
 *   dry_run                 - boolean (default true)
 */

import { NextRequest } from "next/server";
import {
  apiSuccess,
  apiBadRequest,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const STARTER_BODY_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #222; line-height: 1.55;">
  <div style="text-align: center; margin-bottom: 16px;">
    <img src="{{org_logo_url}}" alt="{{brand_full_name}}" width="120" style="margin: 10px auto; display: block;" />
  </div>
  <p>Hi {{first_name}},</p>
  <p>[Your email content here]</p>
  <p>With appreciation,</p>
  <div style="font-size: 13px; color: #333; margin-top: 28px; border-top: 1px solid #ddd; padding-top: 16px;">
    <strong>{{brand_full_name}} Team</strong><br>
    {{org_phone}}<br>
    {{org_email}}<br>
    {{org_address}}<br>
    <a href="https://{{org_website}}" style="color: #2563eb;">{{org_website}}</a>
  </div>
</body>
</html>`;

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can create email flows");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const {
      display_name,
      flow_slug,
      description,
      subject,
      send_via = "outlook",
      outlook_account_email,
      enabled = false,
      dry_run = true,
    } = body as {
      display_name?: string;
      flow_slug?: string;
      description?: string;
      subject?: string;
      send_via?: string;
      outlook_account_email?: string;
      enabled?: boolean;
      dry_run?: boolean;
    };

    // --- Validation ---
    if (!display_name || typeof display_name !== "string" || !display_name.trim()) {
      return apiBadRequest("display_name is required");
    }
    if (!flow_slug || typeof flow_slug !== "string" || !SLUG_REGEX.test(flow_slug)) {
      return apiBadRequest(
        "flow_slug is required and must be lowercase kebab-case (e.g. booking-confirmation)"
      );
    }
    if (!subject || typeof subject !== "string" || !subject.trim()) {
      return apiBadRequest("subject is required");
    }
    if (send_via !== "outlook" && send_via !== "resend") {
      return apiBadRequest("send_via must be 'outlook' or 'resend'");
    }

    // Check for duplicate flow_slug
    const existing = await queryOne<{ flow_slug: string }>(
      `SELECT flow_slug FROM ops.email_flows WHERE flow_slug = $1`,
      [flow_slug]
    );
    if (existing) {
      return apiBadRequest(`A flow with slug "${flow_slug}" already exists`);
    }

    // Check for duplicate template_key
    const existingTemplate = await queryOne<{ template_key: string }>(
      `SELECT template_key FROM ops.email_templates WHERE template_key = $1`,
      [flow_slug]
    );
    if (existingTemplate) {
      return apiBadRequest(
        `A template with key "${flow_slug}" already exists`
      );
    }

    // --- Create template ---
    await queryOne(
      `INSERT INTO ops.email_templates (
        template_key, name, description, subject, body_html, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [
        flow_slug,
        display_name.trim(),
        description?.trim() || null,
        subject.trim(),
        STARTER_BODY_HTML,
        session.staff_id,
      ]
    );

    // --- Create flow ---
    const flow = await queryOne<{
      flow_slug: string;
      display_name: string;
      description: string | null;
      template_key: string | null;
      enabled: boolean;
      dry_run: boolean;
      send_via: string;
      outlook_account_email: string | null;
    }>(
      `INSERT INTO ops.email_flows (
        flow_slug, display_name, description, template_key,
        enabled, dry_run, send_via, outlook_account_email, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING flow_slug, display_name, description, template_key,
                enabled, dry_run, send_via, outlook_account_email`,
      [
        flow_slug,
        display_name.trim(),
        description?.trim() || null,
        flow_slug, // template_key = flow_slug
        enabled,
        dry_run,
        send_via,
        outlook_account_email?.trim() || null,
        session.staff_id,
      ]
    );

    // Audit log — best effort
    try {
      await queryOne(
        `INSERT INTO ops.entity_edits
           (entity_type, entity_id, field_name, old_value, new_value, changed_by, edit_source)
         VALUES ('email_flow', NULL, $1, NULL, $2, $3, 'admin_flow_create')`,
        [
          `${flow_slug}_create`,
          JSON.stringify(flow),
          session.staff_id,
        ]
      );
    } catch (err) {
      console.warn("Failed to write audit row for flow create:", err);
    }

    return apiSuccess({ flow });
  } catch (err) {
    console.error("flow create error:", err);
    return apiServerError("Failed to create email flow");
  }
}
