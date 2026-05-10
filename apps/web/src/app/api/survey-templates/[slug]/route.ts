import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound, apiServerError } from "@/lib/api-response";

/**
 * GET /api/survey-templates/[slug] — Public (no auth). Returns the survey
 * template definition so the generic survey page can render it.
 */

interface SurveyTemplate {
  template_id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  thank_you_title: string;
  thank_you_message: string;
  target_entity: string;
  questions: SurveyQuestion[];
}

export interface SurveyQuestion {
  id: string;
  type: "checkbox" | "radio" | "text" | "textarea" | "select" | "toggle" | "day_picker";
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  maps_to?: string;
  options?: { value: string; label: string; description?: string }[];
  show_if?: { question_id: string; value: string | string[] };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const template = await queryOne<SurveyTemplate>(
      `SELECT template_id, slug, title, subtitle, thank_you_title, thank_you_message,
              target_entity, questions
       FROM ops.survey_templates
       WHERE slug = $1 AND is_active = true`,
      [slug]
    );

    if (!template) {
      return apiNotFound("survey_template", slug);
    }

    return apiSuccess({ template });
  } catch (error) {
    console.error("[SURVEY-TEMPLATE] Error:", error);
    return apiServerError("Failed to load survey template");
  }
}
