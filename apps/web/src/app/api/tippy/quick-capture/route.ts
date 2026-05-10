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

const CAPTURE_SYSTEM = `You are Tippy, processing a quick context capture from an FFSC staff member.
Today's date is ${new Date().toISOString().split("T")[0]}.

The staff member just dumped some text — a phone call, email, field note, or thought.
Your job: extract ALL actionable information and create records. Be thorough but fast.

For EACH piece of information, call the appropriate tool:
- New person with phone/address → log_event with action_type="add_field_contact"
- Observation about a place → log_event with action_type="add_note"
- Cat sighting/count → log_event with action_type="field_event"
- Time-sensitive followup → create_reminder
- General context → log_event with action_type="add_note"

If the text mentions a specific address, attach notes to that place.
If it mentions a person by name + contact info, create a field contact.
If it has a date or "follow up in X weeks", create a reminder.

After processing, respond with a SHORT summary of what you captured (1-2 sentences).
Do NOT ask clarifying questions. Just capture what's there.`;

const CAPTURE_TOOLS: Anthropic.Tool[] = [
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

  let body: { text: string };
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

  const toolContext: ToolContext = {
    staffId: session.staff_id,
    staffName: staff?.display_name || "Unknown",
    aiAccessLevel: "full",
  };

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    // Run up to 3 iterations to process all entities
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: body.text },
    ];

    const actionsCreated: string[] = [];

    for (let i = 0; i < 3; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: CAPTURE_SYSTEM,
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
