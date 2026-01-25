import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { queryOne, query } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

interface EmailTemplate {
  template_id: string;
  template_key: string;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  body_text: string | null;
  placeholders: string[] | null;
  category_key: string | null;
  language: string;
}

/**
 * POST /api/admin/email-templates/translate
 *
 * Translate an email template to another language using AI.
 * Preserves {{placeholders}} during translation.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);

    const body = await request.json();
    const { template_id, target_language = "es", preview_only = false } = body;

    if (!template_id) {
      return NextResponse.json({ error: "template_id is required" }, { status: 400 });
    }

    // Get the source template
    const template = await queryOne<EmailTemplate>(`
      SELECT * FROM trapper.email_templates WHERE template_id = $1
    `, [template_id]);

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Check if translation already exists
    const existingKey = `${template.template_key.replace(/_en$/, "")}_${target_language}`;
    const existing = await queryOne<{ template_id: string }>(`
      SELECT template_id FROM trapper.email_templates WHERE template_key = $1
    `, [existingKey]);

    if (existing && !preview_only) {
      return NextResponse.json({
        error: `Translation already exists with key: ${existingKey}`,
        existing_template_id: existing.template_id,
      }, { status: 409 });
    }

    // Get language name for prompt
    const languageNames: Record<string, string> = {
      es: "Spanish",
      fr: "French",
      zh: "Chinese",
      vi: "Vietnamese",
      tl: "Tagalog",
    };
    const targetLanguageName = languageNames[target_language] || target_language;

    // Translate using Claude
    const translationPrompt = `You are translating an email template for a cat rescue organization (Forgotten Felines of Sonoma County).

IMPORTANT RULES:
1. Preserve all {{placeholders}} exactly as they appear - do not translate them
2. Preserve all HTML tags and structure exactly
3. Translate naturally, not word-for-word
4. Keep the same friendly, professional tone
5. Preserve any URLs exactly as they are
6. Keep phone numbers, addresses, and organization names in their original form

Translate the following to ${targetLanguageName}:

---SUBJECT---
${template.subject}

---BODY HTML---
${template.body_html}

---BODY TEXT---
${template.body_text || "(no plain text version)"}

Respond in this exact JSON format:
{
  "subject": "translated subject here",
  "body_html": "translated HTML here",
  "body_text": "translated plain text here or null"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        { role: "user", content: translationPrompt },
      ],
    });

    // Parse response
    const responseText = message.content[0].type === "text" ? message.content[0].text : "";

    // Extract JSON from response
    let translated: {
      subject: string;
      body_html: string;
      body_text: string | null;
    };

    try {
      // Try to find JSON in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      translated = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("Failed to parse translation response:", responseText);
      return NextResponse.json({ error: "Failed to parse translation response" }, { status: 500 });
    }

    // If preview only, return the translation without saving
    if (preview_only) {
      return NextResponse.json({
        preview: true,
        source_template_key: template.template_key,
        target_template_key: existingKey,
        target_language,
        translated_subject: translated.subject,
        translated_body_html: translated.body_html,
        translated_body_text: translated.body_text,
      });
    }

    // Save the translated template
    const newName = template.name.replace(/\(English[^)]*\)/i, "").trim() + ` (${targetLanguageName})`;
    const newDescription = `${targetLanguageName} translation of ${template.template_key}`;

    const result = await queryOne<{ template_id: string }>(`
      INSERT INTO trapper.email_templates (
        template_key, name, description, subject, body_html, body_text,
        placeholders, category_key, language, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
      RETURNING template_id
    `, [
      existingKey,
      newName,
      newDescription,
      translated.subject,
      translated.body_html,
      translated.body_text,
      template.placeholders,
      template.category_key,
      target_language,
    ]);

    return NextResponse.json({
      success: true,
      new_template_id: result?.template_id,
      new_template_key: existingKey,
      target_language,
    });
  } catch (error) {
    console.error("Translate template error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json({ error: authError.message }, { status: authError.statusCode });
    }

    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to translate template",
    }, { status: 500 });
  }
}
