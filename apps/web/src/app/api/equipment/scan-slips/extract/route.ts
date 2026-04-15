import Anthropic from "@anthropic-ai/sdk";
import { apiSuccess, apiError } from "@/lib/api-response";
import { withErrorHandling, ApiError } from "@/lib/api-validation";
import { NextRequest } from "next/server";

/**
 * POST /api/equipment/scan-slips/extract
 *
 * Accepts a base64-encoded image of a checkout slip (or one page of a
 * multi-page PDF scan) and uses Claude vision to extract structured data.
 *
 * FFS-1234 (Equipment Overhaul epic FFS-1201).
 *
 * Request body: { image: string (base64), media_type: string }
 * Response: { slip: ExtractedSlip }
 */

export const maxDuration = 30;

export interface ExtractedSlip {
  /** Confidence 0-1 that this image contains a checkout slip */
  confidence: number;
  /** Extracted fields — all optional since OCR may miss some */
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  appointment_date: string | null;
  date_checked_out: string | null;
  barcode: string | null;
  equipment_description: string | null;
  purpose: string | null;
  deposit: string | null;
  due_date: string | null;
  staff_name: string | null;
  notes: string | null;
  /** Any extra text or annotations the AI noticed */
  additional_notes: string | null;
}

const EXTRACTION_PROMPT = `You are reading a scanned "Equipment Checkout Form" from Forgotten Felines of Sonoma County. Extract ALL handwritten and printed data from the form into structured JSON.

The form has these sections:
- BORROWER INFORMATION: Full Name, Phone, Email, Address (where equipment will be used), Appointment Date, Date Checked Out
- EQUIPMENT: Barcode (4 digits), Equipment Description, Purpose (checkboxes: FFR Appt, Feeding, Transport, Other with write-in)
- CHECKOUT DETAILS — STAFF USE: Deposit $, Due Date, Staff Name, Notes

IMPORTANT RULES:
1. Read handwriting carefully — names, phone numbers, and emails are critical identity data
2. For barcodes, look for 4-digit numbers in the barcode box (e.g., "0205", "0218")
3. For purpose, check which checkbox is marked AND read any "Other:" write-in text
4. For dates, normalize to MM/DD/YY or MM/DD/YYYY format
5. Capture ANY extra handwritten text anywhere on the form (margin notes, crossed-out text, annotations) in additional_notes
6. If a field is blank or unreadable, return null
7. Return confidence 0.0-1.0 based on how clearly you can read the slip

Return ONLY valid JSON matching this structure (no markdown, no explanation):
{
  "confidence": 0.95,
  "name": "Kathy Perez",
  "phone": "415-509-7648",
  "email": "kathyperez@gmail.com",
  "address": "1028 Temple Ave, Santa Rosa",
  "appointment_date": "4/13/26",
  "date_checked_out": "4/13/26",
  "barcode": "0205",
  "equipment_description": "trap",
  "purpose": "FFR Appt, well check",
  "deposit": "0",
  "due_date": null,
  "staff_name": "Jami",
  "notes": null,
  "additional_notes": null
}`;

export const POST = withErrorHandling(async (request: NextRequest) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ApiError("ANTHROPIC_API_KEY not configured", 500);
  }

  const body = await request.json();
  const { image, media_type } = body;

  if (!image) {
    throw new ApiError("image (base64) is required", 400);
  }

  const imageMediaType = media_type || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageMediaType)) {
    throw new ApiError(`Unsupported media_type: ${imageMediaType}`, 400);
  }

  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageMediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
              data: image,
            },
          },
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  });

  // Extract the text response
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ApiError("No text response from Claude", 500);
  }

  // Parse the JSON response
  let slip: ExtractedSlip;
  try {
    // Strip any markdown code fences if present
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    slip = JSON.parse(jsonText);
  } catch {
    throw new ApiError(
      `Failed to parse Claude response as JSON: ${textBlock.text.slice(0, 200)}`,
      500,
    );
  }

  return apiSuccess({ slip });
});
