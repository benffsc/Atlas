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
  /** Mapped equipment type key if identifiable */
  equipment_type: string | null;
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
2. **BARCODES — READ EACH LINE SEPARATELY.** The barcode box may contain MULTIPLE 4-digit numbers written on SEPARATE LINES, stacked vertically. Each line is a DIFFERENT trap barcode. Read each line independently — do NOT combine or merge digits from different lines. For example, if the box shows three lines "0224" then "0172" then "0209", those are THREE separate barcodes, not one number.
3. **MULTIPLE TRAPS ON ONE FORM:** For EVERY 4-digit barcode number you find in/around the barcode box, return a SEPARATE JSON object. All objects share the same borrower info (name, phone, email, address, dates, staff) but have different barcodes. A form can have 1, 2, 3, or more barcodes — count ALL of them. If you see what looks like multiple handwritten numbers stacked in the barcode area, each one is a separate trap.
4. For purpose, check which checkbox is marked AND read any "Other:" write-in text
5. For dates, normalize to MM/DD/YY or MM/DD/YYYY format
6. Capture ANY extra handwritten text anywhere on the form (margin notes, crossed-out text, annotations) in additional_notes
7. If a field is blank or unreadable, return null
8. Return confidence 0.0-1.0 based on how clearly you can read the slip
9. For the equipment description, include any trap number mentioned (e.g., "#132 trap", "trap T-2")
10. The barcode in the equipment description field is sometimes the trap's legacy name, not the barcode — use the number in the BARCODE BOX as the barcode field.
11. **EQUIPMENT TYPE:** If identifiable from the description or form context, set equipment_type to one of: "large_trap_backdoor", "large_trap_no_backdoor", "large_trap_swing_backdoor", "small_trap_backdoor", "small_trap_no_backdoor", "drop_trap", "string_trap", "transfer_cage", "trap_cover", "divider". If just "trap" with no size/type detail, use "large_trap_backdoor" (most common). If unclear, return null.
12. **STAFF NAME RESOLUTION:** Common staff abbreviations: "JM" or "Jami" = "Jami Knuthson", "JK" = "Jami Knuthson", "CF" = "Crystal Furtado", "HF" or "Heidi" = "Heidi Fantacone". Return the full resolved name if you can match an abbreviation.
13. **BARCODES MUST BE 4 DIGITS with leading zeros.** If you read "209", it should be "0209". If you read "24", it should be "0024". Always pad to 4 digits.

If a single form has multiple traps, return a JSON ARRAY. Otherwise return a single object.

Return ONLY valid JSON (no markdown, no explanation).

Single trap example:
{"confidence": 0.95, "name": "Kathy Perez", "phone": "415-509-7648", "email": "kathyperez@gmail.com", "address": "1028 Temple Ave, Santa Rosa", "appointment_date": "4/13/26", "date_checked_out": "4/13/26", "barcode": "0205", "equipment_description": "trap", "purpose": "FFR Appt", "deposit": "0", "due_date": null, "staff_name": "Jami", "notes": null, "additional_notes": null}

Multiple traps example (3 barcodes on one form → 3 objects):
[{"confidence": 0.9, "name": "Jacqueline Luna", "phone": "707-758-5428", "barcode": "0224", "purpose": "FFR Appt", "date_checked_out": "4/21", "appointment_date": "4/22", "staff_name": "JM", "address": "4377 Westside Road", "email": "jluna@gmail.com", "equipment_description": null, "deposit": null, "due_date": null, "notes": null, "additional_notes": null}, {"confidence": 0.9, "name": "Jacqueline Luna", "phone": "707-758-5428", "barcode": "0172", "purpose": "FFR Appt", "date_checked_out": "4/21", "appointment_date": "4/22", "staff_name": "JM", "address": "4377 Westside Road", "email": "jluna@gmail.com", "equipment_description": null, "deposit": null, "due_date": null, "notes": null, "additional_notes": null}, {"confidence": 0.9, "name": "Jacqueline Luna", "phone": "707-758-5428", "barcode": "0209", "purpose": "FFR Appt", "date_checked_out": "4/21", "appointment_date": "4/22", "staff_name": "JM", "address": "4377 Westside Road", "email": "jluna@gmail.com", "equipment_description": null, "deposit": null, "due_date": null, "notes": null, "additional_notes": null}]`;

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
    ? EXTRACTION_PROMPT + `\n\nThis document has multiple pages. Each page is a separate checkout slip. If any single page has MULTIPLE barcodes (2, 3, or more numbers stacked in the barcode box), create a separate JSON object for EACH barcode with the same borrower info. Return a JSON ARRAY of ALL slip objects across all pages. Example for a form with 3 barcodes: [{ "confidence": 0.95, "name": "Jacqueline Luna", "barcode": "0224", ... }, { "confidence": 0.95, "name": "Jacqueline Luna", "barcode": "0172", ... }, { "confidence": 0.95, "name": "Jacqueline Luna", "barcode": "0209", ... }]`
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
