import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";

interface CommunicationLog {
  log_id: string;
  submission_id: string;
  contact_method: string;
  contact_result: string;
  notes: string | null;
  contacted_at: string;
  contacted_by: string | null;
}

// GET - Fetch all communications for a submission
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
    const logs = await queryRows<CommunicationLog>(`
      SELECT
        log_id,
        submission_id,
        contact_method,
        contact_result,
        notes,
        contacted_at,
        contacted_by
      FROM trapper.communication_logs
      WHERE submission_id = $1
      ORDER BY contacted_at DESC
    `, [id]);

    return NextResponse.json({ logs });
  } catch (err) {
    console.error("Error fetching communication logs:", err);
    return NextResponse.json(
      { error: "Failed to fetch communication logs" },
      { status: 500 }
    );
  }
}

// POST - Add a new communication log
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
    const { contact_method, contact_result, notes, contacted_by } = body;

    if (!contact_method || !contact_result) {
      return NextResponse.json(
        { error: "contact_method and contact_result are required" },
        { status: 400 }
      );
    }

    // Validate contact_method
    const validMethods = ["phone", "email", "in_person", "text", "voicemail"];
    if (!validMethods.includes(contact_method)) {
      return NextResponse.json(
        { error: `Invalid contact_method. Must be one of: ${validMethods.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate contact_result
    const validResults = ["answered", "no_answer", "left_voicemail", "sent", "spoke_in_person", "scheduled", "other"];
    if (!validResults.includes(contact_result)) {
      return NextResponse.json(
        { error: `Invalid contact_result. Must be one of: ${validResults.join(", ")}` },
        { status: 400 }
      );
    }

    // Insert the log
    const result = await queryOne<{ log_id: string }>(`
      INSERT INTO trapper.communication_logs (
        submission_id,
        contact_method,
        contact_result,
        notes,
        contacted_by
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING log_id
    `, [id, contact_method, contact_result, notes || null, contacted_by || null]);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create communication log" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      log_id: result.log_id,
    });
  } catch (err) {
    console.error("Error creating communication log:", err);
    return NextResponse.json(
      { error: "Failed to create communication log" },
      { status: 500 }
    );
  }
}
