import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * POST /api/tippy/feedback
 * Submit feedback about Tippy's response for data accuracy improvement
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated staff
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      tippy_message,
      user_correction,
      conversation_id,
      conversation_context,
      entity_type,
      entity_id,
      feedback_type,
    } = body;

    // Validate required fields
    if (!tippy_message || !user_correction || !feedback_type) {
      return NextResponse.json(
        { error: "Missing required fields: tippy_message, user_correction, feedback_type" },
        { status: 400 }
      );
    }

    // Validate entity_id as UUID if provided; if not valid UUID, fold into correction text
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let validEntityId: string | null = null;
    let correctionText = user_correction;
    if (entity_id && typeof entity_id === "string") {
      if (UUID_REGEX.test(entity_id)) {
        validEntityId = entity_id;
      } else {
        // Non-UUID identifier (e.g., address or name) — prepend to correction text
        correctionText = `[Affected record: ${entity_id}] ${user_correction}`;
      }
    }

    // Validate feedback_type
    const validTypes = [
      "incorrect_count",
      "incorrect_status",
      "incorrect_location",
      "incorrect_person",
      "outdated_info",
      "missing_data",
      "missing_capability",
      "other",
    ];
    if (!validTypes.includes(feedback_type)) {
      return NextResponse.json(
        { error: `Invalid feedback_type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate entity_type if provided
    if (entity_type) {
      const validEntityTypes = ["place", "cat", "person", "request", "other"];
      if (!validEntityTypes.includes(entity_type)) {
        return NextResponse.json(
          { error: `Invalid entity_type. Must be one of: ${validEntityTypes.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Insert feedback — try with original type first, fall back to 'other'
    // if the CHECK constraint rejects newer types (missing_data, missing_capability)
    const insertParams = [
      session.staff_id,
      tippy_message,
      correctionText,
      conversation_id || null,
      conversation_context ? JSON.stringify(conversation_context) : null,
      entity_type || null,
      validEntityId,
      feedback_type,
    ];

    let feedback: { feedback_id: string; created_at: string } | null = null;
    try {
      feedback = await queryOne<{ feedback_id: string; created_at: string }>(
        `
        INSERT INTO trapper.tippy_feedback (
          staff_id, tippy_message, user_correction, conversation_id,
          conversation_context, entity_type, entity_id, feedback_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING feedback_id, created_at
        `,
        insertParams
      );
    } catch (insertError: unknown) {
      // If CHECK constraint rejects feedback_type (MIG_476 not applied), retry with 'other'
      const errMsg = insertError instanceof Error ? insertError.message : "";
      if (errMsg.includes("check") || errMsg.includes("violates") || errMsg.includes("feedback_type")) {
        insertParams[7] = "other"; // feedback_type fallback
        feedback = await queryOne<{ feedback_id: string; created_at: string }>(
          `
          INSERT INTO trapper.tippy_feedback (
            staff_id, tippy_message, user_correction, conversation_id,
            conversation_context, entity_type, entity_id, feedback_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING feedback_id, created_at
          `,
          insertParams
        );
      } else {
        throw insertError; // Re-throw non-constraint errors
      }
    }

    if (!feedback) {
      return NextResponse.json(
        { error: "Failed to insert feedback" },
        { status: 500 }
      );
    }

    // Auto-create data improvement if entity is specified
    let improvementId = null;
    if (entity_type && validEntityId) {
      const categoryMap: Record<string, string> = {
        incorrect_count: "data_correction",
        incorrect_status: "data_correction",
        incorrect_location: "data_correction",
        incorrect_person: "data_correction",
        outdated_info: "stale_data",
        missing_data: "missing_data",
        missing_capability: "other",
        other: "other",
      };

      const improvement = await queryOne<{ improvement_id: string }>(
        `
        INSERT INTO trapper.data_improvements (
          title,
          description,
          entity_type,
          entity_id,
          category,
          source,
          source_reference_id
        ) VALUES ($1, $2, $3, $4, $5, 'tippy_feedback', $6)
        RETURNING improvement_id
        `,
        [
          `Tippy feedback: ${feedback_type.replace("_", " ")}`,
          correctionText,
          entity_type,
          validEntityId,
          categoryMap[feedback_type] || "other",
          feedback.feedback_id,
        ]
      );

      if (improvement) {
        improvementId = improvement.improvement_id;

        // Link improvement back to feedback
        await query(
          `UPDATE trapper.tippy_feedback SET data_improvement_id = $1 WHERE feedback_id = $2`,
          [improvementId, feedback.feedback_id]
        );
      }
    }

    return NextResponse.json({
      success: true,
      feedback_id: feedback.feedback_id,
      data_improvement_id: improvementId,
      message: "Thank you for your feedback! It will be reviewed to improve data accuracy.",
    });
  } catch (error) {
    console.error("Tippy feedback error:", error);
    return NextResponse.json(
      { error: "Failed to submit feedback" },
      { status: 500 }
    );
  }
}
