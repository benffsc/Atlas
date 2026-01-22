#!/usr/bin/env node
/**
 * Extract Structured Data from Trapper Reports
 * =============================================
 *
 * Uses AI to extract structured data from trapper field reports (emails, summaries):
 * - Site updates (address, cats trapped, cats remaining, status)
 * - Reporter identity updates (new email/phone)
 * - Site relationships (cats migrating between locations)
 *
 * Data is stored in:
 * - trapper_report_items (for staff review before commit)
 * - Entity matching uses match_*_from_report() functions
 *
 * Usage:
 *   node scripts/jobs/extract_trapper_reports.mjs --submission-id UUID
 *   node scripts/jobs/extract_trapper_reports.mjs --pending [--limit N]
 *   node scripts/jobs/extract_trapper_reports.mjs --dry-run --submission-id UUID
 *
 * Environment:
 *   DATABASE_URL - Postgres connection
 *   ANTHROPIC_API_KEY - Anthropic API key
 */

import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const { Pool } = pg;

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

const MODEL = 'claude-haiku-4-20250514';
const MAX_TOKENS = 2000;
const RATE_LIMIT_MS = 200;

const SYSTEM_PROMPT = `You are an expert at extracting structured data from TNR (Trap-Neuter-Return) trapper field reports.

## TNR TERMINOLOGY
- **Eartip**: A small notch cut from a cat's ear during spay/neuter to indicate alteration
- **Colony**: A group of community cats living in a specific location
- **Fixed/Altered**: A cat that has been spayed or neutered
- **Unfixed/Intact**: A cat that has NOT been spayed or neutered
- **Friendly**: A cat that can be handled and may be adoptable
- **Feral**: A wild cat that cannot be handled
- **Community trapper**: Volunteer who traps cats at their own discretion (not FFSC staff)
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

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    pending: args.includes('--pending'),
    limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10,
    submissionId: args.includes('--submission-id') ? args[args.indexOf('--submission-id') + 1] : null,
    help: args.includes('--help') || args.includes('-h'),
  };
}

function cleanHtmlArtifacts(text) {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractWithAI(anthropic, rawContent, reporterEmail) {
  const cleanContent = cleanHtmlArtifacts(rawContent);

  if (!cleanContent || cleanContent.length < 50) {
    console.log(`${yellow}Content too short (${cleanContent.length} chars), skipping AI${reset}`);
    return null;
  }

  const userPrompt = `Extract structured data from this trapper report.

Reporter email: ${reporterEmail || 'unknown'}

--- REPORT START ---
${cleanContent}
--- REPORT END ---

Return only valid JSON matching the specified format.`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const text = response.content[0]?.text?.trim();
    if (!text) return null;

    // Parse JSON with fallback
    try {
      return JSON.parse(text);
    } catch {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      console.log(`${red}Failed to parse AI response as JSON${reset}`);
      console.log(`${dim}Response: ${text.substring(0, 200)}...${reset}`);
      return null;
    }
  } catch (error) {
    console.error(`${red}AI extraction error: ${error.message}${reset}`);
    throw error;
  }
}

async function matchReporter(pool, reporterEmail, reporterName) {
  const { rows } = await pool.query(
    `SELECT * FROM trapper.match_person_from_report($1, $2)`,
    [reporterName, reporterEmail]
  );
  return rows;
}

async function matchPlace(pool, addressFragment, residentName, trapperId) {
  const { rows } = await pool.query(
    `SELECT * FROM trapper.match_place_from_report($1, $2, $3)`,
    [addressFragment, residentName, trapperId]
  );
  return rows;
}

async function matchRequest(pool, placeId, requesterName, trapperId) {
  const { rows } = await pool.query(
    `SELECT * FROM trapper.match_request_from_report($1, $2, $3)`,
    [placeId, requesterName, trapperId]
  );
  return rows;
}

async function processSubmission(pool, anthropic, submission, dryRun) {
  console.log(`\n${cyan}Processing submission ${submission.submission_id.substring(0, 8)}...${reset}`);
  console.log(`${dim}Reporter: ${submission.reporter_email || 'unknown'}${reset}`);
  console.log(`${dim}Content length: ${submission.raw_content?.length || 0} chars${reset}`);

  if (!dryRun) {
    await pool.query(
      `UPDATE trapper.trapper_report_submissions SET extraction_status = 'extracting' WHERE submission_id = $1`,
      [submission.submission_id]
    );
  }

  // 1. Call AI extraction
  console.log(`${dim}Calling AI for extraction...${reset}`);
  const extraction = await extractWithAI(anthropic, submission.raw_content, submission.reporter_email);

  if (!extraction) {
    console.log(`${yellow}No extraction result${reset}`);
    if (!dryRun) {
      await pool.query(
        `UPDATE trapper.trapper_report_submissions SET extraction_status = 'failed', extraction_error = $2 WHERE submission_id = $1`,
        [submission.submission_id, 'AI extraction returned null']
      );
    }
    return { success: false, error: 'No extraction' };
  }

  console.log(`${green}AI extracted ${extraction.site_updates?.length || 0} sites${reset}`);
  console.log(`${dim}Overall confidence: ${extraction.overall_confidence}${reset}`);

  if (dryRun) {
    console.log(`\n${bold}Extraction Preview:${reset}`);
    console.log(JSON.stringify(extraction, null, 2));
    return { success: true, extraction, dryRun: true };
  }

  // 2. Match reporter
  const reporterCandidates = await matchReporter(pool, submission.reporter_email, null);
  const topReporter = reporterCandidates[0];

  if (topReporter) {
    console.log(`${green}Matched reporter: ${topReporter.display_name} (${(topReporter.match_score * 100).toFixed(0)}%)${reset}`);
  } else {
    console.log(`${yellow}No reporter match found${reset}`);
  }

  let itemsCreated = 0;

  // 3. Process each site update
  for (const site of extraction.site_updates || []) {
    console.log(`\n${cyan}Processing site: ${site.address}${reset}`);
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

    // Match place
    const placeCandidates = await matchPlace(pool, site.address, site.resident_name, topReporter?.person_id);
    const topPlace = placeCandidates[0];

    if (topPlace) {
      console.log(`${green}  Matched place: ${topPlace.formatted_address.substring(0, 50)}... (${(topPlace.match_score * 100).toFixed(0)}%)${reset}`);
    } else {
      console.log(`${yellow}  No place match for "${site.address}"${reset}`);
    }

    // Match request if place found
    let requestCandidates = [];
    if (topPlace?.place_id) {
      requestCandidates = await matchRequest(pool, topPlace.place_id, site.resident_name, topReporter?.person_id);
      if (requestCandidates[0]) {
        console.log(`${green}  Matched request: ${requestCandidates[0].request_id.substring(0, 8)}... (${requestCandidates[0].status})${reset}`);
      }
    }

    // Create items for review
    const itemsToCreate = [];

    // Status update item
    if (site.status_recommendation && requestCandidates[0]) {
      itemsToCreate.push({
        item_type: 'request_status',
        target_entity_type: 'request',
        target_entity_id: requestCandidates[0].request_id,
        match_confidence: requestCandidates[0].match_score,
        match_candidates: requestCandidates,
        extracted_data: {
          status: site.status_recommendation,
          hold_reason: site.hold_reason,
          note: site.qualitative_notes
        }
      });
    }

    // Colony estimate item
    if (site.cats_remaining || site.cats_trapped) {
      itemsToCreate.push({
        item_type: 'colony_estimate',
        target_entity_type: 'place',
        target_entity_id: topPlace?.place_id,
        match_confidence: topPlace?.match_score,
        match_candidates: placeCandidates,
        extracted_data: {
          cats_trapped: site.cats_trapped,
          cats_remaining: site.cats_remaining,
          observation_date: new Date().toISOString().split('T')[0],
          notes: site.qualitative_notes
        }
      });
    }

    // Site relationship items
    if (site.related_sites?.length > 0) {
      for (const relatedAddr of site.related_sites) {
        const relatedPlaces = await matchPlace(pool, relatedAddr, null, topReporter?.person_id);
        if (relatedPlaces[0]?.place_id && topPlace?.place_id && relatedPlaces[0].place_id !== topPlace.place_id) {
          itemsToCreate.push({
            item_type: 'site_relationship',
            target_entity_type: 'place',
            target_entity_id: topPlace.place_id,
            match_confidence: Math.min(topPlace.match_score, relatedPlaces[0].match_score),
            match_candidates: [topPlace, relatedPlaces[0]],
            extracted_data: {
              related_place_id: relatedPlaces[0].place_id,
              related_address: relatedAddr,
              note: 'Cats migrating between sites'
            }
          });
        }
      }
    }

    // Insert items
    for (const item of itemsToCreate) {
      await pool.query(`
        INSERT INTO trapper.trapper_report_items (
          submission_id, item_type,
          target_entity_type, target_entity_id, match_confidence, match_candidates,
          extracted_text, extracted_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        submission.submission_id,
        item.item_type,
        item.target_entity_type,
        item.target_entity_id,
        item.match_confidence,
        JSON.stringify(item.match_candidates),
        site.original_text,
        JSON.stringify(item.extracted_data)
      ]);
      itemsCreated++;
    }

    console.log(`${dim}  Created ${itemsToCreate.length} review items${reset}`);
  }

  // 4. Handle reporter email update
  if (extraction.reporter_updates?.new_email && topReporter) {
    await pool.query(`
      INSERT INTO trapper.trapper_report_items (
        submission_id, item_type,
        target_entity_type, target_entity_id, match_confidence, match_candidates,
        extracted_data
      ) VALUES ($1, 'person_identifier', 'person', $2, $3, $4, $5)
    `, [
      submission.submission_id,
      topReporter.person_id,
      topReporter.match_score,
      JSON.stringify(reporterCandidates),
      JSON.stringify({ id_type: 'email', id_value: extraction.reporter_updates.new_email })
    ]);
    itemsCreated++;
    console.log(`${green}Created email update item: ${extraction.reporter_updates.new_email}${reset}`);
  }

  // 5. Update submission as extracted
  await pool.query(`
    UPDATE trapper.trapper_report_submissions
    SET
      extraction_status = 'extracted',
      extracted_at = NOW(),
      ai_extraction = $2,
      reporter_person_id = $3,
      reporter_match_confidence = $4,
      reporter_match_candidates = $5
    WHERE submission_id = $1
  `, [
    submission.submission_id,
    JSON.stringify(extraction),
    topReporter?.person_id,
    topReporter?.match_score,
    JSON.stringify(reporterCandidates)
  ]);

  console.log(`\n${green}${bold}Extraction complete: ${itemsCreated} items created for review${reset}`);

  return {
    success: true,
    extraction,
    itemsCreated,
    reporterMatched: !!topReporter,
    sitesProcessed: extraction.site_updates?.length || 0
  };
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
${bold}Extract Trapper Reports${reset}

Usage:
  node scripts/jobs/extract_trapper_reports.mjs --submission-id UUID
  node scripts/jobs/extract_trapper_reports.mjs --pending [--limit N]
  node scripts/jobs/extract_trapper_reports.mjs --dry-run --submission-id UUID

Options:
  --submission-id UUID  Process a specific submission
  --pending             Process all pending submissions
  --limit N             Limit number of submissions (default: 10)
  --dry-run             Preview extraction without saving
  --help                Show this help

Environment:
  DATABASE_URL          Postgres connection string
  ANTHROPIC_API_KEY     Anthropic API key
`);
    process.exit(0);
  }

  if (!args.submissionId && !args.pending) {
    console.error(`${red}Error: Must specify --submission-id or --pending${reset}`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const anthropic = new Anthropic();

  try {
    let submissions;

    if (args.submissionId) {
      const { rows } = await pool.query(
        `SELECT * FROM trapper.trapper_report_submissions WHERE submission_id = $1`,
        [args.submissionId]
      );
      submissions = rows;
    } else {
      const { rows } = await pool.query(
        `SELECT * FROM trapper.trapper_report_submissions
         WHERE extraction_status = 'pending'
         ORDER BY received_at
         LIMIT $1`,
        [args.limit]
      );
      submissions = rows;
    }

    if (submissions.length === 0) {
      console.log(`${yellow}No submissions to process${reset}`);
      process.exit(0);
    }

    console.log(`${bold}Processing ${submissions.length} submission(s)${args.dryRun ? ' (DRY RUN)' : ''}${reset}`);

    let totalItems = 0;
    let successCount = 0;

    for (const submission of submissions) {
      try {
        const result = await processSubmission(pool, anthropic, submission, args.dryRun);
        if (result.success) {
          successCount++;
          totalItems += result.itemsCreated || 0;
        }
      } catch (error) {
        console.error(`${red}Error processing ${submission.submission_id}: ${error.message}${reset}`);
        if (!args.dryRun) {
          await pool.query(
            `UPDATE trapper.trapper_report_submissions SET extraction_status = 'failed', extraction_error = $2 WHERE submission_id = $1`,
            [submission.submission_id, error.message]
          );
        }
      }

      // Rate limit between submissions
      if (submissions.length > 1) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      }
    }

    console.log(`\n${bold}Summary:${reset}`);
    console.log(`  Submissions processed: ${successCount}/${submissions.length}`);
    console.log(`  Review items created: ${totalItems}`);

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`${red}Fatal error: ${err.message}${reset}`);
  process.exit(1);
});
