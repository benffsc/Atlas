import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface SourceConfidence {
  source_system: string;
  confidence_score: number;
  description: string | null;
}

// Get all source confidence scores
export async function GET() {
  try {
    const scores = await queryRows<SourceConfidence>(
      `SELECT source_system, confidence_score, description
       FROM trapper.source_confidence
       ORDER BY confidence_score DESC`
    );

    return NextResponse.json({ scores });
  } catch (error) {
    console.error("Error fetching source confidence:", error);
    // Return empty if table doesn't exist
    if (error instanceof Error && error.message.includes("does not exist")) {
      return NextResponse.json({
        scores: [],
        note: "Migration MIG_251 needs to be applied",
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch source confidence scores" },
      { status: 500 }
    );
  }
}

// Update or add a source confidence score
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source_system, confidence_score, description } = body;

    if (!source_system) {
      return NextResponse.json(
        { error: "source_system is required" },
        { status: 400 }
      );
    }

    if (typeof confidence_score !== "number" || confidence_score < 0 || confidence_score > 1) {
      return NextResponse.json(
        { error: "confidence_score must be a number between 0 and 1" },
        { status: 400 }
      );
    }

    // Upsert the score
    await queryOne(
      `INSERT INTO trapper.source_confidence (source_system, confidence_score, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_system) DO UPDATE SET
         confidence_score = $2,
         description = $3`,
      [source_system, confidence_score, description || null]
    );

    return NextResponse.json({
      success: true,
      source_system,
      confidence_score,
    });
  } catch (error) {
    console.error("Error updating source confidence:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update" },
      { status: 500 }
    );
  }
}

// Delete a source confidence score
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source_system = searchParams.get("source_system");

    if (!source_system) {
      return NextResponse.json(
        { error: "source_system is required" },
        { status: 400 }
      );
    }

    // Don't allow deleting core sources
    const coreSource = ["web_intake", "atlas_ui", "airtable", "clinichq"].includes(source_system);
    if (coreSource) {
      return NextResponse.json(
        { error: "Cannot delete core source systems" },
        { status: 400 }
      );
    }

    await queryOne(
      `DELETE FROM trapper.source_confidence WHERE source_system = $1`,
      [source_system]
    );

    return NextResponse.json({ success: true, deleted: source_system });
  } catch (error) {
    console.error("Error deleting source confidence:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete" },
      { status: 500 }
    );
  }
}
