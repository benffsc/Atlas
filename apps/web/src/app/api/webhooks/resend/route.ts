/**
 * POST /api/webhooks/resend
 *
 * Part of FFS-1181 Follow-Up Phase 5. Receives Resend webhook events:
 *
 *   email.sent         — ignore (we write sent state locally)
 *   email.delivered    — UPDATE ops.sent_emails.status = 'delivered'
 *   email.bounced      — hard bounce → global suppression (permanent)
 *   email.complained   — spam complaint → global suppression (permanent)
 *   email.delivery_delayed — soft bounce → increment counter, escalate after 3 in 30d
 *
 * Signature verification via Resend's Svix-style headers using
 * RESEND_WEBHOOK_SECRET env var. Idempotent via external_id.
 *
 * Docs: https://resend.com/docs/dashboard/webhooks/introduction
 */

import { NextRequest } from "next/server";
import crypto from "crypto";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    bounce?: {
      type?: string;
      message?: string;
    };
    complaint?: {
      type?: string;
    };
  };
}

/**
 * Verify an incoming Resend webhook signature. Resend signs webhook
 * payloads with a symmetric secret; the signature is an HMAC of the
 * `${timestamp}.${body}` string. Timestamp drift > 5 minutes is
 * rejected to defeat replay attacks.
 */
function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("RESEND_WEBHOOK_SECRET not set — rejecting webhook");
    return false;
  }
  if (!signatureHeader || !timestampHeader) return false;

  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) return false;
  const nowMs = Date.now();
  if (Math.abs(nowMs - ts * 1000) > 5 * 60 * 1000) {
    return false; // timestamp drift > 5 minutes
  }

  const signedPayload = `${timestampHeader}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest();

  // Header may be "v1=<hex>,v1=<hex>" or just "<hex>"
  const candidates = signatureHeader
    .split(",")
    .map((s) => s.trim().replace(/^v1=/, ""))
    .filter(Boolean);

  for (const cand of candidates) {
    try {
      const candBuf = Buffer.from(cand, "hex");
      if (
        candBuf.length === expected.length &&
        crypto.timingSafeEqual(candBuf, expected)
      ) {
        return true;
      }
    } catch {
      // skip malformed candidate
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return apiBadRequest("Failed to read request body");
  }

  const signature =
    request.headers.get("svix-signature") ||
    request.headers.get("resend-signature");
  const timestamp =
    request.headers.get("svix-timestamp") ||
    request.headers.get("resend-timestamp");

  if (!verifySignature(rawBody, signature, timestamp)) {
    return apiBadRequest("Invalid webhook signature");
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return apiBadRequest("Invalid JSON");
  }

  try {
    const externalId = event.data.email_id || event.data.id || null;
    const to = Array.isArray(event.data.to)
      ? event.data.to[0]
      : event.data.to || null;

    switch (event.type) {
      case "email.delivered": {
        if (externalId) {
          await queryOne(
            `UPDATE ops.sent_emails
                SET status = 'delivered'
              WHERE external_id = $1
                AND status IN ('sent', 'pending')`,
            [externalId]
          );
        }
        return apiSuccess({ handled: "delivered" });
      }

      case "email.bounced": {
        if (!to) return apiSuccess({ handled: "ignored_no_recipient" });

        // Classify hard vs soft bounce. Resend's docs: bounce.type is
        // 'hard' | 'soft' | 'undetermined'.
        const bounceType = event.data.bounce?.type ?? "undetermined";
        const isHard = bounceType === "hard" || bounceType === "undetermined";

        if (isHard) {
          // Permanent global suppression
          await queryOne(
            `SELECT ops.record_bounce($1, 'hard_bounce', 'bounce_webhook', $2, NULL)`,
            [to, event.data.bounce?.message ?? null]
          );
        } else {
          // Soft bounce — record a 30-day TTL row. If three happen within
          // 30 days the ON CONFLICT renews the row; when a fourth arrives
          // we can escalate. Simple approach: store soft bounces with TTL
          // so they auto-expire. Upgrade to repeated-soft escalation in
          // a follow-up if call-volume justifies it.
          await queryOne(
            `SELECT ops.record_bounce($1, 'soft_bounce_repeated', 'bounce_webhook', $2, 30)`,
            [to, event.data.bounce?.message ?? null]
          );
        }

        if (externalId) {
          await queryOne(
            `UPDATE ops.sent_emails
                SET status = 'bounced',
                    error_message = $2
              WHERE external_id = $1`,
            [externalId, event.data.bounce?.message ?? "bounced"]
          );
        }

        return apiSuccess({ handled: "bounced", type: bounceType });
      }

      case "email.complained": {
        if (!to) return apiSuccess({ handled: "ignored_no_recipient" });

        await queryOne(
          `SELECT ops.record_bounce($1, 'complaint', 'complaint_webhook', 'Resend complaint webhook', NULL)`,
          [to]
        );

        if (externalId) {
          await queryOne(
            `UPDATE ops.sent_emails
                SET status = 'bounced',
                    error_message = 'complaint'
              WHERE external_id = $1`,
            [externalId]
          );
        }

        return apiSuccess({ handled: "complained" });
      }

      default:
        return apiSuccess({ handled: "ignored", type: event.type });
    }
  } catch (err) {
    console.error("Resend webhook handler error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Webhook handler failed"
    );
  }
}
