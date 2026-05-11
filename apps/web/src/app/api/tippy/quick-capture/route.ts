import { NextRequest } from "next/server";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { executeToolCallV2, type ToolContext, type ToolResult } from "../tools-v2";

/**
 * POST /api/tippy/quick-capture
 *
 * Lightweight endpoint for freeform context capture. Staff dumps text
 * (phone call notes, email snippet, field observation, brain dump) and
 * Tippy extracts structured entities + creates records.
 *
 * Unlike the full chat, this is fire-and-forget: no streaming, no history,
 * just "I captured X, Y, Z" confirmation.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";

const CAPTURE_SYSTEM_FN = () => `You are Tippy, processing a quick context capture from an FFSC staff member.
Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

The staff member just dumped some text — a phone call, email, field note, or thought.
Your job: extract ALL actionable information and create records. Be thorough but fast.

WORKFLOW — resolve THEN write:
1. If the text mentions a PLACE (address, street, colony name) → call place_search FIRST to get the place_id
2. If the text mentions a PERSON by name → call person_lookup FIRST to find their record
3. THEN create the records using the resolved IDs (entity_id parameter)
4. This ensures notes link to the RIGHT place/person, not orphaned

For EACH piece of information, call the appropriate tool:
- New person with phone/address → log_event with action_type="add_field_contact"
- Observation about a place → log_event with action_type="add_note" (use entity_type="place" + entity_id from place_search)
- Cat sighting/count → log_event with action_type="field_event"
- Time-sensitive followup → create_reminder
- General context → log_event with action_type="add_note"

ALWAYS include the FULL original text in the notes field. The structured extraction is for linking — but the raw text is the source of truth. Never summarize away details.

ATTRIBUTION: Start every note with the source in brackets:
- [Phone call from Rick] ...
- [Email from Diane] ...
- [Text from Katie] ...
- [Field observation] ...
- [Staff note] ...

IDENTITY INTELLIGENCE:
When staff says "got this email FROM [person]" or "[person]'s number is X":
- STRONG identity signal — log with tag "identity_signal"
- Staff knowledge > automated matching

After processing, respond with a SHORT summary: what you captured, which places/people it linked to, and any reminders created. One paragraph max.
Do NOT ask clarifying questions. Just capture what's there.`;


const CAPTURE_TOOLS: Anthropic.Tool[] = [
  {
    name: "place_search",
    description: "Find a place by address or name. Use this FIRST to resolve ambiguous locations before creating notes. Returns place_id you can use in log_event.",
    input_schema: {
      type: "object" as const,
      properties: {
        address: { type: "string", description: "Address, street name, or place name" },
      },
      required: ["address"],
    },
  },
  {
    name: "person_lookup",
    description: "Find a person by name, email, or phone. Use to resolve people mentioned in the capture so notes link to the right person record.",
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: { type: "string", description: "Name, email, or phone" },
      },
      required: ["identifier"],
    },
  },
  {
    name: "log_event",
    description: "Log field data. action_type: add_field_contact | add_note | field_event",
    input_schema: {
      type: "object" as const,
      properties: {
        action_type: { type: "string", enum: ["field_event", "add_note", "add_field_contact"] },
        location: { type: "string" },
        entity_type: { type: "string" },
        entity_id: { type: "string" },
        notes: { type: "string" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        relationship_type: { type: "string" },
        cat_count: { type: "number" },
        eartipped_count: { type: "number" },
        details: { type: "object" },
      },
      required: ["action_type"],
    },
  },
  {
    name: "create_reminder",
    description: "Create a followup reminder",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        due_at: { type: "string" },
        notes: { type: "string" },
        entity_type: { type: "string" },
        entity_id: { type: "string" },
      },
      required: ["title", "due_at"],
    },
  },
];

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session?.staff_id) {
    return apiBadRequest("Authentication required");
  }

  let body: { text: string; source?: string };
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON");
  }

  if (!body.text || body.text.trim().length < 3) {
    return apiBadRequest("Text is required (minimum 3 characters)");
  }

  if (!ANTHROPIC_API_KEY) {
    return apiServerError("AI service not configured");
  }

  const staff = await queryOne<{ display_name: string }>(
    `SELECT display_name FROM ops.staff WHERE staff_id = $1`,
    [session.staff_id]
  );
  const staffName = staff?.display_name || "Unknown";

  // Preserve the RAW text as a journal entry FIRST — even if Claude's extraction
  // fails or misinterprets, the original dump is never lost.
  const sourceChannel = body.source || "quick_capture"; // future: "phone", "email", "text"
  try {
    await queryOne(
      `INSERT INTO ops.journal_entries (
        entry_kind, occurred_at, body, created_by, tags
      ) VALUES (
        'note', NOW(), $1, $2, ARRAY['quick_capture', 'raw_input', $3]
      ) RETURNING id`,
      [body.text.trim(), staffName, sourceChannel]
    );
  } catch {
    // Non-blocking — don't fail the capture if raw preservation fails
  }

  const toolContext: ToolContext = {
    staffId: session.staff_id,
    staffName: staffName,
    aiAccessLevel: "full",
  };

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    // Run up to 5 iterations: resolve places/people (1-2), then write records (3-5)
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: body.text },
    ];

    const actionsCreated: string[] = [];

    for (let i = 0; i < 5; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: CAPTURE_SYSTEM_FN(),
        messages,
        tools: CAPTURE_TOOLS,
        tool_choice: i === 0 ? { type: "auto" } : { type: "auto" },
      });

      const toolBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      ) as Anthropic.ToolUseBlock[];
      const textBlocks = response.content.filter(
        (b) => b.type === "text"
      ) as Anthropic.TextBlock[];

      // If no tool calls, we're done — grab the summary
      if (toolBlocks.length === 0) {
        const summary = textBlocks.map((b) => b.text).join("") || "Captured.";
        return apiSuccess({
          summary,
          actions_created: actionsCreated,
          action_count: actionsCreated.length,
        });
      }

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tb of toolBlocks) {
        const input = tb.input as Record<string, unknown>;
        let result: ToolResult;
        try {
          result = await executeToolCallV2(tb.name, input, toolContext);
          actionsCreated.push(
            `${tb.name}:${input.action_type || input.title || "action"}`
          );
        } catch (err) {
          result = { success: false, error: String(err) };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tb.id,
          content: JSON.stringify(result).substring(0, 5000),
        });
      }

      // Continue conversation with tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }

    // If we exhausted iterations, return what we have
    return apiSuccess({
      summary: `Captured ${actionsCreated.length} items from your note.`,
      actions_created: actionsCreated,
      action_count: actionsCreated.length,
    });
  } catch (err) {
    console.error("[QUICK-CAPTURE] Error:", err);
    return apiServerError("Failed to process capture");
  }
}
