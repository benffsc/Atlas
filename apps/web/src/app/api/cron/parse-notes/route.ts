import { NextRequest, NextResponse } from "next/server";
import { query, queryRows, queryOne } from "@/lib/db";

/**
 * Parse Notes Cron Job
 *
 * Comprehensive note parsing for Beacon data extraction:
 *
 * 1. Colony Size Estimates (P1)
 *    - "colony of N cats", "feeds N cats", "N with ear tips"
 *    - Source: request notes, intake submissions
 *
 * 2. Reproduction Indicators (P2)
 *    - pregnant, lactating, nursing, in heat, kittens
 *    - Source: appointment notes, cat vitals
 *
 * 3. Mortality Data (P3)
 *    - died, deceased, HBC, predator, euthanized
 *    - Source: all note fields, KML data
 *
 * This is a simplified SQL-based version of the full parser scripts.
 * For comprehensive parsing, run the Node.js scripts manually:
 *   - parse_pregnancy_nursing_notes.mjs
 *   - parse_mortality_notes.mjs
 *
 * Run: Weekly or after major data imports
 */

export const maxDuration = 120; // Allow up to 2 minutes

const CRON_SECRET = process.env.CRON_SECRET;

interface ParsedEstimate {
  source_id: string;
  source_type: string;
  place_id: string;
  total_cats: number | null;
  eartip_count: number | null;
  notes_snippet: string;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    // Colony estimates
    request_notes_parsed: 0,
    intake_situations_parsed: 0,
    estimates_created: 0,
    // Reproduction
    reproduction_indicators_found: 0,
    vitals_updated: 0,
    // Mortality
    mortality_mentions_found: 0,
    mortality_events_created: 0,
    // General
    errors: [] as string[],
  };

  try {
    // ============================================================
    // 1. Parse Request Notes (internal_notes, notes, legacy_notes)
    // ============================================================

    // Find requests with notes that haven't been parsed yet
    // (no colony estimate with source_type = 'internal_notes_parse' for this request)
    const requestEstimates = await queryRows<ParsedEstimate>(`
      WITH parseable_requests AS (
        SELECT
          r.request_id::TEXT AS source_id,
          'internal_notes_parse' AS source_type,
          r.place_id,
          COALESCE(r.internal_notes, '') || ' ' ||
          COALESCE(r.notes, '') || ' ' ||
          COALESCE(r.legacy_notes, '') AS combined_notes
        FROM ops.requests r
        WHERE r.place_id IS NOT NULL
          AND (r.internal_notes IS NOT NULL OR r.notes IS NOT NULL OR r.legacy_notes IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM sot.place_colony_estimates pce
            WHERE pce.place_id = r.place_id
              AND pce.source_record_id = r.request_id::TEXT
              AND pce.source_type = 'internal_notes_parse'
          )
        ORDER BY r.created_at DESC
        LIMIT 500
      )
      SELECT
        source_id,
        source_type,
        place_id,
        -- Extract cat count using common patterns
        CASE
          WHEN combined_notes ~* 'colony of (?:about |approximately )?([0-9]+)'
            THEN (regexp_match(combined_notes, 'colony of (?:about |approximately )?([0-9]+)', 'i'))[1]::INT
          WHEN combined_notes ~* 'feeds? (?:about )?([0-9]+) ?cats?'
            THEN (regexp_match(combined_notes, 'feeds? (?:about )?([0-9]+)', 'i'))[1]::INT
          WHEN combined_notes ~* '(?:about|approximately|around|~) ?([0-9]+) ?cats?'
            THEN (regexp_match(combined_notes, '(?:about|approximately|around|~) ?([0-9]+) ?cats?', 'i'))[1]::INT
          WHEN combined_notes ~* '([0-9]+) cats? total'
            THEN (regexp_match(combined_notes, '([0-9]+) cats? total', 'i'))[1]::INT
          ELSE NULL
        END AS total_cats,
        -- Extract eartip count
        CASE
          WHEN combined_notes ~* '([0-9]+) ?(?:with )?ear-?tips?'
            THEN (regexp_match(combined_notes, '([0-9]+) ?(?:with )?ear-?tips?', 'i'))[1]::INT
          WHEN combined_notes ~* '([0-9]+) already (?:ear-?)?tipped'
            THEN (regexp_match(combined_notes, '([0-9]+) already', 'i'))[1]::INT
          ELSE NULL
        END AS eartip_count,
        LEFT(combined_notes, 200) AS notes_snippet
      FROM parseable_requests
      WHERE combined_notes ~* '([0-9]+).*(cats?|colony|feeds?|ear-?tip)'
    `);

    results.request_notes_parsed = requestEstimates.length;

    // Insert parsed estimates
    for (const est of requestEstimates) {
      if (est.total_cats || est.eartip_count) {
        try {
          await query(`
            INSERT INTO sot.place_colony_estimates (
              place_id,
              total_cats,
              eartip_count_observed,
              source_type,
              source_system,
              source_record_id,
              notes,
              observation_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE)
            ON CONFLICT DO NOTHING
          `, [
            est.place_id,
            est.total_cats,
            est.eartip_count,
            'internal_notes_parse',
            'notes_parser_cron',
            est.source_id,
            `Auto-extracted from request notes: ${est.notes_snippet?.slice(0, 100)}...`,
          ]);
          results.estimates_created++;
        } catch (err) {
          results.errors.push(`Request ${est.source_id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    // ============================================================
    // 2. Parse Intake Situation Descriptions
    // ============================================================

    const intakeEstimates = await queryRows<ParsedEstimate>(`
      WITH parseable_intakes AS (
        SELECT
          s.submission_id::TEXT AS source_id,
          'intake_situation_parse' AS source_type,
          s.place_id,
          COALESCE(s.situation_description, '') AS combined_notes
        FROM ops.intake_submissions s
        WHERE s.place_id IS NOT NULL
          AND s.situation_description IS NOT NULL
          AND LENGTH(s.situation_description) > 20
          AND NOT EXISTS (
            SELECT 1 FROM sot.place_colony_estimates pce
            WHERE pce.place_id = s.place_id
              AND pce.source_record_id = s.submission_id::TEXT
              AND pce.source_type = 'intake_situation_parse'
          )
        ORDER BY s.submitted_at DESC
        LIMIT 500
      )
      SELECT
        source_id,
        source_type,
        place_id,
        -- Extract cat count using common patterns
        CASE
          WHEN combined_notes ~* '([0-9]+) ?(?:stray |feral |outdoor )?cats?'
            THEN (regexp_match(combined_notes, '([0-9]+) ?(?:stray |feral |outdoor )?cats?', 'i'))[1]::INT
          WHEN combined_notes ~* 'colony of (?:about )?([0-9]+)'
            THEN (regexp_match(combined_notes, 'colony of (?:about )?([0-9]+)', 'i'))[1]::INT
          WHEN combined_notes ~* '(?:about|approximately|around) ([0-9]+)'
            THEN (regexp_match(combined_notes, '(?:about|approximately|around) ([0-9]+)', 'i'))[1]::INT
          ELSE NULL
        END AS total_cats,
        -- Extract eartip count
        CASE
          WHEN combined_notes ~* '([0-9]+) ?(?:are |with )?(?:ear-?tipped|fixed|altered)'
            THEN (regexp_match(combined_notes, '([0-9]+) ?(?:are |with )?(?:ear-?tipped|fixed|altered)', 'i'))[1]::INT
          ELSE NULL
        END AS eartip_count,
        LEFT(combined_notes, 200) AS notes_snippet
      FROM parseable_intakes
      WHERE combined_notes ~* '([0-9]+).*(cats?|colony|stray|feral)'
    `);

    results.intake_situations_parsed = intakeEstimates.length;

    // Insert parsed intake estimates
    for (const est of intakeEstimates) {
      if (est.total_cats || est.eartip_count) {
        try {
          await query(`
            INSERT INTO sot.place_colony_estimates (
              place_id,
              total_cats,
              eartip_count_observed,
              source_type,
              source_system,
              source_record_id,
              notes,
              observation_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE)
            ON CONFLICT DO NOTHING
          `, [
            est.place_id,
            est.total_cats,
            est.eartip_count,
            'intake_situation_parse',
            'notes_parser_cron',
            est.source_id,
            `Auto-extracted from intake: ${est.notes_snippet?.slice(0, 100)}...`,
          ]);
          results.estimates_created++;
        } catch (err) {
          results.errors.push(`Intake ${est.source_id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    // ============================================================
    // 3. Parse Reproduction Indicators from Appointment Notes (P2)
    // ============================================================

    try {
      // Check if cat_vitals table exists
      const vitalsTableExists = await queryOne<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'trapper' AND table_name = 'cat_vitals'
        ) AS exists
      `);

      if (vitalsTableExists?.exists) {
        // Find spay appointments with reproduction keywords that haven't been processed
        const reproductionIndicators = await queryRows<{
          appointment_id: string;
          cat_id: string;
          appointment_date: string;
          is_pregnant: boolean;
          is_lactating: boolean;
          is_in_heat: boolean;
        }>(`
          SELECT
            a.appointment_id::TEXT,
            a.cat_id::TEXT,
            a.appointment_date::TEXT,
            (COALESCE(a.internal_notes, '') || ' ' || COALESCE(a.medical_notes, ''))
              ~* '\\m(pregnant|gravid|expecting|with kittens|preg)\\M' AS is_pregnant,
            (COALESCE(a.internal_notes, '') || ' ' || COALESCE(a.medical_notes, ''))
              ~* '\\m(lactating|nursing|with litter|feeding kittens|milk present|mammary)\\M' AS is_lactating,
            (COALESCE(a.internal_notes, '') || ' ' || COALESCE(a.medical_notes, ''))
              ~* '\\m(in heat|estrus|calling|lordosis)\\M' AS is_in_heat
          FROM ops.appointments a
          WHERE a.is_spay = TRUE
            AND a.cat_id IS NOT NULL
            AND (a.internal_notes IS NOT NULL OR a.medical_notes IS NOT NULL)
            AND NOT EXISTS (
              SELECT 1 FROM ops.cat_vitals cv
              WHERE cv.cat_id = a.cat_id
                AND cv.recorded_at::DATE = a.appointment_date::DATE
                AND cv.source_system = 'notes_parser_cron'
            )
          LIMIT 200
        `);

        for (const ind of reproductionIndicators) {
          if (ind.is_pregnant || ind.is_lactating || ind.is_in_heat) {
            results.reproduction_indicators_found++;
            try {
              await query(`
                INSERT INTO ops.cat_vitals (
                  cat_id,
                  recorded_at,
                  is_pregnant,
                  is_lactating,
                  is_in_heat,
                  source_system,
                  source_record_id
                ) VALUES ($1, $2::DATE, $3, $4, $5, 'notes_parser_cron', $6)
                ON CONFLICT DO NOTHING
              `, [
                ind.cat_id,
                ind.appointment_date,
                ind.is_pregnant || null,
                ind.is_lactating || null,
                ind.is_in_heat || null,
                ind.appointment_id,
              ]);
              results.vitals_updated++;
            } catch (err) {
              results.errors.push(`Vitals ${ind.appointment_id}: ${err instanceof Error ? err.message : 'Unknown'}`);
            }
          }
        }
      }
    } catch (err) {
      // cat_vitals may not exist - that's OK
      results.errors.push(`Reproduction parsing: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // ============================================================
    // 4. Parse Mortality Indicators (P3)
    // ============================================================

    try {
      // Check if cat_mortality_events table exists
      const mortalityTableExists = await queryOne<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'trapper' AND table_name = 'cat_mortality_events'
        ) AS exists
      `);

      if (mortalityTableExists?.exists) {
        // Parse mortality from request notes
        const mortalityMentions = await queryRows<{
          request_id: string;
          place_id: string;
          death_cause: string;
          notes_snippet: string;
        }>(`
          WITH parseable AS (
            SELECT
              r.request_id::TEXT,
              r.place_id::TEXT,
              COALESCE(r.internal_notes, '') || ' ' ||
              COALESCE(r.notes, '') || ' ' ||
              COALESCE(r.legacy_notes, '') AS combined,
              CASE
                WHEN COALESCE(r.internal_notes, '') || ' ' || COALESCE(r.notes, '') || ' ' || COALESCE(r.legacy_notes, '')
                  ~* '\\m(hit by car|HBC|run over|vehicle)\\M' THEN 'vehicle'
                WHEN COALESCE(r.internal_notes, '') || ' ' || COALESCE(r.notes, '') || ' ' || COALESCE(r.legacy_notes, '')
                  ~* '\\m(coyote|predator|dog attack)\\M' THEN 'predator'
                WHEN COALESCE(r.internal_notes, '') || ' ' || COALESCE(r.notes, '') || ' ' || COALESCE(r.legacy_notes, '')
                  ~* '\\m(euthanized|euthanasia|PTS|put to sleep|put down)\\M' THEN 'euthanasia'
                WHEN COALESCE(r.internal_notes, '') || ' ' || COALESCE(r.notes, '') || ' ' || COALESCE(r.legacy_notes, '')
                  ~* '\\m(FeLV|FIV|disease|illness)\\M' THEN 'disease'
                WHEN COALESCE(r.internal_notes, '') || ' ' || COALESCE(r.notes, '') || ' ' || COALESCE(r.legacy_notes, '')
                  ~* '\\m(died|death|deceased|passed away|found dead|RIP)\\M' THEN 'unknown'
                ELSE NULL
              END AS death_cause
            FROM ops.requests r
            WHERE r.place_id IS NOT NULL
              AND (r.internal_notes IS NOT NULL OR r.notes IS NOT NULL OR r.legacy_notes IS NOT NULL)
              AND NOT EXISTS (
                SELECT 1 FROM sot.cat_mortality_events cme
                WHERE cme.source_record_id = r.request_id::TEXT
                  AND cme.source_system = 'notes_parser_cron'
              )
            LIMIT 200
          )
          SELECT
            request_id,
            place_id,
            death_cause,
            LEFT(combined, 150) AS notes_snippet
          FROM parseable
          WHERE death_cause IS NOT NULL
        `);

        results.mortality_mentions_found = mortalityMentions.length;

        for (const m of mortalityMentions) {
          try {
            await query(`
              INSERT INTO sot.cat_mortality_events (
                cat_id,
                place_id,
                death_date,
                death_date_precision,
                death_cause,
                death_age_category,
                reported_by,
                source_system,
                source_record_id,
                notes
              ) VALUES (
                NULL,
                $1,
                CURRENT_DATE,
                'estimated',
                $2,
                'adult',
                'notes_parser_cron',
                'notes_parser_cron',
                $3,
                $4
              )
              ON CONFLICT DO NOTHING
            `, [
              m.place_id,
              m.death_cause,
              m.request_id,
              `Auto-extracted: ${m.notes_snippet}...`,
            ]);
            results.mortality_events_created++;
          } catch (err) {
            results.errors.push(`Mortality ${m.request_id}: ${err instanceof Error ? err.message : 'Unknown'}`);
          }
        }
      }
    } catch (err) {
      // cat_mortality_events may not exist - that's OK
      results.errors.push(`Mortality parsing: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // ============================================================
    // 5. Log run to ingest_runs table (if it exists)
    // ============================================================

    try {
      await query(`
        INSERT INTO ops.ingest_runs (
          source_system,
          run_type,
          started_at,
          completed_at,
          records_processed,
          records_created,
          status,
          notes
        ) VALUES (
          'notes_parser_cron',
          'incremental',
          NOW() - INTERVAL '${Date.now() - startTime} milliseconds',
          NOW(),
          $1,
          $2,
          'completed',
          $3
        )
      `, [
        results.request_notes_parsed + results.intake_situations_parsed,
        results.estimates_created,
        `Colony: ${results.estimates_created} estimates. Repro: ${results.vitals_updated} vitals. Mortality: ${results.mortality_events_created} events.`,
      ]);
    } catch {
      // ingest_runs table may not exist - that's OK
    }

    const totalParsed = results.request_notes_parsed + results.intake_situations_parsed + results.reproduction_indicators_found + results.mortality_mentions_found;
    const totalCreated = results.estimates_created + results.vitals_updated + results.mortality_events_created;

    return NextResponse.json({
      success: true,
      ...results,
      duration_ms: Date.now() - startTime,
      message: `Parsed ${totalParsed} records: ${results.estimates_created} colony estimates, ${results.vitals_updated} repro vitals, ${results.mortality_events_created} mortality events`,
    });

  } catch (error) {
    console.error("Parse notes cron error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      ...results,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
