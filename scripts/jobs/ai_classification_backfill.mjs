#!/usr/bin/env node
/**
 * AI-Powered Classification Backfill
 *
 * REUSABLE PATTERN: This script demonstrates how to use Claude AI to enrich data
 * by analyzing multiple data sources and making intelligent inferences. This pattern
 * can be reused for other enrichment tasks.
 *
 * ## Architecture
 *
 * 1. **Data Collection** (`getPlaceContext()`) - Gathers all relevant data for an entity
 * 2. **Prompt Construction** (`analyzeWithClaude()`) - Builds structured prompt with data
 * 3. **AI Analysis** - Claude returns structured JSON with classification + confidence
 * 4. **Application** (`applyClassification()`) - Saves results, auto-applies high confidence
 *
 * ## Data Sources Currently Analyzed
 *
 * - Google Maps qualitative notes (within 200m)
 * - Project 75 post-clinic survey data
 * - Appointment history (cat counts, time spans, owner patterns)
 * - Request history and notes
 * - Colony estimates from all sources
 *
 * ## Future Extension: ClinicHQ API
 *
 * When ClinicHQ API access is available, add to `getPlaceContext()`:
 *
 * ```javascript
 * // Get real-time appointment data from ClinicHQ
 * const clinicHQResult = await fetchFromClinicHQ({
 *   endpoint: '/appointments',
 *   filters: { address_like: place.formatted_address }
 * });
 *
 * // Add to context
 * return {
 *   ...existingContext,
 *   clinicHQ: {
 *     recentAppointments: clinicHQResult.appointments,
 *     pendingBookings: clinicHQResult.pending,
 *     historicalNotes: clinicHQResult.notes
 *   }
 * };
 * ```
 *
 * Then update the prompt in `analyzeWithClaude()` to include this data:
 *
 * ```
 * ### ClinicHQ Real-Time Data
 * ${context.clinicHQ ? formatClinicHQData(context.clinicHQ) : "No ClinicHQ data."}
 * ```
 *
 * ## Extending for Other Enrichment Tasks
 *
 * This pattern can be adapted for:
 * - Person deduplication suggestions
 * - Cat identity matching (same cat, different appointments)
 * - Colony boundary estimation
 * - Priority scoring for requests
 *
 * ## Usage
 *
 *   export $(grep -v '^#' .env | xargs)
 *   node scripts/jobs/ai_classification_backfill.mjs --limit 50 --dry-run
 *
 * ## Options
 *
 *   --limit N       Process N places (default: 50)
 *   --dry-run       Show what would be done without making changes
 *   --min-confidence Only process places with confidence below this (default: 0.7)
 *   --place-id UUID Process only this specific place
 */

import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";
import { parseArgs } from "node:util";

const { Pool } = pg;

// Parse arguments
const { values: args } = parseArgs({
  options: {
    limit: { type: "string", default: "50" },
    "dry-run": { type: "boolean", default: false },
    "min-confidence": { type: "string", default: "0.7" },
    "place-id": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`
AI-Powered Classification Backfill

Uses Claude AI to analyze Google Maps notes, Project 75 surveys, appointment
history, and request notes to suggest better classifications for places.

Usage:
  node scripts/jobs/ai_classification_backfill.mjs [options]

Options:
  --limit N          Process N places (default: 50)
  --dry-run          Show what would be done without making changes
  --min-confidence N Only process places with suggestion confidence below N (default: 0.7)
  --place-id UUID    Process only a specific place
  -h, --help         Show this help
  `);
  process.exit(0);
}

const LIMIT = parseInt(args.limit);
const DRY_RUN = args["dry-run"];
const MIN_CONFIDENCE = parseFloat(args["min-confidence"]);
const SPECIFIC_PLACE = args["place-id"];

// Initialize clients
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const anthropic = new Anthropic();

const CLASSIFICATION_DESCRIPTIONS = {
  individual_cats: "Specific known cats - exact count known, no ecology estimation needed. Example: Crystal's 2 cats that she knows by name.",
  small_colony: "Established small group of 3-10 cats. Light weighted estimation.",
  large_colony: "Large established colony of 10+ cats. Full ecology estimation with Chapman mark-recapture if data available.",
  feeding_station: "Known feeding location that attracts cats from the surrounding area. Geographic cluster point.",
};

async function getPlacesToProcess() {
  let sql;
  const params = [];

  if (SPECIFIC_PLACE) {
    sql = `
      SELECT
        p.place_id,
        p.formatted_address,
        p.display_name,
        p.colony_classification::TEXT,
        pnc.avg_confidence,
        pnc.most_common_suggestion AS suggested_classification
      FROM sot.places p
      LEFT JOIN sot.v_places_needing_classification pnc ON pnc.place_id = p.place_id
      WHERE p.place_id = $1
    `;
    params.push(SPECIFIC_PLACE);
  } else {
    sql = `
      SELECT
        p.place_id,
        p.formatted_address,
        p.display_name,
        p.colony_classification::TEXT,
        pnc.avg_confidence,
        pnc.most_common_suggestion AS suggested_classification
      FROM sot.places p
      LEFT JOIN sot.v_places_needing_classification pnc ON pnc.place_id = p.place_id
      WHERE p.merged_into_place_id IS NULL
        AND (
          p.colony_classification IS NULL
          OR p.colony_classification = 'unknown'
          OR (pnc.avg_confidence IS NOT NULL AND pnc.avg_confidence < $1)
        )
      ORDER BY
        CASE WHEN pnc.avg_confidence IS NULL THEN 1 ELSE 0 END,
        pnc.avg_confidence ASC NULLS LAST
      LIMIT $2
    `;
    params.push(MIN_CONFIDENCE, LIMIT);
  }

  const result = await pool.query(sql, params);
  return result.rows;
}

async function getPlaceContext(placeId) {
  // Get Google Maps entries nearby (within 200m)
  const googleMapsResult = await pool.query(`
    SELECT
      gme.original_content AS notes,
      gme.ai_summary,
      gme.parsed_date AS entry_date,
      ST_Distance(
        p.location::geography,
        ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography
      )::INT AS distance_meters
    FROM ops.google_map_entries gme
    CROSS JOIN sot.places p
    WHERE p.place_id = $1
      AND p.location IS NOT NULL
      AND gme.lat IS NOT NULL
      AND ST_DWithin(
        p.location::geography,
        ST_SetSRID(ST_MakePoint(gme.lng, gme.lat), 4326)::geography,
        200
      )
    ORDER BY distance_meters
    LIMIT 10
  `, [placeId]);

  // Get Project 75 survey data
  const surveysResult = await pool.query(`
    SELECT
      pce.total_cats,
      pce.total_cats_observed,
      pce.eartip_count_observed,
      pce.notes,
      pce.observation_date,
      pce.source_type
    FROM sot.place_colony_estimates pce
    WHERE pce.place_id = $1
    ORDER BY pce.observation_date DESC NULLS LAST
    LIMIT 10
  `, [placeId]);

  // Get appointment history
  const appointmentsResult = await pool.query(`
    SELECT
      COUNT(DISTINCT a.cat_id) AS total_cats,
      COUNT(DISTINCT a.cat_id) FILTER (WHERE c.altered_status = 'Yes') AS altered_cats,
      COUNT(DISTINCT DATE_TRUNC('month', a.appointment_date)) AS months_with_appointments,
      MIN(a.appointment_date) AS first_appointment,
      MAX(a.appointment_date) AS last_appointment,
      COUNT(DISTINCT a.owner_email) AS distinct_owners,
      array_agg(DISTINCT COALESCE(a.medical_notes, '')) FILTER (WHERE a.medical_notes IS NOT NULL AND a.medical_notes != '') AS medical_notes
    FROM ops.appointments a
    JOIN sot.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
    JOIN sot.cats c ON c.cat_id = a.cat_id
    WHERE cpr.place_id = $1
    GROUP BY cpr.place_id
  `, [placeId]);

  // Get request history
  const requestsResult = await pool.query(`
    SELECT
      r.request_id,
      r.summary,
      r.notes,
      r.estimated_cat_count,
      r.has_kittens,
      r.is_being_fed,
      r.feeding_schedule,
      r.colony_duration,
      r.count_confidence,
      r.created_at,
      r.status::TEXT
    FROM ops.requests r
    WHERE r.place_id = $1
      AND r.status NOT IN ('cancelled', 'redirected')
    ORDER BY r.created_at DESC
    LIMIT 10
  `, [placeId]);

  return {
    googleMaps: googleMapsResult.rows,
    surveys: surveysResult.rows,
    appointments: appointmentsResult.rows[0] || null,
    requests: requestsResult.rows,
  };
}

async function analyzeWithClaude(place, context) {
  const prompt = `You are analyzing a location to determine the appropriate colony classification for a TNR (Trap-Neuter-Return) cat management system.

## Classification Types

${Object.entries(CLASSIFICATION_DESCRIPTIONS).map(([key, desc]) => `- **${key}**: ${desc}`).join("\n")}

## Location Information

**Address:** ${place.formatted_address}
${place.display_name ? `**Name:** ${place.display_name}` : ""}
**Current Classification:** ${place.colony_classification || "unknown"}

## Data Sources

### Google Maps Notes (within 200m)
${context.googleMaps.length > 0
  ? context.googleMaps.map(g => `- "${g.notes || g.ai_summary}" (${g.distance_meters}m away, ${g.entry_date || "date unknown"})`).join("\n")
  : "No Google Maps entries found nearby."}

### Colony Estimates & Surveys
${context.surveys.length > 0
  ? context.surveys.map(s => `- ${s.source_type}: ${s.total_cats || s.total_cats_observed || "?"} cats${s.eartip_count_observed ? `, ${s.eartip_count_observed} ear-tipped` : ""} (${s.observation_date || "date unknown"})${s.notes ? ` - "${s.notes}"` : ""}`).join("\n")
  : "No colony estimates recorded."}

### Appointment History
${context.appointments
  ? `- ${context.appointments.total_cats} cats seen, ${context.appointments.altered_cats} altered
- Activity span: ${context.appointments.first_appointment} to ${context.appointments.last_appointment}
- ${context.appointments.months_with_appointments} months with appointments
- ${context.appointments.distinct_owners} distinct owner email(s)
${context.appointments.medical_notes?.length > 0 ? `- Notes: ${context.appointments.medical_notes.slice(0, 3).map(n => `"${n.substring(0, 100)}"`).join(", ")}` : ""}`
  : "No appointment history found."}

### Request History
${context.requests.length > 0
  ? context.requests.map(r => `- ${r.status}: ${r.estimated_cat_count || "?"} cats${r.colony_duration ? `, ${r.colony_duration} duration` : ""}${r.count_confidence ? `, ${r.count_confidence} count` : ""}${r.has_kittens ? ", has kittens" : ""}${r.is_being_fed ? ", being fed" : ""}${r.feeding_schedule ? ` (${r.feeding_schedule})` : ""} (${new Date(r.created_at).toLocaleDateString()})${r.summary ? ` - "${r.summary.substring(0, 100)}"` : ""}`).join("\n")
  : "No requests found for this location."}

## Your Task

Based on ALL available data, determine the most appropriate classification. Consider:

1. **Cat count patterns**: Is this 1-2 specific cats (individual_cats), 3-10 (small_colony), or 10+ (large_colony)?
2. **Count confidence**: "exact" counts suggest individual_cats (person knows specific cats). "rough_guess" suggests colony.
3. **Colony duration**: "over_2_years" or "6_to_24_months" suggests established colony. "under_1_month" suggests newcomer/individual.
4. **Google Maps context**: Colony language ("feeding station", "colony", "been here for years") strongly suggests colony.
5. **Multiple requests**: Multiple requests at same place over time suggests colony, not individuals.
6. **Appointment patterns**: Many cats coming in over months/years from same address suggests colony.
7. **Feeding patterns**: Regular feeding schedule with multiple cats suggests feeding station or colony.

Return your analysis as JSON with these exact fields:
{
  "classification": "individual_cats" | "small_colony" | "large_colony" | "feeding_station",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why this classification fits",
  "key_signals": ["signal1", "signal2", ...]
}

If there's genuinely insufficient data to classify with any confidence, use:
{
  "classification": "unknown",
  "confidence": 0.0,
  "reasoning": "Insufficient data to determine classification",
  "key_signals": []
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  // Extract JSON from response
  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to extract JSON from response: ${text}`);
  }

  return JSON.parse(jsonMatch[0]);
}

async function applyClassification(placeId, classification, confidence, reasoning, keySignals) {
  // Get the most recent request for this place to update
  const requestResult = await pool.query(`
    SELECT request_id
    FROM ops.requests
    WHERE place_id = $1
      AND status NOT IN ('cancelled', 'redirected')
    ORDER BY created_at DESC
    LIMIT 1
  `, [placeId]);

  const requestId = requestResult.rows[0]?.request_id;

  // Update request suggestion if exists
  if (requestId) {
    await pool.query(`
      UPDATE ops.requests
      SET suggested_classification = $1,
          classification_confidence = $2,
          classification_signals = $3,
          classification_disposition = CASE
            WHEN $2 >= 0.9 THEN 'accepted'
            ELSE 'pending'
          END,
          classification_suggested_at = NOW(),
          classification_reviewed_by = CASE
            WHEN $2 >= 0.9 THEN 'ai_backfill'
            ELSE NULL
          END,
          classification_reviewed_at = CASE
            WHEN $2 >= 0.9 THEN NOW()
            ELSE NULL
          END
      WHERE request_id = $4
    `, [
      classification,
      confidence,
      JSON.stringify({
        source: "ai_backfill",
        reasoning,
        key_signals: keySignals,
        analyzed_at: new Date().toISOString(),
      }),
      requestId,
    ]);
  }

  // Auto-apply to place if high confidence
  if (confidence >= 0.9) {
    await pool.query(`
      UPDATE sot.places
      SET colony_classification = $1,
          updated_at = NOW()
      WHERE place_id = $2
        AND (colony_classification IS NULL OR colony_classification = 'unknown')
    `, [classification, placeId]);
  }

  return { requestId, autoApplied: confidence >= 0.9 };
}

async function main() {
  console.log("=".repeat(60));
  console.log("AI-Powered Classification Backfill");
  console.log("=".repeat(60));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Limit: ${SPECIFIC_PLACE ? "1 (specific place)" : LIMIT}`);
  console.log(`Min confidence threshold: ${MIN_CONFIDENCE}`);
  console.log("");

  const places = await getPlacesToProcess();
  console.log(`Found ${places.length} places to analyze\n`);

  let processed = 0;
  let autoApplied = 0;
  let pending = 0;
  let skipped = 0;
  const results = [];

  for (const place of places) {
    console.log(`\n[${ processed + 1}/${places.length}] ${place.formatted_address}`);
    console.log(`  Current: ${place.colony_classification || "unknown"}, Existing suggestion confidence: ${place.avg_confidence || "none"}`);

    try {
      const context = await getPlaceContext(place.place_id);

      // Skip if no meaningful data
      const hasData = context.googleMaps.length > 0 ||
                      context.surveys.length > 0 ||
                      context.appointments ||
                      context.requests.length > 0;

      if (!hasData) {
        console.log("  -> Skipped: No data available");
        skipped++;
        continue;
      }

      console.log(`  Data: ${context.googleMaps.length} Google Maps, ${context.surveys.length} surveys, ${context.appointments ? "appointments" : "no appts"}, ${context.requests.length} requests`);

      const analysis = await analyzeWithClaude(place, context);
      console.log(`  -> AI suggests: ${analysis.classification} (${Math.round(analysis.confidence * 100)}%)`);
      console.log(`     Reasoning: ${analysis.reasoning}`);

      if (analysis.classification === "unknown") {
        console.log("  -> Skipped: Insufficient data for AI to classify");
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        const result = await applyClassification(
          place.place_id,
          analysis.classification,
          analysis.confidence,
          analysis.reasoning,
          analysis.key_signals
        );

        if (result.autoApplied) {
          console.log(`  -> AUTO-APPLIED to place`);
          autoApplied++;
        } else {
          console.log(`  -> Suggestion saved (pending review)`);
          pending++;
        }
      } else {
        console.log(`  -> [DRY RUN] Would ${analysis.confidence >= 0.9 ? "auto-apply" : "save as pending"}`);
        if (analysis.confidence >= 0.9) autoApplied++;
        else pending++;
      }

      results.push({
        place_id: place.place_id,
        address: place.formatted_address,
        old_classification: place.colony_classification,
        new_classification: analysis.classification,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
      });

      processed++;

      // Rate limiting - 1 request per second to avoid API limits
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`  -> ERROR: ${error.message}`);
      skipped++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Total processed: ${processed}`);
  console.log(`Auto-applied (90%+ confidence): ${autoApplied}`);
  console.log(`Pending review: ${pending}`);
  console.log(`Skipped (no data/error): ${skipped}`);

  if (results.length > 0) {
    console.log("\nClassification Distribution:");
    const dist = results.reduce((acc, r) => {
      acc[r.new_classification] = (acc[r.new_classification] || 0) + 1;
      return acc;
    }, {});
    Object.entries(dist).forEach(([cls, count]) => {
      console.log(`  ${cls}: ${count}`);
    });
  }

  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
