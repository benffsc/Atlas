import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface CommunicationLog {
  log_id: string;
  submission_id: string;
  contact_method: string;
  contact_result: string;
  notes: string | null;
  contacted_at: string;
  contacted_by: string | null;
  entry_kind?: string;
  // Staff info from journal entries
  created_by_staff_name?: string | null;
  created_by_staff_role?: string | null;
}

// GET - Fetch all communications for a submission
// Now unified from journal_entries (primary) and legacy communication_logs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Submission ID is required" },
      { status: 400 }
    );
  }

  try {
    // Fetch from journal entries (unified communication log)
    // This includes both contact_attempt and note entries
    // Using V2 column names: id, body, entry_kind, primary_submission_id, occurred_at
    const journalLogs = await queryRows<CommunicationLog>(`
      SELECT
        je.id::text AS log_id,
        je.primary_submission_id AS submission_id,
        je.contact_method,
        je.contact_result,
        je.body AS notes,
        COALESCE(je.occurred_at, je.created_at) AS contacted_at,
        je.created_by AS contacted_by,
        je.entry_kind AS entry_kind,
        s.display_name AS created_by_staff_name,
        s.role AS created_by_staff_role
      FROM ops.journal_entries je
      LEFT JOIN ops.staff s ON s.staff_id = je.created_by_staff_id
      WHERE je.primary_submission_id = $1
      ORDER BY COALESCE(je.occurred_at, je.created_at) DESC
    `, [id]);

    // Also fetch from legacy communication_logs table for backwards compatibility
    // These will be displayed along with journal entries
    const legacyLogs = await queryRows<CommunicationLog>(`
      SELECT
        log_id,
        submission_id,
        contact_method,
        contact_result,
        notes,
        contacted_at,
        contacted_by,
        'contact_attempt' AS entry_kind,
        NULL AS created_by_staff_name,
        NULL AS created_by_staff_role
      FROM ops.communication_logs
      WHERE submission_id = $1
      ORDER BY contacted_at DESC
    `, [id]);

    // Merge and dedupe - journal entries take precedence
    // Legacy logs from before journal integration are included
    const journalLogIds = new Set(journalLogs.map(l => l.log_id));
    const mergedLogs = [
      ...journalLogs,
      // Only include legacy logs that don't have a matching journal entry
      // (legacy logs won't have UUID format log_ids)
      ...legacyLogs.filter(l => !journalLogIds.has(l.log_id))
    ].sort((a, b) =>
      new Date(b.contacted_at).getTime() - new Date(a.contacted_at).getTime()
    );

    return NextResponse.json({ logs: mergedLogs });
  } catch (err) {
    console.error("Error fetching communication logs:", err);
    return NextResponse.json(
      { error: "Failed to fetch communication logs" },
      { status: 500 }
    );
  }
}

// POST - Add a new communication log (now writes to journal_entries)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Submission ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { contact_method, contact_result, notes, contacted_by, is_journal_only } = body;

    // For journal-only entries (internal notes), we don't need contact method/result
    if (!is_journal_only && (!contact_method || !contact_result)) {
      return NextResponse.json(
        { error: "contact_method and contact_result are required for contact logs" },
        { status: 400 }
      );
    }

    // Validate contact_method (if provided)
    const validMethods = ["phone", "email", "in_person", "text", "voicemail"];
    if (contact_method && !validMethods.includes(contact_method)) {
      return NextResponse.json(
        { error: `Invalid contact_method. Must be one of: ${validMethods.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate contact_result (if provided)
    const validResults = ["answered", "no_answer", "left_voicemail", "sent", "spoke_in_person", "scheduled", "other"];
    if (contact_result && !validResults.includes(contact_result)) {
      return NextResponse.json(
        { error: `Invalid contact_result. Must be one of: ${validResults.join(", ")}` },
        { status: 400 }
      );
    }

    // Look up staff_id from display name if contacted_by is provided
    let staffId: string | null = null;
    if (contacted_by) {
      const staffResult = await queryOne<{ staff_id: string }>(`
        SELECT staff_id FROM ops.staff
        WHERE display_name = $1
        LIMIT 1
      `, [contacted_by]);
      staffId = staffResult?.staff_id || null;
    }

    // Determine entry_kind: "note" for journal-only, "contact_attempt" for contact logs
    const entryKind = is_journal_only ? "note" : "contact_attempt";

    // Create journal entry (unified communication log)
    // Using V2 column names: body, entry_kind, primary_submission_id, occurred_at
    const result = await queryOne<{ id: string }>(`
      INSERT INTO ops.journal_entries (
        body,
        entry_kind,
        primary_submission_id,
        contact_method,
        contact_result,
        created_by,
        created_by_staff_id,
        occurred_at,
        tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), '{}')
      RETURNING id
    `, [
      notes || "",
      entryKind,
      id,
      is_journal_only ? null : contact_method,
      is_journal_only ? null : contact_result,
      contacted_by || null,
      staffId
    ]);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create communication log" },
        { status: 500 }
      );
    }

    // If this is a contact_attempt, update denormalized contact fields on submission
    // (The journal API does this automatically, but we're calling the journal table directly)
    if (!is_journal_only) {
      await queryOne(`
        UPDATE ops.intake_submissions
        SET
          last_contacted_at = NOW(),
          last_contact_method = $2,
          contact_attempt_count = COALESCE(contact_attempt_count, 0) + 1,
          updated_at = NOW()
        WHERE submission_id = $1
      `, [id, contact_method]);
    }

    return NextResponse.json({
      success: true,
      log_id: result.id,
    });
  } catch (err) {
    console.error("Error creating communication log:", err);
    return NextResponse.json(
      { error: "Failed to create communication log" },
      { status: 500 }
    );
  }
}
