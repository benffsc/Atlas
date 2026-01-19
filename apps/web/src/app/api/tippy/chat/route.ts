import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TIPPY_TOOLS, executeToolCall } from "../tools";

/**
 * Tippy Chat API
 *
 * Provides AI-powered assistance for navigating Atlas and understanding TNR operations.
 * Uses Claude as the backend AI model with tool use for database queries.
 */

const SYSTEM_PROMPT = `You are Tippy, a helpful assistant for Atlas - a TNR management system used by Forgotten Felines of Sonoma County (FFSC).

IMPORTANT TERMINOLOGY:
- When speaking to the public or about the program generally, use "FFR" (Find Fix Return) instead of "TNR"
- TNR (Trap-Neuter-Return) is acceptable for internal/staff conversations
- "Fix" means spay/neuter in public-friendly language

Your role is to help staff, volunteers, and community members navigate Atlas and understand FFR operations.

KEY CAPABILITY: You have access to the Atlas database through tools! When users ask about:
- Cats at a specific address → use query_cats_at_place
- Colony status or alteration rates → use query_place_colony_status
- Request statistics → use query_request_stats
- FFR impact metrics → use query_ffr_impact
- Person's history → use query_person_history

Always use tools when the user asks for specific data. Be confident in your answers when you have data.

Key information about Atlas:
- Atlas tracks People (requesters, trappers, volunteers), Cats (with microchips, clinic visits), Requests (trapping requests), and Places (addresses/colonies)
- The Beacon module provides ecological analytics including colony estimates, alteration rates, and FFR impact
- FFR (Find Fix Return) / TNR is a humane method to manage feral cat populations
- The 70% alteration threshold is scientifically supported for population stabilization
- FFSC serves Sonoma County, California

Navigation help:
- Dashboard (/) - Overview of active requests and pending intake
- Requests (/requests) - Trapping requests and their status
- Cats (/cats) - Registry of all cats with microchips and clinic records
- People (/people) - Contact directory for requesters, trappers, volunteers
- Places (/places) - Address and colony location database
- Intake (/intake/queue) - Website submissions waiting for triage
- Beacon (/beacon) - Ecological analytics and FFR impact metrics
- Admin (/admin) - System configuration and data management

Common tasks:
- To create a new request: Go to Dashboard → "New Request" button, or /requests/new
- To find cats at an address: Use the global search, or go to Places → find the address → view linked cats
- To process intake submissions: Go to Intake → review each submission → either "Upgrade to Request" or take action

FFR terminology:
- Alteration / Fix: Spay or neuter surgery
- Colony: A group of community cats living at a location
- Eartip: A small notch in a cat's ear indicating they've been fixed
- Caretaker: Someone who feeds and monitors a colony
- FFR: Find Fix Return - locate cats, get them fixed, return to their colony

Be concise, helpful, and friendly. Use simple language. Always cite specific numbers from database queries when available.

Format responses in a readable way. Use short paragraphs and bullet points when listing multiple items.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, history = [] } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      // Fallback to simple pattern matching if no API key
      const fallbackResponse = getFallbackResponse(message);
      return NextResponse.json({ message: fallbackResponse });
    }

    // Initialize Anthropic client
    const client = new Anthropic({ apiKey });

    // Build messages array
    const messages: Anthropic.MessageParam[] = [
      ...history.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: message },
    ];

    // Call Claude API with tools
    let response = await client.messages.create({
      model: "claude-3-haiku-20240307", // Using Haiku for speed and cost
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
      tools: TIPPY_TOOLS,
    });

    // Handle tool use loop (max 3 iterations to prevent infinite loops)
    let iterations = 0;
    const maxIterations = 3;

    while (response.stop_reason === "tool_use" && iterations < maxIterations) {
      iterations++;

      // Find tool use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) break;

      // Execute each tool call
      const toolResults: Anthropic.MessageParam = {
        role: "user",
        content: await Promise.all(
          toolUseBlocks.map(async (toolUse) => {
            const result = await executeToolCall(
              toolUse.name,
              toolUse.input as Record<string, unknown>
            );

            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            };
          })
        ),
      };

      // Add assistant's response and tool results to messages
      messages.push({
        role: "assistant",
        content: response.content,
      });
      messages.push(toolResults);

      // Call Claude again with tool results
      response = await client.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
        tools: TIPPY_TOOLS,
      });
    }

    // Extract final text content
    const textContent = response.content.find((c) => c.type === "text");
    const assistantMessage = textContent?.type === "text" ? textContent.text : "I'm not sure how to help with that.";

    return NextResponse.json({ message: assistantMessage });
  } catch (error) {
    console.error("Tippy chat error:", error);

    // Return a friendly error message
    return NextResponse.json({
      message:
        "I'm having trouble connecting right now. Try asking again or use the search bar to find what you need.",
    });
  }
}

/**
 * Fallback responses when no API key is configured
 */
function getFallbackResponse(message: string): string {
  const lowerMessage = message.toLowerCase();

  // Navigation questions
  if (
    lowerMessage.includes("create") &&
    (lowerMessage.includes("request") || lowerMessage.includes("trapping"))
  ) {
    return `To create a new trapping request:

1. Click "New Request" on the Dashboard, or
2. Go to /requests/new directly

You'll need the requester's contact info, address, and estimated number of cats.`;
  }

  if (
    lowerMessage.includes("find") &&
    (lowerMessage.includes("cat") || lowerMessage.includes("cats"))
  ) {
    return `To find cats:

• **By address**: Use the global search bar at the top, or go to Places → find the address → view linked cats
• **By microchip**: Go to Cats → use the search/filter
• **By name**: Search in the Cats page

The Beacon module also shows colony estimates by location.`;
  }

  if (lowerMessage.includes("tnr") || lowerMessage.includes("trap-neuter")) {
    return `**TNR (Trap-Neuter-Return)** is a humane method to manage feral cat populations:

1. **Trap** - Humanely catch cats using live traps
2. **Neuter** - Spay or neuter them at a clinic
3. **Return** - Release them back to their colony

Research shows that 70%+ alteration coverage stabilizes colony populations. Atlas helps track this progress through the Beacon module.`;
  }

  if (lowerMessage.includes("beacon")) {
    return `**Beacon** is the ecological analytics module in Atlas. It shows:

• Colony size estimates
• Alteration (spay/neuter) rates
• Geographic clusters of colonies
• Population trends

Go to /beacon to see the dashboard, or /admin/beacon for detailed data.`;
  }

  if (lowerMessage.includes("intake") || lowerMessage.includes("submission")) {
    return `The **Intake Queue** shows website form submissions waiting for triage:

1. Go to Intake (/intake/queue)
2. Review each submission
3. Either "Upgrade to Request" if valid, or take other action

Urgent/emergency submissions are highlighted at the top.`;
  }

  if (lowerMessage.includes("trapper") || lowerMessage.includes("volunteer")) {
    return `To manage trappers and volunteers:

• Go to Trappers (/trappers) to see the roster
• Each trapper profile shows their stats and assigned requests
• Coordinators can assign trappers to requests from the request detail page`;
  }

  // Default response
  return `I can help you navigate Atlas! Try asking about:

• How to create a request
• Finding cats by address
• What is TNR
• Using the Beacon analytics
• Processing intake submissions

Or use the search bar at the top to find specific records.`;
}
