import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne, execute } from "@/lib/db";

/**
 * GET /api/admin/trapper-reports
 * List trapper report submissions with stats
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "all";
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Build status filter
    const statusFilter =
      status === "all"
        ? ""
        : "WHERE s.extraction_status = $1";
    const params = status === "all" ? [] : [status];

    // Get submissions with item counts
    const submissions = await queryRows(
      `
      SELECT
        s.submission_id::text,
        s.reporter_email,
        s.reporter_person_id::text,
        s.reporter_match_confidence,
        s.content_type,
        s.received_at,
        s.extraction_status,
        s.extracted_at,
        s.reviewed_by,
        s.reviewed_at,
        s.created_at,
        SUBSTRING(s.raw_content, 1, 300) as content_preview,
        -- Reporter name if matched
        p.display_name as reporter_name,
        -- Item counts
        COUNT(i.item_id) as total_items,
        COUNT(i.item_id) FILTER (WHERE i.review_status = 'pending') as pending_items,
        COUNT(i.item_id) FILTER (WHERE i.review_status = 'approved') as approved_items,
        COUNT(i.item_id) FILTER (WHERE i.review_status = 'rejected') as rejected_items,
        COUNT(i.item_id) FILTER (WHERE i.committed_at IS NOT NULL) as committed_items
      FROM ops.trapper_report_submissions s
      LEFT JOIN sot.people p ON p.person_id = s.reporter_person_id
      LEFT JOIN ops.trapper_report_items i ON i.submission_id = s.submission_id
      ${statusFilter}
      GROUP BY s.submission_id, p.display_name
      ORDER BY s.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      params
    );

    // Get stats
    const stats = await queryOne<{
      pending: string;
      extracting: string;
      extracted: string;
      reviewed: string;
      committed: string;
      failed: string;
      total: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE extraction_status = 'pending') as pending,
        COUNT(*) FILTER (WHERE extraction_status = 'extracting') as extracting,
        COUNT(*) FILTER (WHERE extraction_status = 'extracted') as extracted,
        COUNT(*) FILTER (WHERE extraction_status = 'reviewed') as reviewed,
        COUNT(*) FILTER (WHERE extraction_status = 'committed') as committed,
        COUNT(*) FILTER (WHERE extraction_status = 'failed') as failed,
        COUNT(*) as total
      FROM ops.trapper_report_submissions
      `
    );

    return NextResponse.json({
      submissions,
      stats: stats
        ? {
            pending: parseInt(stats.pending),
            extracting: parseInt(stats.extracting),
            extracted: parseInt(stats.extracted),
            reviewed: parseInt(stats.reviewed),
            committed: parseInt(stats.committed),
            failed: parseInt(stats.failed),
            total: parseInt(stats.total),
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching trapper reports:", error);
    return NextResponse.json(
      { error: "Failed to fetch trapper reports" },
      { status: 500 }
    );
  }
}

interface StructuredData {
  cats_trapped?: number | null;
  cats_remaining?: number | null;
  status_update?: string | null;
  hold_reason?: string | null;
}

/**
 * POST /api/admin/trapper-reports
 * Submit a new trapper report for processing
 *
 * Optional structured data for higher confidence:
 * - reporter_person_id: Pre-selected reporter (100% confidence)
 * - request_id: Pre-selected request (100% confidence)
 * - structured_data: { cats_trapped, cats_remaining, status_update, hold_reason }
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      reporter_email,
      reporter_person_id,
      request_id,
      structured_data,
      content,
      content_type = "email"
    } = body as {
      reporter_email?: string;
      reporter_person_id?: string;
      request_id?: string;
      structured_data?: StructuredData;
      content: string;
      content_type?: string;
    };

    if (!content || content.trim().length < 10) {
      return NextResponse.json(
        { error: "Content is required and must be at least 10 characters" },
        { status: 400 }
      );
    }

    // Validate content_type - must match CHECK constraint in MIG_566
    const validTypes = ["email", "form", "sms", "note"];
    if (!validTypes.includes(content_type)) {
      return NextResponse.json(
        { error: `Invalid content_type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Insert submission with optional pre-filled reporter
    const result = await queryOne<{ submission_id: string }>(
      `
      INSERT INTO ops.trapper_report_submissions (
        reporter_email,
        reporter_person_id,
        reporter_match_confidence,
        raw_content,
        content_type,
        source_system,
        ai_extraction
      ) VALUES ($1, $2, $3, $4, $5, 'web_ui', $6)
      RETURNING submission_id::text
      `,
      [
        reporter_email || null,
        reporter_person_id || null,
        reporter_person_id ? 1.0 : null, // 100% confidence if pre-selected
        content.trim(),
        content_type,
        // Store structured data in ai_extraction.manual for later use
        structured_data ? JSON.stringify({ manual: structured_data }) : null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create submission" },
        { status: 500 }
      );
    }

    const submissionId = result.submission_id;
    let itemsCreated = 0;

    // If request_id and structured_data provided, create items immediately with 100% confidence
    if (request_id && structured_data) {
      // Get request details for the items
      const requestDetails = await queryOne<{
        place_id: string;
        formatted_address: string;
        status: string;
      }>(
        `SELECT r.place_id::text, p.formatted_address, r.status
         FROM ops.requests r
         LEFT JOIN sot.places p ON p.place_id = r.place_id
         WHERE r.request_id = $1`,
        [request_id]
      );

      // Create status update item if status provided
      if (structured_data.status_update) {
        await execute(
          `INSERT INTO ops.trapper_report_items (
            submission_id, item_type,
            target_entity_type, target_entity_id, match_confidence,
            extracted_data, review_status
          ) VALUES ($1, 'request_status', 'request', $2, 1.0, $3, 'approved')`,
          [
            submissionId,
            request_id,
            JSON.stringify({
              status: structured_data.status_update,
              hold_reason: structured_data.hold_reason,
              source: 'manual_entry',
            }),
          ]
        );
        itemsCreated++;
      }

      // Create colony estimate if numbers provided
      if (structured_data.cats_trapped !== null || structured_data.cats_remaining !== null) {
        await execute(
          `INSERT INTO ops.trapper_report_items (
            submission_id, item_type,
            target_entity_type, target_entity_id, match_confidence,
            extracted_data, review_status
          ) VALUES ($1, 'colony_estimate', 'place', $2, 1.0, $3, 'approved')`,
          [
            submissionId,
            requestDetails?.place_id || null,
            JSON.stringify({
              cats_trapped: structured_data.cats_trapped !== null ? { total: structured_data.cats_trapped } : null,
              cats_remaining: structured_data.cats_remaining !== null ? { min: structured_data.cats_remaining, max: structured_data.cats_remaining } : null,
              observation_date: new Date().toISOString().split("T")[0],
              source: 'manual_trapper_report',
            }),
          ]
        );
        itemsCreated++;
      }
    }

    return NextResponse.json({
      success: true,
      submission_id: submissionId,
      items_created: itemsCreated,
      message: itemsCreated > 0
        ? `Report submitted with ${itemsCreated} pre-approved item(s). Run extraction for additional data.`
        : "Report submitted. Run extraction to process.",
    });
  } catch (error) {
    console.error("Error creating trapper report:", error);
    return NextResponse.json(
      { error: "Failed to create trapper report" },
      { status: 500 }
    );
  }
}
