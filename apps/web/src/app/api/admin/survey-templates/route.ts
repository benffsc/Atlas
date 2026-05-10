import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiBadRequest, apiServerError } from "@/lib/api-response";

/**
 * GET /api/admin/survey-templates — List all survey templates (admin only)
 * POST /api/admin/survey-templates — Create new survey template (admin only)
 */

interface SurveyTemplate {
  template_id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  thank_you_title: string;
  thank_you_message: string;
  target_entity: string;
  questions: unknown[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiError("Authentication required", 401);
  if (session.auth_role !== "admin") return apiError("Admin access required", 403);

  try {
    const templates = await queryRows<SurveyTemplate>(
      `SELECT * FROM ops.survey_templates ORDER BY created_at DESC`
    );
    return apiSuccess({ templates });
  } catch (error) {
    console.error("[SURVEY-TEMPLATES] List error:", error);
    return apiServerError("Failed to list survey templates");
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return apiError("Authentication required", 401);
  if (session.auth_role !== "admin") return apiError("Admin access required", 403);

  try {
    const body = await request.json();
    const { slug, title, subtitle, thank_you_title, thank_you_message, target_entity, questions } = body;

    if (!slug || !title) return apiBadRequest("slug and title are required");
    if (!questions || !Array.isArray(questions)) return apiBadRequest("questions must be an array");

    const template = await queryOne<SurveyTemplate>(
      `INSERT INTO ops.survey_templates (slug, title, subtitle, thank_you_title, thank_you_message, target_entity, questions)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [
        slug,
        title,
        subtitle || null,
        thank_you_title || "Thank you!",
        thank_you_message || "Your response has been recorded.",
        target_entity || "custom",
        JSON.stringify(questions),
      ]
    );

    return apiSuccess({ template });
  } catch (error) {
    console.error("[SURVEY-TEMPLATES] Create error:", error);
    return apiServerError("Failed to create survey template");
  }
}
