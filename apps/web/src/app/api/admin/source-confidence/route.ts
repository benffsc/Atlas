import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

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
       FROM ops.source_confidence
       ORDER BY confidence_score DESC`
    );

    return apiSuccess({ scores });
  } catch (error) {
    console.error("Error fetching source confidence:", error);
    // Return empty if table doesn't exist
    if (error instanceof Error && error.message.includes("does not exist")) {
      return apiSuccess({
        scores: [],
        note: "Migration MIG_251 needs to be applied",
      });
    }
    return apiServerError("Failed to fetch source confidence scores");
  }
}

// Update or add a source confidence score
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source_system, confidence_score, description } = body;

    if (!source_system) {
      return apiBadRequest("source_system is required");
    }

    if (typeof confidence_score !== "number" || confidence_score < 0 || confidence_score > 1) {
      return apiBadRequest("confidence_score must be a number between 0 and 1");
    }

    // Upsert the score
    await queryOne(
      `INSERT INTO ops.source_confidence (source_system, confidence_score, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_system) DO UPDATE SET
         confidence_score = $2,
         description = $3`,
      [source_system, confidence_score, description || null]
    );

    return apiSuccess({
      source_system,
      confidence_score,
    });
  } catch (error) {
    console.error("Error updating source confidence:", error);
    return apiServerError("Failed to update source confidence");
  }
}

// Delete a source confidence score
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source_system = searchParams.get("source_system");

    if (!source_system) {
      return apiBadRequest("source_system is required");
    }

    // Don't allow deleting core sources
    const coreSource = ["web_intake", "atlas_ui", "airtable", "clinichq"].includes(source_system);
    if (coreSource) {
      return apiBadRequest("Cannot delete core source systems");
    }

    await queryOne(
      `DELETE FROM ops.source_confidence WHERE source_system = $1`,
      [source_system]
    );

    return apiSuccess({ deleted: source_system });
  } catch (error) {
    console.error("Error deleting source confidence:", error);
    return apiServerError("Failed to delete source confidence");
  }
}
