import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";

/**
 * POST /api/admin/claude-code/chat
 *
 * Admin-only endpoint for Claude Code assistant chat.
 * Provides development assistance for the Atlas codebase.
 */
export async function POST(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { message, history = [] } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });

    // System prompt for development assistance
    const systemPrompt = `You are Claude Code, an AI development assistant for the Atlas application.

Atlas is a TNR (Trap-Neuter-Return) management system for Forgotten Felines of Sonoma County. You have deep knowledge of:

## Architecture
- Next.js 14 app with App Router (apps/web/)
- PostgreSQL database (Supabase) with trapper schema
- Three-layer data model: Raw (staged_records) -> Identity Resolution -> Source of Truth (sot_* tables)

## Key Database Tables
- sot_people, sot_cats, sot_requests, places - Core entities
- person_identifiers - Email/phone for identity matching
- staff, staff_sessions - Authentication
- knowledge_articles - For Tippy AI knowledge base

## Important Patterns
- Always use find_or_create_* functions for entity creation (never direct INSERT)
- Source systems: 'airtable', 'clinichq', 'web_intake', 'web_app'
- Identity matching via email/phone only, never by name alone

## Key Files
- /apps/web/src/lib/auth.ts - Authentication utilities
- /apps/web/src/lib/db.ts - Database connection
- /apps/web/src/app/api/tippy/ - Tippy AI chat system
- /apps/web/src/middleware.ts - Auth enforcement

## Response Guidelines
- Be concise and technical
- Provide file paths when discussing code locations
- Suggest specific code changes when relevant
- Reference existing patterns in the codebase
- If unsure about something specific, say so

You're chatting with Ben, the admin and developer of Atlas. Help him with code questions, debugging, and development tasks.`;

    // Build messages array
    const messages: { role: "user" | "assistant"; content: string }[] = [
      ...history.slice(-10), // Keep last 10 messages for context
      { role: "user", content: message },
    ];

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    // Extract text response
    const textContent = response.content.find((c) => c.type === "text");
    const responseText = textContent?.type === "text" ? textContent.text : "No response generated";

    return NextResponse.json({
      success: true,
      response: responseText,
    });
  } catch (error) {
    console.error("Claude Code chat error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to process chat",
      },
      { status: 500 }
    );
  }
}
