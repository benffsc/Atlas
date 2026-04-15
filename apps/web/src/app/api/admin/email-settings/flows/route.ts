/**
 * GET /api/admin/email-settings/flows
 * PATCH /api/admin/email-settings/flows
 *
 * Part of FFS-1181 Follow-Up Phase 3. Lists and updates ops.email_flows
 * rows. PATCH body: { flow_slug, enabled?, dry_run?, test_recipient_override? }
 *
 * Admin-only.
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
import { listFlows, updateFlow, getFlow } from "@/lib/email-flows";
import { queryOne } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can view email flow config");
  }

  try {
    const flows = await listFlows();
    return apiSuccess({ flows });
  } catch (err) {
    console.error("flows list error:", err);
    return apiServerError("Failed to load email flows");
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiUnauthorized();
  if (session.auth_role !== "admin") {
    return apiForbidden("Only admins can update email flow config");
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { flow_slug, enabled, dry_run, test_recipient_override, send_via, outlook_account_email } = body as {
      flow_slug?: string;
      enabled?: boolean;
      dry_run?: boolean;
      test_recipient_override?: string | null;
      send_via?: string | null;
      outlook_account_email?: string | null;
    };

    if (!flow_slug || typeof flow_slug !== "string") {
      return apiBadRequest("flow_slug is required");
    }

    // Gate: enabling a flow requires a successful test send to the
    // configured test recipient for its template. Mirrors the Go Live
    // gate on /api/admin/email-settings/go-live.
    if (enabled === true) {
      const flow = await getFlow(flow_slug);
      if (!flow) {
        return apiBadRequest(`Unknown flow_slug: ${flow_slug}`);
      }
      const testRecipient =
        flow.test_recipient_override ||
        process.env.EMAIL_TEST_RECIPIENT_OVERRIDE ||
        "ben@forgottenfelines.com";

      if (flow.template_key) {
        const row = await queryOne<{ sent_count: number }>(
          `SELECT COUNT(*)::INT AS sent_count
             FROM ops.sent_emails
            WHERE template_key = $1
              AND recipient_email = $2
              AND status = 'sent'`,
          [flow.template_key, testRecipient]
        );
        if ((row?.sent_count ?? 0) < 1) {
          return apiBadRequest(
            `Cannot enable flow ${flow_slug} until at least one successful test send to ${testRecipient} is recorded.`,
            { test_recipient: testRecipient }
          );
        }
      }
    }

    const updated = await updateFlow(
      flow_slug,
      {
        ...(enabled !== undefined && { enabled }),
        ...(dry_run !== undefined && { dry_run }),
        ...(test_recipient_override !== undefined && {
          test_recipient_override,
        }),
        ...(send_via !== undefined && { send_via: send_via as "resend" | "outlook" }),
        ...(outlook_account_email !== undefined && { outlook_account_email }),
      },
      session.staff_id
    );

    if (!updated) {
      return apiBadRequest(`Unknown flow_slug: ${flow_slug}`);
    }

    // Audit log — best effort
    try {
      await queryOne(
        `INSERT INTO ops.entity_edits
           (entity_type, entity_id, field_name, old_value, new_value, changed_by, edit_source)
         VALUES ('email_flow', NULL, $1, $2, $3, $4, 'admin_flow_update')`,
        [
          `${flow_slug}_update`,
          JSON.stringify(body),
          JSON.stringify(updated),
          session.staff_id,
        ]
      );
    } catch (err) {
      console.warn("Failed to write audit row for flow update:", err);
    }

    return apiSuccess({ flow: updated });
  } catch (err) {
    console.error("flows patch error:", err);
    return apiServerError("Failed to update email flow");
  }
}
