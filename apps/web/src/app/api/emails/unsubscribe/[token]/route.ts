/**
 * GET /api/emails/unsubscribe/[token]
 *
 * Part of FFS-1181 Follow-Up Phase 5. Public, token-authenticated
 * unsubscribe endpoint. Verifies the HMAC-signed token, inserts a
 * per_flow row into ops.email_suppressions, and returns a simple HTML
 * confirmation page. Idempotent: repeat clicks show "already
 * unsubscribed".
 */

import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-tokens";
import { getFlow } from "@/lib/email-flows";
import { getOrgNameShort } from "@/lib/org-config";

function renderHtml({
  title,
  body,
  brand,
}: {
  title: string;
  body: string;
  brand: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      body {
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
        background: #f7f7f8;
        margin: 0;
        padding: 2rem 1rem;
        color: #1a1a1a;
      }
      .card {
        max-width: 520px;
        margin: 4rem auto;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        box-shadow: 0 1px 3px rgba(0,0,0,.06);
      }
      h1 { font-size: 1.25rem; margin: 0 0 1rem; }
      p { color: #4b5563; line-height: 1.5; margin: 0 0 0.75rem; }
      .brand { font-size: 0.75rem; color: #9ca3af; margin-top: 1.5rem; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      ${body}
      <div class="brand">${brand}</div>
    </div>
  </body>
</html>`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const brand = await getOrgNameShort().catch(() => "Forgotten Felines");

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return new NextResponse(
      renderHtml({
        title: "Invalid or expired link",
        body: `<p>This unsubscribe link is invalid or has expired.</p>
               <p>If you want to stop receiving emails, please reply
               to any email from us and we'll take care of it.</p>`,
        brand,
      }),
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  // Verify flow exists
  const flow = await getFlow(payload.flow_slug);
  if (!flow) {
    return new NextResponse(
      renderHtml({
        title: "Unknown email type",
        body: `<p>We couldn't find that email flow in our system.</p>`,
        brand,
      }),
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  // Idempotent insert — ON CONFLICT from MIG_3068 unique index
  try {
    await queryOne(
      `INSERT INTO ops.email_suppressions (
         email_norm, scope, flow_slug, reason, source, notes
       ) VALUES (
         LOWER(TRIM($1)), 'per_flow', $2, 'unsubscribe', 'unsubscribe_link', NULL
       )
       ON CONFLICT (email_norm, scope, COALESCE(flow_slug, '')) DO UPDATE
         SET reason = 'unsubscribe',
             source = 'unsubscribe_link',
             created_at = NOW()
       RETURNING suppression_id`,
      [payload.email, payload.flow_slug]
    );
  } catch (err) {
    console.error("unsubscribe insert error:", err);
    return new NextResponse(
      renderHtml({
        title: "Something went wrong",
        body: `<p>We couldn't process your unsubscribe just now. Please
               email us directly.</p>`,
        brand,
      }),
      { status: 500, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  return new NextResponse(
    renderHtml({
      title: "You've been unsubscribed",
      body: `<p>You'll no longer receive <strong>${flow.display_name}</strong> emails from ${brand}.</p>
             <p>This change takes effect immediately. If you change your mind,
             just reply to any past email and we'll add you back.</p>`,
      brand,
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}
