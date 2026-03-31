import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

/**
 * POST /api/requests/[id]/parse-enrichment
 *
 * FFS-1015: AI-powered field extraction from free text (email, call notes, etc.)
 * Uses Claude to parse unstructured text into structured request fields.
 */

const EXTRACTABLE_FIELDS = {
  estimated_cat_count: { type: "number", label: "Adult Cats Needing TNR", category: "Cat Info" },
  total_cats_reported: { type: "number", label: "Total Cats Reported", category: "Cat Info" },
  cat_name: { type: "string", label: "Cat Name", category: "Cat Info" },
  cat_description: { type: "string", label: "Cat Description", category: "Cat Info" },
  handleability: { type: "string", label: "Handleability", category: "Cat Info" },
  has_kittens: { type: "boolean", label: "Has Kittens", category: "Cat Info" },
  kitten_count: { type: "number", label: "Kitten Count", category: "Cat Info" },
  kitten_age_estimate: { type: "string", label: "Kitten Age Estimate", category: "Cat Info" },
  cats_are_friendly: { type: "boolean", label: "Cats Are Friendly", category: "Cat Info" },
  colony_duration: { type: "string", label: "Colony Duration", category: "Cat Info" },
  location_description: { type: "string", label: "Location Description", category: "Location" },
  best_times_seen: { type: "string", label: "Best Times Seen", category: "Location" },
  best_trapping_time: { type: "string", label: "Best Trapping Time", category: "Location" },
  access_notes: { type: "string", label: "Access Notes", category: "Location" },
  has_medical_concerns: { type: "boolean", label: "Medical Concerns", category: "Medical" },
  medical_description: { type: "string", label: "Medical Description", category: "Medical" },
  urgency_notes: { type: "string", label: "Urgency Notes", category: "Medical" },
  is_being_fed: { type: "boolean", label: "Being Fed", category: "Feeding" },
  feeder_name: { type: "string", label: "Feeder Name", category: "Feeding" },
  feeding_frequency: { type: "string", label: "Feeding Frequency", category: "Feeding" },
  feeding_time: { type: "string", label: "Feeding Time", category: "Feeding" },
  feeding_location: { type: "string", label: "Feeding Location", category: "Feeding" },
  dogs_on_site: { type: "string", label: "Dogs on Site", category: "Trapping" },
  trap_savvy: { type: "string", label: "Trap-Savvy Cats", category: "Trapping" },
  previous_tnr: { type: "string", label: "Previous TNR", category: "Trapping" },
} as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "request");

    // Auth check
    const session = await getSession(request);
    if (!session?.staff_id) {
      return apiBadRequest("Authentication required");
    }
    // Check AI access level from staff table
    const staffInfo = await queryOne<{ ai_access_level: string | null }>(
      `SELECT ai_access_level FROM ops.staff WHERE staff_id = $1`,
      [session.staff_id]
    );
    const aiAccess = staffInfo?.ai_access_level || "none";
    if (aiAccess === "none" || aiAccess === "read_only") {
      return apiBadRequest("Write-level AI access required for enrichment parsing");
    }

    const body = await request.json();
    const { text, source_type } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return apiBadRequest("Text is required");
    }
    if (text.length > 10000) {
      return apiBadRequest("Text too long (max 10,000 characters)");
    }

    // Verify request exists
    const existing = await queryOne<{
      request_id: string;
      summary: string | null;
      notes: string | null;
      estimated_cat_count: number | null;
      place_name: string | null;
    }>(
      `SELECT r.request_id, r.summary, r.notes, r.estimated_cat_count,
              p.display_name as place_name
       FROM ops.requests r
       LEFT JOIN sot.places p ON p.place_id = r.place_id
       WHERE r.request_id = $1 AND r.merged_into_request_id IS NULL`,
      [id]
    );

    if (!existing) {
      return apiNotFound("Request", id);
    }

    // Build tool schema for Claude extraction
    const fieldProperties: Record<string, object> = {};
    for (const [key, meta] of Object.entries(EXTRACTABLE_FIELDS)) {
      if (meta.type === "number") {
        fieldProperties[key] = { type: "number", description: meta.label };
      } else if (meta.type === "boolean") {
        fieldProperties[key] = { type: "boolean", description: meta.label };
      } else {
        fieldProperties[key] = { type: "string", description: meta.label };
      }
    }

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: `You are a data extraction assistant for a TNR (Trap-Neuter-Return) cat management system called Atlas. Extract structured fields from the provided text. Only include fields you are confident about. The text may be an email, call notes, or site visit notes about a request at ${existing.place_name || "an unknown location"}.

Rules:
- Only extract data explicitly stated in the text
- For cat counts, distinguish between total cats at location and cats needing TNR
- For boolean fields, only set them if clearly stated
- Feeding frequency values: daily, few_times_week, occasionally, rarely
- Handleability values: friendly, semi_feral, feral, mixed
- Colony duration values: less_than_6_months, 6_months_to_2_years, 2_to_5_years, more_than_5_years
- Kitten age estimates: under_4_weeks, 4_to_8_weeks, 8_to_12_weeks, over_12_weeks
- For location_description: include cross-streets, landmarks, secondary addresses mentioned
- Any info that doesn't map to a specific field goes in unmapped_text`,
      tools: [
        {
          name: "extract_request_fields",
          description: "Extract structured request fields from free text",
          input_schema: {
            type: "object" as const,
            properties: {
              extracted_fields: {
                type: "object",
                description: "Fields extracted from the text",
                properties: fieldProperties,
              },
              unmapped_text: {
                type: "string",
                description: "Text that contains useful info but doesn't map to a specific field. Will be appended to notes.",
              },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Overall confidence in the extraction",
              },
            },
            required: ["extracted_fields", "confidence"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_request_fields" },
      messages: [
        {
          role: "user",
          content: `Extract structured request fields from this ${source_type || "text"}:\n\n${text}`,
        },
      ],
    });

    // Extract the tool use result
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (!toolUse) {
      return apiServerError("AI extraction failed - no tool response");
    }

    const extraction = toolUse.input as {
      extracted_fields: Record<string, unknown>;
      unmapped_text?: string;
      confidence: string;
    };

    // Build categorized response
    const categorized: Record<string, Array<{
      key: string;
      label: string;
      value: unknown;
      type: string;
    }>> = {};

    for (const [key, value] of Object.entries(extraction.extracted_fields)) {
      if (value === null || value === undefined) continue;
      const meta = EXTRACTABLE_FIELDS[key as keyof typeof EXTRACTABLE_FIELDS];
      if (!meta) continue;

      const category = meta.category;
      if (!categorized[category]) categorized[category] = [];
      categorized[category].push({
        key,
        label: meta.label,
        value,
        type: meta.type,
      });
    }

    return apiSuccess({
      extracted_fields: extraction.extracted_fields,
      categorized,
      unmapped_text: extraction.unmapped_text || null,
      confidence: extraction.confidence,
      field_count: Object.keys(extraction.extracted_fields).filter(
        (k) => extraction.extracted_fields[k] !== null && extraction.extracted_fields[k] !== undefined
      ).length,
    });
  } catch (err) {
    console.error("Parse enrichment error:", err);
    return apiServerError(
      err instanceof Error ? err.message : "Failed to parse enrichment text"
    );
  }
}
