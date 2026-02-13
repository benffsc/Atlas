import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

// GET: Retrieve classification suggestion for a request
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        r.request_id,
        r.suggested_classification,
        r.classification_confidence,
        r.classification_signals,
        r.classification_disposition,
        r.classification_suggested_at,
        r.classification_reviewed_at,
        r.classification_reviewed_by,
        r.place_id,
        p.colony_classification AS current_place_classification,
        p.authoritative_cat_count
      FROM ops.requests r
      LEFT JOIN sot.places p ON p.place_id = r.place_id
      WHERE r.request_id = $1
    `;

    const result = await queryOne<{
      request_id: string;
      suggested_classification: string | null;
      classification_confidence: number | null;
      classification_signals: Record<string, unknown> | null;
      classification_disposition: string | null;
      classification_suggested_at: string | null;
      classification_reviewed_at: string | null;
      classification_reviewed_by: string | null;
      place_id: string | null;
      current_place_classification: string | null;
      authoritative_cat_count: number | null;
    }>(sql, [id]);

    if (!result) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching classification suggestion:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to fetch classification suggestion", details: errorMessage },
      { status: 500 }
    );
  }
}

// POST: Accept, override, or dismiss a classification suggestion
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { action, override_classification, reason, authoritative_count } = body;

    if (!action || !["accept", "override", "dismiss"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'accept', 'override', or 'dismiss'" },
        { status: 400 }
      );
    }

    let resultValue: string | null = null;

    switch (action) {
      case "accept":
        const acceptResult = await queryOne<{ result: string }>(
          `SELECT ops.accept_classification_suggestion($1, $2) AS result`,
          [id, "staff"]
        );
        resultValue = acceptResult?.result || null;
        break;

      case "override":
        if (!override_classification) {
          return NextResponse.json(
            { error: "override_classification is required for override action" },
            { status: 400 }
          );
        }
        if (!reason) {
          return NextResponse.json(
            { error: "reason is required for override action" },
            { status: 400 }
          );
        }
        const overrideResult = await queryOne<{ result: string }>(
          `SELECT ops.override_classification_suggestion($1, $2, $3, $4, $5) AS result`,
          [id, override_classification, reason, "staff", authoritative_count || null]
        );
        resultValue = overrideResult?.result || null;
        break;

      case "dismiss":
        await queryOne(
          `SELECT ops.dismiss_classification_suggestion($1, $2)`,
          [id, "staff"]
        );
        resultValue = "dismissed";
        break;
    }

    // Fetch updated suggestion data
    const updatedSql = `
      SELECT
        r.suggested_classification,
        r.classification_confidence,
        r.classification_disposition,
        r.classification_reviewed_at,
        r.classification_reviewed_by,
        p.colony_classification AS current_place_classification
      FROM ops.requests r
      LEFT JOIN sot.places p ON p.place_id = r.place_id
      WHERE r.request_id = $1
    `;

    const updated = await queryOne(updatedSql, [id]);

    return NextResponse.json({
      success: true,
      action,
      result: resultValue,
      updated,
    });
  } catch (error) {
    console.error("Error processing classification suggestion:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to process classification suggestion", details: errorMessage },
      { status: 500 }
    );
  }
}
