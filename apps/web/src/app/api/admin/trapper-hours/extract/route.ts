/**
 * POST /api/admin/trapper-hours/extract
 *
 * Accepts a photo/PDF of a handwritten timesheet, sends it to Claude Vision,
 * and returns structured hours data that can auto-fill the hours entry form.
 *
 * Accepts: multipart/form-data with a single `file` field (image or PDF)
 * Returns: { extracted: { entries: [...], employee_name, period_start, period_end, total_hours } }
 *
 * Uses Claude Haiku for cost-effectiveness (~$0.01 per extraction).
 */

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling, ApiError } from "@/lib/api-validation";

interface ExtractedDay {
  date: string | null;       // "4/14/2026" or "Mon" or null
  address: string | null;    // where they worked
  hours: number | null;      // hours for that day
}

interface ExtractedTimesheet {
  employee_name: string | null;
  period_start: string | null;  // ISO date or descriptive
  period_end: string | null;
  period_type: "weekly" | "monthly" | "unknown";
  entries: ExtractedDay[];
  total_hours: number | null;
  hourly_rate: number | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
  raw_text: string | null;     // Claude's raw interpretation for debugging
}

const EXTRACT_PROMPT = `You are reading a handwritten timesheet/work sheet for a nonprofit cat rescue organization (Forgotten Felines of Sonoma County).

Extract ALL data from this timesheet image into structured JSON. The form typically has:
- Employee name (usually "Crystal Furtado" or similar)
- A date range (weekly or monthly period)
- Daily rows with: date, address/location where they worked, and hours
- A total hours line
- Sometimes a pay rate

Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "employee_name": "Crystal Furtado",
  "period_start": "2026-04-07",
  "period_end": "2026-04-13",
  "period_type": "weekly",
  "entries": [
    { "date": "Mon 4/7", "address": "FFSC, Stoneham, Joe Rodota", "hours": 9 },
    { "date": "Tue 4/8", "address": "Smith, Ferrari, Edgemon", "hours": 4 },
    { "date": "Wed 4/9", "address": "", "hours": null },
    ...
  ],
  "total_hours": 32,
  "hourly_rate": 20,
  "notes": "any additional notes on the sheet",
  "confidence": "high",
  "raw_text": "brief description of what you see on the sheet"
}

Rules:
- If a day has no entry (blank row), include it with null hours and empty address
- Read handwriting carefully — addresses are often shorthand names of places/people (e.g., "Stoneham", "FFSC", "Gonsalves", "Burton Rec")
- Hours may include minutes noted as decimals or as "8:30" — convert to decimal (8.5)
- If you can't read something clearly, include your best guess and set confidence to "medium" or "low"
- Dates should be in the format shown on the sheet; also provide ISO dates for period_start/period_end if you can determine the year
- The period_type is "weekly" if ~7 days, "monthly" if ~28-31 days
- If the sheet is completely blank (no handwriting), return entries with all nulls and confidence "low"`;

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

export const POST = withErrorHandling(async (request: NextRequest) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new ApiError("ANTHROPIC_API_KEY not configured", 500);
  }

  // Parse multipart form data
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    throw new ApiError("file is required (multipart form-data)", 400);
  }

  // Validate file type
  const mimeType = file.type;
  if (!ACCEPTED_TYPES.includes(mimeType)) {
    throw new ApiError(
      `Unsupported file type: ${mimeType}. Accepted: JPEG, PNG, WebP, HEIC, PDF`,
      400
    );
  }

  // Validate file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    throw new ApiError("File too large (max 10MB)", 400);
  }

  // Read file to base64
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  // Determine media type for Claude
  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
  if (mimeType === "image/png") mediaType = "image/png";
  else if (mimeType === "image/webp") mediaType = "image/webp";
  else if (mimeType === "image/gif") mediaType = "image/gif";
  // HEIC/PDF: Claude handles base64 images; for PDF we'll treat as image
  // since most scanned timesheets are single-page

  // Call Claude Vision
  const client = new Anthropic({ apiKey: anthropicKey });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: "text",
            text: EXTRACT_PROMPT,
          },
        ],
      },
    ],
  });

  // Extract text response
  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ApiError("No text response from Claude", 500);
  }

  // Parse JSON from response
  let extracted: ExtractedTimesheet;
  try {
    // Try to parse directly
    extracted = JSON.parse(textBlock.text);
  } catch {
    // Claude might have wrapped in markdown code fences
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ApiError("Could not parse extraction result", 500);
    }
    extracted = JSON.parse(jsonMatch[0]);
  }

  // Calculate total if not provided
  if (extracted.total_hours == null && extracted.entries) {
    const sum = extracted.entries.reduce(
      (acc, e) => acc + (e.hours ?? 0),
      0
    );
    if (sum > 0) extracted.total_hours = sum;
  }

  return apiSuccess({
    extracted,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  });
});
