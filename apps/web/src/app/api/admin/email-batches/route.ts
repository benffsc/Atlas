import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { queryRows, queryOne, query } from "@/lib/db";

interface EmailBatch {
  batch_id: string;
  batch_type: string;
  recipient_email: string;
  recipient_name: string | null;
  recipient_person_id: string | null;
  outlook_account_id: string | null;
  subject: string;
  body_html: string;
  status: string;
  created_by: string;
  created_at: string;
  sent_at: string | null;
  from_email?: string;
  created_by_name?: string;
  request_count?: number;
}

interface ReadyRequest {
  request_id: string;
  source_record_id: string;
  email_summary: string;
  requester_name: string;
  requester_email: string;
  formatted_address: string;
  estimated_cat_count: number | null;
  status: string;
  created_at: string;
}

/**
 * GET /api/admin/email-batches
 *
 * List email batches. Filter by status or get ready-to-email requests.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin", "staff"]);

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode"); // 'batches' or 'ready-requests'
    const status = searchParams.get("status");
    const recipientPersonId = searchParams.get("recipient_person_id");

    if (mode === "ready-requests") {
      // Get requests marked ready to email, grouped by trapper
      const requests = await queryRows<ReadyRequest & { trapper_person_id: string; trapper_name: string; trapper_email: string }>(`
        SELECT
          r.request_id,
          r.source_record_id,
          r.email_summary,
          r.estimated_cat_count,
          r.status,
          r.created_at,
          p_req.display_name AS requester_name,
          (SELECT pi.id_value_norm FROM sot.person_identifiers pi
           WHERE pi.person_id = r.requester_person_id AND pi.identifier_type = 'email' LIMIT 1) AS requester_email,
          pl.formatted_address,
          rta.trapper_person_id,
          p_trap.display_name AS trapper_name,
          (SELECT pi.id_value_norm FROM sot.person_identifiers pi
           WHERE pi.person_id = rta.trapper_person_id AND pi.identifier_type = 'email' LIMIT 1) AS trapper_email
        FROM ops.requests r
        LEFT JOIN sot.people p_req ON p_req.person_id = r.requester_person_id
        LEFT JOIN sot.places pl ON pl.place_id = r.place_id
        LEFT JOIN ops.request_trapper_assignments rta ON rta.request_id = r.request_id AND rta.is_current = TRUE
        LEFT JOIN sot.people p_trap ON p_trap.person_id = rta.trapper_person_id
        WHERE r.ready_to_email = TRUE
          AND r.email_batch_id IS NULL
        ORDER BY rta.trapper_person_id, r.created_at
      `);

      // Group by trapper
      const groupedByTrapper: Record<string, {
        trapper_person_id: string;
        trapper_name: string;
        trapper_email: string;
        requests: ReadyRequest[];
      }> = {};

      for (const req of requests) {
        const key = req.trapper_person_id || "unassigned";
        if (!groupedByTrapper[key]) {
          groupedByTrapper[key] = {
            trapper_person_id: req.trapper_person_id,
            trapper_name: req.trapper_name || "Unassigned",
            trapper_email: req.trapper_email || "",
            requests: [],
          };
        }
        groupedByTrapper[key].requests.push({
          request_id: req.request_id,
          source_record_id: req.source_record_id,
          email_summary: req.email_summary,
          requester_name: req.requester_name,
          requester_email: req.requester_email,
          formatted_address: req.formatted_address,
          estimated_cat_count: req.estimated_cat_count,
          status: req.status,
          created_at: req.created_at,
        });
      }

      return NextResponse.json({
        ready_requests: Object.values(groupedByTrapper),
        total_count: requests.length,
      });
    }

    // List batches
    let whereClause = "";
    const params: (string | number)[] = [];

    if (status && status !== "all") {
      whereClause = "WHERE eb.status = $1";
      params.push(status);
    }

    const batches = await queryRows<EmailBatch>(`
      SELECT
        eb.*,
        oa.email AS from_email,
        s.display_name AS created_by_name,
        (SELECT COUNT(*) FROM ops.requests r WHERE r.email_batch_id = eb.batch_id) AS request_count
      FROM ops.email_batches eb
      LEFT JOIN ops.outlook_email_accounts oa ON oa.account_id = eb.outlook_account_id
      LEFT JOIN ops.staff s ON s.staff_id = eb.created_by
      ${whereClause}
      ORDER BY eb.created_at DESC
      LIMIT 100
    `, params);

    // Get counts
    const counts = await queryOne<{
      draft: number;
      sent: number;
      failed: number;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft') AS draft,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM ops.email_batches
    `);

    return NextResponse.json({
      batches,
      counts,
    });
  } catch (error) {
    console.error("Get email batches error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json({ error: authError.message }, { status: authError.statusCode });
    }

    return NextResponse.json({ error: "Failed to get email batches" }, { status: 500 });
  }
}

/**
 * POST /api/admin/email-batches
 *
 * Create a new email batch from ready-to-email requests.
 */
export async function POST(request: NextRequest) {
  try {
    const staff = await requireRole(request, ["admin", "staff"]);

    const body = await request.json();
    const {
      batch_type = "trapper_assignments",
      recipient_person_id,
      recipient_email,
      recipient_name,
      request_ids, // Array of request IDs to include
      outlook_account_id,
      subject,
      custom_intro, // Optional custom intro text
    } = body;

    // Validate
    if (!recipient_email || !recipient_email.includes("@")) {
      return NextResponse.json({ error: "Valid recipient email is required" }, { status: 400 });
    }

    if (!request_ids || !Array.isArray(request_ids) || request_ids.length === 0) {
      return NextResponse.json({ error: "At least one request is required" }, { status: 400 });
    }

    // Fetch the requests with their summaries
    const requests = await queryRows<{
      request_id: string;
      source_record_id: string;
      email_summary: string;
      requester_name: string;
      requester_email: string;
      requester_phone: string;
      formatted_address: string;
      estimated_cat_count: number | null;
      status: string;
    }>(`
      SELECT
        r.request_id,
        r.source_record_id,
        r.email_summary,
        r.estimated_cat_count,
        r.status,
        p.display_name AS requester_name,
        (SELECT pi.id_value_norm FROM sot.person_identifiers pi
         WHERE pi.person_id = r.requester_person_id AND pi.identifier_type = 'email' LIMIT 1) AS requester_email,
        (SELECT pi.id_value_norm FROM sot.person_identifiers pi
         WHERE pi.person_id = r.requester_person_id AND pi.identifier_type = 'phone' LIMIT 1) AS requester_phone,
        pl.formatted_address
      FROM ops.requests r
      LEFT JOIN sot.people p ON p.person_id = r.requester_person_id
      LEFT JOIN sot.places pl ON pl.place_id = r.place_id
      WHERE r.request_id = ANY($1)
    `, [request_ids]);

    if (requests.length === 0) {
      return NextResponse.json({ error: "No valid requests found" }, { status: 400 });
    }

    // Generate subject if not provided
    const finalSubject = subject || `${requests.length} Assignment${requests.length > 1 ? "s" : ""} Ready for Trapping`;

    // Build combined HTML body
    const bodyHtml = buildBatchEmailHtml(requests, custom_intro);

    // Get default outlook account for trapper category if not specified
    let finalOutlookAccountId = outlook_account_id;
    if (!finalOutlookAccountId) {
      const category = await queryOne<{ default_outlook_account_id: string | null }>(`
        SELECT default_outlook_account_id FROM ops.email_categories WHERE category_key = 'trapper'
      `);
      finalOutlookAccountId = category?.default_outlook_account_id;
    }

    // Create the batch
    const result = await queryOne<{ batch_id: string }>(`
      INSERT INTO ops.email_batches (
        batch_type, recipient_email, recipient_name, recipient_person_id,
        outlook_account_id, subject, body_html, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)
      RETURNING batch_id
    `, [
      batch_type,
      recipient_email,
      recipient_name || null,
      recipient_person_id || null,
      finalOutlookAccountId || null,
      finalSubject,
      bodyHtml,
      staff.staff_id,
    ]);

    const batchId = result?.batch_id;

    // Link requests to the batch
    await query(`
      UPDATE ops.requests
      SET email_batch_id = $1, updated_at = NOW()
      WHERE request_id = ANY($2)
    `, [batchId, request_ids]);

    return NextResponse.json({
      success: true,
      batch_id: batchId,
      request_count: requests.length,
    });
  } catch (error) {
    console.error("Create email batch error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json({ error: authError.message }, { status: authError.statusCode });
    }

    return NextResponse.json({ error: "Failed to create email batch" }, { status: 500 });
  }
}

/**
 * Build combined HTML for batch email with request cards
 */
function buildBatchEmailHtml(
  requests: {
    request_id: string;
    source_record_id: string;
    email_summary: string;
    requester_name: string;
    requester_email: string;
    requester_phone: string;
    formatted_address: string;
    estimated_cat_count: number | null;
  }[],
  customIntro?: string
): string {
  const intro = customIntro || `Hi,\n\nHere are ${requests.length} assignment${requests.length > 1 ? "s" : ""} ready for your attention:`;

  const requestCards = requests.map((req, idx) => `
    <div style="margin: 16px 0; padding: 16px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa;">
      <div style="font-weight: bold; font-size: 14px; color: #333; margin-bottom: 8px;">
        Assignment ${idx + 1}: ${req.formatted_address || "No address"}
      </div>
      <div style="font-size: 13px; color: #555; margin-bottom: 8px;">
        <strong>Contact:</strong> ${req.requester_name || "Unknown"}
        ${req.requester_email ? ` • ${req.requester_email}` : ""}
        ${req.requester_phone ? ` • ${req.requester_phone}` : ""}
      </div>
      ${req.estimated_cat_count ? `<div style="font-size: 13px; color: #555; margin-bottom: 8px;"><strong>Cats:</strong> ~${req.estimated_cat_count}</div>` : ""}
      <div style="font-size: 13px; color: #333; white-space: pre-wrap;">${req.email_summary || "No summary provided."}</div>
      <div style="font-size: 11px; color: #888; margin-top: 8px;">Request ID: ${req.source_record_id || req.request_id}</div>
    </div>
  `).join("");

  return `
    <div style="font-family: sans-serif; padding: 20px; color: #222; line-height: 1.55; max-width: 600px;">
      <p style="white-space: pre-wrap;">${intro}</p>

      ${requestCards}

      <p style="margin-top: 24px;">Please review and let me know if you have any questions or need additional information.</p>

      <p>Thanks,<br>Ben</p>

      <div style="margin-top: 28px; border-top: 1px solid #ddd; padding-top: 16px; font-size: 13px; color: #666;">
        <strong>Ben - Trapping Coordinator</strong><br>
        Forgotten Felines of Sonoma County<br>
        ben@forgottenfelines.com
      </div>
    </div>
  `;
}
