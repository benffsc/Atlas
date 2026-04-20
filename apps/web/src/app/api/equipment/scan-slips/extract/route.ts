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
2. For barcodes, look for 4-digit numbers in the barcode box (e.g., "0205", "0218"). Sometimes staff writes a SECOND barcode next to or below the first — this means TWO traps were checked out on one form.
3. **MULTIPLE TRAPS ON ONE FORM:** If you see more than one barcode number on the same form (e.g., "0203" in the box and "0171" written nearby), return a SEPARATE JSON object for EACH barcode. Both objects should share the same borrower info (name, phone, email, address, dates, staff) but have different barcodes and equipment descriptions.
4. For purpose, check which checkbox is marked AND read any "Other:" write-in text
5. For dates, normalize to MM/DD/YY or MM/DD/YYYY format
6. Capture ANY extra handwritten text anywhere on the form (margin notes, crossed-out text, annotations) in additional_notes
7. If a field is blank or unreadable, return null
8. Return confidence 0.0-1.0 based on how clearly you can read the slip
9. For the equipment description, include any trap number mentioned (e.g., "#132 trap", "trap T-2")
10. The barcode in the equipment description field is sometimes the trap's legacy name, not the barcode — use the number in the BARCODE BOX as the barcode field.

If a single form has multiple traps, return a JSON ARRAY. Otherwise return a single object.

Return ONLY valid JSON (no markdown, no explanation):
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
  const { image, media_type, pdf, page_count } = body;

  if (!image && !pdf) {
    throw new ApiError("image (base64) or pdf (base64) is required", 400);
  }

  const anthropic = new Anthropic({ apiKey });

  // Build the content block — either an image or a PDF document
  let contentBlock: Anthropic.Messages.ContentBlockParam;

  if (pdf) {
    // PDF: use Claude's native document understanding
    // For multi-page PDFs, we ask Claude to extract ALL slips and return
    // a JSON array (one object per slip/page)
    contentBlock = {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdf,
      },
    } as Anthropic.Messages.ContentBlockParam;
  } else {
    // Image: standard vision
    const imageMediaType = media_type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageMediaType)) {
      throw new ApiError(`Unsupported media_type: ${imageMediaType}`, 400);
    }
    contentBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: imageMediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: image,
      },
    };
  }

  // For PDFs with multiple pages, adjust the prompt to return an array
  // For PDFs (always potentially multi-page) and single images, adjust prompt
  const isPdfOrMulti = !!pdf;
  const prompt = isPdfOrMulti
    ? EXTRACTION_PROMPT + `\n\nThis document has multiple pages. Each page is a separate checkout slip. If any single page has MULTIPLE barcodes (two traps checked out on one form), create a separate object for each barcode with the same borrower info. Return a JSON ARRAY of ALL slip objects across all pages. Example: [{ "confidence": 0.95, "name": "...", "barcode": "0203", ... }, { "confidence": 0.95, "name": "...", "barcode": "0171", ... }]`
    : EXTRACTION_PROMPT;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: isPdfOrMulti ? 4096 : 1024,
    messages: [
      {
        role: "user",
        content: [
          contentBlock,
          {
            type: "text",
            text: prompt,
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

  // Parse the JSON response — may be a single slip or an array (multi-page PDF)
  let slips: ExtractedSlip[];
  try {
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(jsonText);
    slips = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new ApiError(
      `Failed to parse Claude response as JSON: ${textBlock.text.slice(0, 200)}`,
      500,
    );
  }

  // Return both formats for backward compat: { slip } for single, { slips } for multi
  return apiSuccess({
    slip: slips[0] || null,
    slips,
    page_count: slips.length,
  });
});
