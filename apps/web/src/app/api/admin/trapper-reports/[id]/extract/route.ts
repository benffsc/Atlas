import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne, queryRows, execute } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2000;

const SYSTEM_PROMPT = `You are an expert at extracting structured data from TNR (Trap-Neuter-Return) trapper field reports.

## TNR TERMINOLOGY
- **Eartip**: A small notch cut from a cat's ear during spay/neuter to indicate alteration
- **Colony**: A group of community cats living in a specific location
- **Fixed/Altered**: A cat that has been spayed or neutered
- **Unfixed/Intact**: A cat that has NOT been spayed or neutered
- **Friendly**: A cat that can be handled and may be adoptable
- **Feral**: A wild cat that cannot be handled
- **Community trapper**: Volunteer who traps cats at their own discretion
- **FFSC trapper**: Trained volunteer representing Forgotten Felines

## REQUEST STATUS MEANINGS
- **in_progress**: Trapper actively working the site
- **on_hold**: Temporarily paused (feeding issues, access problems, weather, trap-shy cats)
- **completed**: All cats addressed at this location
- **not_started**: Site identified but trapping not yet begun

## INFERENCE RULES
1. If trapper says "redirected efforts" or "moved on" or "paused" → site should be on_hold
2. "Already neutered" cats = previously fixed (don't count as newly trapped)
3. "Kittens" without age = assume under 6 months
4. Cats "remaining" or "still to go" = unfixed cats still needing TNR
5. If resident name given with address, they are likely the requester
6. "High tenant turnover" or "field nearby" = qualitative risk factors
7. If email in "From:" line differs from known emails → reporter_updates.new_email

## OUTPUT FORMAT
Return valid JSON with this structure:
{
  "reporter_updates": {
    "new_email": "email@domain.com or null if same as submission",
    "new_phone": "phone number or null"
  },
  "site_updates": [
    {
      "address": "partial or full address (e.g., '28 Tarman')",
      "resident_name": "name if mentioned (e.g., 'Marianne Brigham')",
      "start_date": "YYYY-MM or descriptive (e.g., 'late September 2025')",
      "cats_trapped": {
        "total": 5,
        "breakdown": "1 female kitten, 3 males (already neutered), 1 euthanized"
      },
      "cats_remaining": {
        "min": 4,
        "max": 6,
        "description": "mother cat + 3-4 youths + unknown ferals"
      },
      "status_recommendation": "on_hold",
      "hold_reason": "Resident not following feeding schedule",
      "qualitative_notes": "High tenant turnover, proximity to large field introduces strays",
      "related_sites": ["other addresses if cats migrate between them"],
      "original_text": "exact quote from report section about this site",
      "confidence": "high"
    }
  ],
  "overall_confidence": "high"
}

## IMPORTANT
- Extract ALL sites mentioned, even briefly
- Preserve exact numbers from the report
- Note uncertainty with min/max ranges
- Include original text snippets for each site (for verification)
- Mark confidence: 'high' if explicitly stated, 'medium' if inferred, 'low' if uncertain
- If no sites mentioned, return empty site_updates array`;

function cleanHtmlArtifacts(text: string): string {
  if (!text) return "";
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

interface SiteUpdate {
  address: string;
  resident_name?: string;
  start_date?: string;
  cats_trapped?: {
    total: number;
    breakdown?: string;
  };
  cats_remaining?: {
    min: number;
    max: number;
    description?: string;
  };
  status_recommendation?: string;
  hold_reason?: string;
  qualitative_notes?: string;
  related_sites?: string[];
  original_text?: string;
  confidence?: string;
}

interface Extraction {
  reporter_updates?: {
    new_email?: string;
    new_phone?: string;
  };
  site_updates: SiteUpdate[];
  overall_confidence?: string;
}

async function extractWithAI(
  anthropic: Anthropic,
  rawContent: string,
  reporterEmail: string | null
): Promise<Extraction | null> {
  const cleanContent = cleanHtmlArtifacts(rawContent);

  if (!cleanContent || cleanContent.length < 50) {
    return null;
  }

  const userPrompt = `Extract structured data from this trapper report.

Reporter email: ${reporterEmail || "unknown"}

--- REPORT START ---
${cleanContent}
--- REPORT END ---

Return only valid JSON matching the specified format.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text?.trim() : null;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  }
}

/**
 * POST /api/admin/trapper-reports/[id]/extract
 * Run AI extraction on a submission
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;

  // Check if API key is configured
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    // Get submission with pre-filled data
    const submission = await queryOne<{
      submission_id: string;
      reporter_email: string | null;
      reporter_person_id: string | null;
      raw_content: string;
      extraction_status: string;
      ai_extraction: { manual?: { cats_trapped?: number; cats_remaining?: number; status_update?: string } } | null;
    }>(
      `SELECT submission_id::text, reporter_email, reporter_person_id::text, raw_content, extraction_status, ai_extraction
       FROM ops.trapper_report_submissions WHERE submission_id = $1`,
      [id]
    );

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Check for pre-filled manual data
    const manualData = submission.ai_extraction?.manual;
    const hasManualNumbers = manualData?.cats_trapped !== undefined || manualData?.cats_remaining !== undefined;
    const hasManualStatus = manualData?.status_update !== undefined;

    // Mark as extracting
    await execute(
      `UPDATE ops.trapper_report_submissions SET extraction_status = 'extracting' WHERE submission_id = $1`,
      [id]
    );

    const anthropic = new Anthropic();

    // Run AI extraction
    const extraction = await extractWithAI(
      anthropic,
      submission.raw_content,
      submission.reporter_email
    );

    if (!extraction) {
      await execute(
        `UPDATE ops.trapper_report_submissions
         SET extraction_status = 'failed', extraction_error = $2
         WHERE submission_id = $1`,
        [id, "AI extraction returned null or invalid JSON"]
      );
      return NextResponse.json(
        { error: "AI extraction failed - could not parse response" },
        { status: 500 }
      );
    }

    // Match reporter ONLY if not already pre-selected
    let topReporter: { person_id: string; display_name: string; match_score: number; matched_signals: string[]; context_notes: string } | undefined;
    let reporterCandidates: typeof topReporter[] = [];

    if (submission.reporter_person_id) {
      // Reporter was pre-selected, get their info for context
      const preSelectedReporter = await queryOne<{ person_id: string; display_name: string }>(
        `SELECT person_id::text, display_name FROM sot.people WHERE person_id = $1`,
        [submission.reporter_person_id]
      );
      if (preSelectedReporter) {
        topReporter = {
          person_id: preSelectedReporter.person_id,
          display_name: preSelectedReporter.display_name,
          match_score: 1.0,
          matched_signals: ['pre_selected'],
          context_notes: 'Pre-selected by admin at submission',
        };
        reporterCandidates = [topReporter];
      }
    } else {
      // Run AI reporter matching
      reporterCandidates = await queryRows<{
        person_id: string;
        display_name: string;
        match_score: number;
        matched_signals: string[];
        context_notes: string;
      }>(
        `SELECT person_id::text, display_name, match_score, matched_signals, context_notes
         FROM trapper.match_person_from_report($1, $2)`,
        [null, submission.reporter_email]
      );
      topReporter = reporterCandidates[0];
    }

    let itemsCreated = 0;

    // Process each site update
    for (const site of extraction.site_updates || []) {
      // Match place
      const placeCandidates = await queryRows<{
        place_id: string;
        formatted_address: string;
        match_score: number;
        matched_signals: string[];
        context_notes: string;
      }>(
        `SELECT place_id::text, formatted_address, match_score, matched_signals, context_notes
         FROM ops.match_place_from_report($1, $2, $3)`,
        [site.address, site.resident_name || null, topReporter?.person_id || null]
      );
      const topPlace = placeCandidates[0];

      // Match request if place found
      let requestCandidates: Array<{
        request_id: string;
        status: string;
        requester_name: string | null;
        match_score: number;
        context_notes: string;
      }> = [];

      if (topPlace?.place_id) {
        requestCandidates = await queryRows(
          `SELECT request_id::text, status, requester_name, match_score, context_notes
           FROM trapper.match_request_from_report($1, $2, $3)`,
          [topPlace.place_id, site.resident_name || null, topReporter?.person_id || null]
        );
      }

      // Create items for review
      // Status update item - skip if manual status was already provided
      if (site.status_recommendation && requestCandidates[0] && !hasManualStatus) {
        await execute(
          `INSERT INTO ops.trapper_report_items (
            submission_id, item_type,
            target_entity_type, target_entity_id, match_confidence, match_candidates,
            extracted_text, extracted_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            "request_status",
            "request",
            requestCandidates[0].request_id,
            requestCandidates[0].match_score,
            JSON.stringify(requestCandidates),
            site.original_text || null,
            JSON.stringify({
              status: site.status_recommendation,
              hold_reason: site.hold_reason,
              note: site.qualitative_notes,
              source: 'ai_parsed',
            }),
          ]
        );
        itemsCreated++;
      }

      // Colony estimate item - skip if manual numbers were already provided
      if ((site.cats_remaining || site.cats_trapped) && !hasManualNumbers) {
        await execute(
          `INSERT INTO ops.trapper_report_items (
            submission_id, item_type,
            target_entity_type, target_entity_id, match_confidence, match_candidates,
            extracted_text, extracted_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            "colony_estimate",
            "place",
            topPlace?.place_id || null,
            topPlace?.match_score || null,
            JSON.stringify(placeCandidates),
            site.original_text || null,
            JSON.stringify({
              cats_trapped: site.cats_trapped,
              cats_remaining: site.cats_remaining,
              observation_date: new Date().toISOString().split("T")[0],
              notes: site.qualitative_notes,
              source: 'ai_parsed',
            }),
          ]
        );
        itemsCreated++;
      }

      // Site relationship items
      if (site.related_sites?.length) {
        for (const relatedAddr of site.related_sites) {
          const relatedPlaces = await queryRows<{
            place_id: string;
            formatted_address: string;
            match_score: number;
          }>(
            `SELECT place_id::text, formatted_address, match_score
             FROM ops.match_place_from_report($1, $2, $3)`,
            [relatedAddr, null, topReporter?.person_id || null]
          );

          if (
            relatedPlaces[0]?.place_id &&
            topPlace?.place_id &&
            relatedPlaces[0].place_id !== topPlace.place_id
          ) {
            await execute(
              `INSERT INTO ops.trapper_report_items (
                submission_id, item_type,
                target_entity_type, target_entity_id, match_confidence, match_candidates,
                extracted_data
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                id,
                "site_relationship",
                "place",
                topPlace.place_id,
                Math.min(topPlace.match_score, relatedPlaces[0].match_score),
                JSON.stringify([topPlace, relatedPlaces[0]]),
                JSON.stringify({
                  related_place_id: relatedPlaces[0].place_id,
                  related_address: relatedAddr,
                  note: "Cats migrating between sites",
                }),
              ]
            );
            itemsCreated++;
          }
        }
      }
    }

    // Handle reporter email update
    if (extraction.reporter_updates?.new_email && topReporter) {
      await execute(
        `INSERT INTO ops.trapper_report_items (
          submission_id, item_type,
          target_entity_type, target_entity_id, match_confidence, match_candidates,
          extracted_data
        ) VALUES ($1, 'person_identifier', 'person', $2, $3, $4, $5)`,
        [
          id,
          topReporter.person_id,
          topReporter.match_score,
          JSON.stringify(reporterCandidates),
          JSON.stringify({
            id_type: "email",
            id_value: extraction.reporter_updates.new_email,
          }),
        ]
      );
      itemsCreated++;
    }

    // Merge AI extraction with existing manual data
    const mergedExtraction = {
      ...(manualData ? { manual: manualData } : {}),
      ai_parsed: extraction,
    };

    // Update submission as extracted
    // Only update reporter if not already pre-selected
    if (submission.reporter_person_id) {
      // Preserve pre-selected reporter, just update extraction data
      await execute(
        `UPDATE ops.trapper_report_submissions
         SET
           extraction_status = 'extracted',
           extracted_at = NOW(),
           ai_extraction = $2
         WHERE submission_id = $1`,
        [
          id,
          JSON.stringify(mergedExtraction),
        ]
      );
    } else {
      // Update with AI-matched reporter
      await execute(
        `UPDATE ops.trapper_report_submissions
         SET
           extraction_status = 'extracted',
           extracted_at = NOW(),
           ai_extraction = $2,
           reporter_person_id = $3,
           reporter_match_confidence = $4,
           reporter_match_candidates = $5
         WHERE submission_id = $1`,
        [
          id,
          JSON.stringify(mergedExtraction),
          topReporter?.person_id || null,
          topReporter?.match_score || null,
          JSON.stringify(reporterCandidates),
        ]
      );
    }

    return NextResponse.json({
      success: true,
      extraction: mergedExtraction,
      items_created: itemsCreated,
      reporter_matched: !!topReporter,
      reporter_pre_selected: !!submission.reporter_person_id,
      manual_data_preserved: !!manualData,
      sites_processed: extraction.site_updates?.length || 0,
    });
  } catch (error) {
    console.error("Error extracting trapper report:", error);

    // Mark as failed
    await execute(
      `UPDATE ops.trapper_report_submissions
       SET extraction_status = 'failed', extraction_error = $2
       WHERE submission_id = $1`,
      [id, error instanceof Error ? error.message : "Unknown error"]
    );

    return NextResponse.json(
      { error: "Failed to extract trapper report" },
      { status: 500 }
    );
  }
}
