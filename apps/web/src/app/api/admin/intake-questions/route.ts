import { NextRequest } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";

interface IntakeQuestion {
  question_id: string;
  question_key: string;
  question_type: string;
  question_text: string;
  help_text: string | null;
  is_required: boolean;
  is_active: boolean;
  is_custom: boolean;
  display_order: number;
  step_name: string;
  show_condition: Record<string, unknown> | null;
  options: Array<{
    option_id?: string;
    value: string;
    label: string;
    description?: string;
    showWarning?: boolean;
    warningText?: string;
  }>;
}

// GET - Fetch all questions with options
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const step = searchParams.get("step");
  const includeInactive = searchParams.get("include_inactive") === "true";

  try {
    const questions = await queryRows<IntakeQuestion>(`
      SELECT
        q.question_id,
        q.question_key,
        q.question_type,
        q.question_text,
        q.help_text,
        q.is_required,
        q.is_active,
        q.is_custom,
        q.display_order,
        q.step_name,
        q.show_condition,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'option_id', o.option_id,
              'value', o.option_value,
              'label', o.option_label,
              'description', o.option_description,
              'showWarning', o.show_warning,
              'warningText', o.warning_text
            ) ORDER BY o.display_order
          ) FILTER (WHERE o.option_id IS NOT NULL),
          '[]'::jsonb
        ) as options
      FROM ops.intake_questions q
      LEFT JOIN ops.intake_question_options o ON o.question_id = q.question_id
      WHERE ($1::text IS NULL OR q.step_name = $1)
        AND ($2::boolean OR q.is_active = TRUE)
      GROUP BY q.question_id
      ORDER BY q.step_name, q.display_order
    `, [step, includeInactive]);

    return apiSuccess({ questions });
  } catch (err) {
    console.error("Error fetching intake questions:", err);
    return apiServerError("Failed to fetch questions");
  }
}

// POST - Create a new custom question
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      question_key,
      question_type,
      question_text,
      help_text,
      is_required,
      display_order,
      step_name,
      show_condition,
      options,
    } = body;

    if (!question_key || !question_text || !step_name) {
      return apiBadRequest("question_key, question_text, and step_name are required");
    }

    // Create the question
    const question = await queryOne<{ question_id: string }>(`
      INSERT INTO ops.intake_questions (
        question_key, question_type, question_text, help_text,
        is_required, display_order, step_name, show_condition, is_custom
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
      RETURNING question_id
    `, [
      question_key,
      question_type || "text",
      question_text,
      help_text || null,
      is_required ?? false,
      display_order ?? 999,
      step_name,
      show_condition ? JSON.stringify(show_condition) : null,
    ]);

    if (!question) {
      return apiServerError("Failed to create question");
    }

    // Add options if provided
    if (options && Array.isArray(options) && options.length > 0) {
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        await execute(`
          INSERT INTO ops.intake_question_options (
            question_id, option_value, option_label, option_description, display_order
          ) VALUES ($1, $2, $3, $4, $5)
        `, [question.question_id, opt.value, opt.label, opt.description || null, i + 1]);
      }
    }

    return apiSuccess({ success: true, question_id: question.question_id });
  } catch (err) {
    console.error("Error creating intake question:", err);
    return apiServerError("Failed to create question");
  }
}

// PUT - Update a question or its options
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { question_id, question_text, help_text, is_active, display_order, options } = body;

    if (!question_id) {
      return apiBadRequest("question_id is required");
    }

    // Update question
    await execute(`
      UPDATE ops.intake_questions
      SET
        question_text = COALESCE($2, question_text),
        help_text = COALESCE($3, help_text),
        is_active = COALESCE($4, is_active),
        display_order = COALESCE($5, display_order),
        updated_at = NOW()
      WHERE question_id = $1
    `, [question_id, question_text, help_text, is_active, display_order]);

    // Update options if provided
    if (options && Array.isArray(options)) {
      for (const opt of options) {
        if (opt.option_id) {
          // Update existing option
          await execute(`
            UPDATE ops.intake_question_options
            SET
              option_label = COALESCE($2, option_label),
              option_description = COALESCE($3, option_description),
              show_warning = COALESCE($4, show_warning),
              warning_text = COALESCE($5, warning_text)
            WHERE option_id = $1
          `, [opt.option_id, opt.label, opt.description, opt.showWarning, opt.warningText]);
        } else if (opt.value && opt.label) {
          // Add new option
          await execute(`
            INSERT INTO ops.intake_question_options (
              question_id, option_value, option_label, option_description, display_order
            ) VALUES ($1, $2, $3, $4, $5)
          `, [question_id, opt.value, opt.label, opt.description || null, opt.displayOrder || 999]);
        }
      }
    }

    return apiSuccess({ success: true });
  } catch (err) {
    console.error("Error updating intake question:", err);
    return apiServerError("Failed to update question");
  }
}

// DELETE - Delete a custom question (only custom questions can be deleted)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const question_id = searchParams.get("id");

  if (!question_id) {
    return apiBadRequest("Question ID required");
  }

  try {
    // Soft-delete custom questions (set inactive instead of removing)
    const result = await execute(`
      UPDATE ops.intake_questions
      SET is_active = FALSE, updated_at = NOW()
      WHERE question_id = $1 AND is_custom = TRUE AND is_active = TRUE
    `, [question_id]);

    if (result.rowCount === 0) {
      return apiNotFound("Question", question_id);
    }

    return apiSuccess({ success: true });
  } catch (err) {
    console.error("Error deleting intake question:", err);
    return apiServerError("Failed to delete question");
  }
}
