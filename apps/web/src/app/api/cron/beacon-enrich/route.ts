import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

/**
 * Beacon Data Enrichment Cron Job
 * ================================
 *
 * Populates Beacon data from various sources:
 *
 * 1. Birth Events (from lactating/pregnant appointments)
 *    - Mothers seen lactating → birth ~6 weeks prior
 *    - Mothers seen pregnant → birth ~8 weeks after
 *
 * 2. Mortality Events (from clinic euthanasia + field reports)
 *    - Clinic notes mentioning "euthanized", "died", "HBC"
 *
 * 3. Colony Estimates (from AI-parsed notes - handled by parse-notes cron)
 *
 * Run: Daily at 10 AM PT (after parse-notes)
 *
 * For AI-powered parsing (more accurate), run manually:
 *   node scripts/jobs/populate_birth_events_from_appointments.mjs
 *   node scripts/jobs/populate_mortality_from_clinic.mjs
 *   node scripts/jobs/parse_quantitative_data.mjs
 */

export const maxDuration = 120; // Allow up to 2 minutes

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    birth_events_created: 0,
    mortality_events_created: 0,
    cats_marked_deceased: 0,
    errors: [] as string[],
  };

  try {
    // ============================================================
    // 1. Create Birth Events from Lactating Appointments
    // ============================================================

    try {
      const birthResult = await query(`
        WITH lactating_mothers AS (
          SELECT DISTINCT ON (a.cat_id)
            a.appointment_id,
            a.appointment_date,
            a.cat_id,
            a.medical_notes,
            (
              SELECT cpr.place_id
              FROM sot.cat_place_relationships cpr
              WHERE cpr.cat_id = a.cat_id
              ORDER BY cpr.created_at DESC
              LIMIT 1
            ) as place_id
          FROM ops.appointments a
          JOIN sot.cats c ON c.cat_id = a.cat_id
          LEFT JOIN sot.cat_birth_events be ON be.mother_cat_id = a.cat_id
          WHERE a.is_lactating = true
            AND c.sex = 'Female'
            AND be.birth_event_id IS NULL
          ORDER BY a.cat_id, a.appointment_date DESC
          LIMIT 100
        )
        INSERT INTO sot.cat_birth_events (
          cat_id,
          mother_cat_id,
          birth_date,
          birth_date_precision,
          birth_year,
          birth_month,
          birth_season,
          place_id,
          source_system,
          source_record_id,
          reported_by,
          notes
        )
        SELECT
          NULL,
          cat_id,
          appointment_date - INTERVAL '42 days',
          'estimated',
          EXTRACT(YEAR FROM appointment_date - INTERVAL '42 days')::INT,
          EXTRACT(MONTH FROM appointment_date - INTERVAL '42 days')::INT,
          CASE
            WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '42 days') IN (3,4,5) THEN 'spring'
            WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '42 days') IN (6,7,8) THEN 'summer'
            WHEN EXTRACT(MONTH FROM appointment_date - INTERVAL '42 days') IN (9,10,11) THEN 'fall'
            ELSE 'winter'
          END,
          place_id,
          'beacon_cron',
          appointment_id::TEXT,
          'System',
          'Auto-created from lactating appointment on ' || appointment_date::TEXT
        FROM lactating_mothers
        ON CONFLICT DO NOTHING
        RETURNING birth_event_id
      `);

      results.birth_events_created = birthResult.rowCount || 0;
    } catch (err) {
      results.errors.push(`Birth events: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // ============================================================
    // 2. Create Mortality Events from Clinic Euthanasia
    // ============================================================

    try {
      const mortalityResult = await query(`
        WITH death_appointments AS (
          SELECT DISTINCT ON (a.cat_id)
            a.appointment_id,
            a.appointment_date,
            a.cat_id,
            a.medical_notes,
            CASE
              WHEN LOWER(a.medical_notes) LIKE '%humanely euthanized%' THEN 'euthanasia'
              WHEN LOWER(a.medical_notes) LIKE '%euthanasia%' THEN 'euthanasia'
              WHEN LOWER(a.medical_notes) LIKE '%hit by car%' OR LOWER(a.medical_notes) LIKE '%hbc%' THEN 'vehicle'
              WHEN LOWER(a.medical_notes) LIKE '%died%' THEN 'unknown'
              ELSE 'unknown'
            END AS death_cause,
            (
              SELECT cpr.place_id
              FROM sot.cat_place_relationships cpr
              WHERE cpr.cat_id = a.cat_id
              ORDER BY cpr.created_at DESC
              LIMIT 1
            ) as place_id
          FROM ops.appointments a
          JOIN sot.cats c ON c.cat_id = a.cat_id
          LEFT JOIN sot.cat_mortality_events me ON me.cat_id = a.cat_id
          WHERE (
              LOWER(a.medical_notes) LIKE '%euthanized%'
              OR LOWER(a.medical_notes) LIKE '%euthanasia%'
              OR LOWER(a.medical_notes) LIKE '%died%'
              OR LOWER(a.medical_notes) LIKE '%hit by car%'
              OR LOWER(a.medical_notes) LIKE '%hbc%'
            )
            AND me.mortality_event_id IS NULL
          ORDER BY a.cat_id, a.appointment_date DESC
          LIMIT 200
        )
        INSERT INTO sot.cat_mortality_events (
          cat_id,
          death_date,
          death_date_precision,
          death_year,
          death_month,
          death_cause,
          place_id,
          source_system,
          source_record_id,
          reported_by,
          notes
        )
        SELECT
          cat_id,
          appointment_date,
          'exact',
          EXTRACT(YEAR FROM appointment_date)::INT,
          EXTRACT(MONTH FROM appointment_date)::INT,
          death_cause,
          place_id,
          'beacon_cron',
          appointment_id::TEXT,
          'System',
          'Auto-created from clinic notes: ' || LEFT(medical_notes, 200)
        FROM death_appointments
        ON CONFLICT (cat_id) DO NOTHING
        RETURNING mortality_event_id
      `);

      results.mortality_events_created = mortalityResult.rowCount || 0;

      // Mark cats as deceased
      const deceasedResult = await query(`
        UPDATE sot.cats
        SET is_deceased = true, deceased_date = me.death_date, updated_at = NOW()
        FROM sot.cat_mortality_events me
        WHERE sot_cats.cat_id = me.cat_id
          AND (sot_cats.is_deceased IS NULL OR sot_cats.is_deceased = false)
          AND me.source_system = 'beacon_cron'
        RETURNING sot_cats.cat_id
      `);

      results.cats_marked_deceased = deceasedResult.rowCount || 0;
    } catch (err) {
      results.errors.push(`Mortality events: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // ============================================================
    // 3. Log run to ingest_runs table
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
          'beacon_cron',
          'incremental',
          NOW() - INTERVAL '${Date.now() - startTime} milliseconds',
          NOW(),
          $1,
          $2,
          'completed',
          $3
        )
      `, [
        results.birth_events_created + results.mortality_events_created,
        results.birth_events_created + results.mortality_events_created,
        `Births: ${results.birth_events_created}, Mortality: ${results.mortality_events_created}, Deceased marked: ${results.cats_marked_deceased}`,
      ]);
    } catch {
      // Table may not exist
    }

    return NextResponse.json({
      success: true,
      ...results,
      duration_ms: Date.now() - startTime,
      message: `Created ${results.birth_events_created} birth events, ${results.mortality_events_created} mortality events`,
    });

  } catch (error) {
    console.error("Beacon enrich cron error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      ...results,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
