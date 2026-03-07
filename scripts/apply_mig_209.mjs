#!/usr/bin/env node
// DEPRECATED: References v1 trapper.* schema (dropped MIG_2299). Do not run.
/**
 * Apply MIG_209 colony size tracking
 */

import pg from 'pg';
import fs from 'fs';

const { Client } = pg;

// Load DATABASE_URL from .env (handles special chars)
function loadDatabaseUrl() {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABASE_URL=['"]?([^'"\n]+)['"]?/m);
  if (!match) throw new Error('DATABASE_URL not found in .env');
  return match[1];
}

async function main() {
  const client = new Client({
    connectionString: loadDatabaseUrl()
  });

  await client.connect();
  console.log('Applying MIG_209: Colony Size Tracking\n');

  try {
    // 1. Create place_colony_estimates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sot.place_colony_estimates (
        estimate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        place_id UUID NOT NULL REFERENCES sot.places(place_id) ON DELETE CASCADE,
        total_cats INTEGER,
        adult_count INTEGER,
        kitten_count INTEGER,
        altered_count INTEGER,
        unaltered_count INTEGER,
        friendly_count INTEGER,
        feral_count INTEGER,
        source_type TEXT NOT NULL,
        source_entity_type TEXT,
        source_entity_id UUID,
        reported_by_person_id UUID REFERENCES sot.people(person_id),
        observation_date DATE,
        reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_firsthand BOOLEAN DEFAULT TRUE,
        notes TEXT,
        source_system TEXT,
        source_record_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT NOT NULL DEFAULT 'system',
        UNIQUE (source_system, source_record_id)
      )
    `);
    console.log('  ✓ Created place_colony_estimates table');

    // 2. Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_colony_estimates_place
        ON sot.place_colony_estimates(place_id);
      CREATE INDEX IF NOT EXISTS idx_colony_estimates_observation_date
        ON sot.place_colony_estimates(observation_date DESC NULLS LAST);
      CREATE INDEX IF NOT EXISTS idx_colony_estimates_source
        ON sot.place_colony_estimates(source_type);
    `);
    console.log('  ✓ Created indexes');

    // 3. Create confidence config table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops.colony_source_confidence (
        source_type TEXT PRIMARY KEY,
        base_confidence NUMERIC(4,2) NOT NULL,
        description TEXT,
        is_firsthand_boost NUMERIC(4,2) DEFAULT 0.05
      )
    `);
    console.log('  ✓ Created colony_source_confidence table');

    // 4. Insert confidence levels
    await client.query(`
      INSERT INTO ops.colony_source_confidence (source_type, base_confidence, description) VALUES
        ('verified_cats', 1.00, 'Actual cats in database with verified place link'),
        ('post_clinic_survey', 0.85, 'Project 75 post-clinic survey'),
        ('trapper_site_visit', 0.80, 'Trapper assessment or site visit report'),
        ('manual_observation', 0.75, 'Manual entry by staff'),
        ('trapping_request', 0.60, 'Requester estimate in trapping request'),
        ('intake_form', 0.55, 'Web intake form submission'),
        ('appointment_request', 0.50, 'Estimate in appointment booking')
      ON CONFLICT (source_type) DO NOTHING
    `);
    console.log('  ✓ Inserted confidence levels');

    // 5. Drop and recreate view (column changes require drop)
    await client.query(`DROP VIEW IF EXISTS sot.v_place_colony_status CASCADE`);

    await client.query(`
      CREATE VIEW sot.v_place_colony_status AS
      WITH
      verified_counts AS (
        SELECT
          cpr.place_id,
          COUNT(DISTINCT cpr.cat_id) AS verified_cat_count,
          COUNT(DISTINCT cpr.cat_id) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM ops.cat_procedures cp
              WHERE cp.cat_id = cpr.cat_id AND (cp.is_spay OR cp.is_neuter)
            )
          ) AS verified_altered_count,
          MAX(cpr.created_at) AS last_verified_at
        FROM sot.cat_place_relationships cpr
        GROUP BY cpr.place_id
      ),
      weighted_estimates AS (
        SELECT
          e.place_id,
          e.estimate_id,
          e.total_cats,
          e.adult_count,
          e.kitten_count,
          e.altered_count,
          e.unaltered_count,
          e.friendly_count,
          e.feral_count,
          e.source_type,
          e.observation_date,
          e.reported_at,
          e.is_firsthand,
          COALESCE(sc.base_confidence, 0.50) AS base_confidence,
          EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) AS days_ago,
          CASE
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 30 THEN 1.0
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 90 THEN 0.90
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 180 THEN 0.75
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 365 THEN 0.50
            ELSE 0.25
          END AS recency_factor,
          CASE WHEN e.is_firsthand THEN COALESCE(sc.is_firsthand_boost, 0.05) ELSE 0 END AS firsthand_boost
        FROM sot.place_colony_estimates e
        LEFT JOIN ops.colony_source_confidence sc ON sc.source_type = e.source_type
        WHERE e.total_cats IS NOT NULL
      ),
      scored_estimates AS (
        SELECT *, LEAST(1.0, (base_confidence * recency_factor) + firsthand_boost) AS final_confidence
        FROM weighted_estimates
      ),
      aggregated AS (
        SELECT
          se.place_id,
          ROUND(SUM(se.total_cats * se.final_confidence) / NULLIF(SUM(se.final_confidence), 0))::INTEGER AS estimated_total,
          (ARRAY_AGG(se.total_cats ORDER BY se.final_confidence DESC))[1] AS best_single_estimate,
          MIN(se.total_cats) AS estimate_min,
          MAX(se.total_cats) AS estimate_max,
          COUNT(*) AS estimate_count,
          COUNT(*) FILTER (WHERE se.days_ago <= 90) AS recent_estimate_count,
          ROUND(AVG(se.final_confidence)::NUMERIC, 2) AS avg_confidence,
          (ARRAY_AGG(se.source_type ORDER BY se.final_confidence DESC))[1] AS primary_source,
          MAX(se.observation_date) AS latest_observation,
          (ARRAY_AGG(se.adult_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_adults,
          (ARRAY_AGG(se.kitten_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_kittens,
          (ARRAY_AGG(se.altered_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_altered,
          (ARRAY_AGG(se.unaltered_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_unaltered,
          (ARRAY_AGG(se.friendly_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_friendly,
          (ARRAY_AGG(se.feral_count ORDER BY se.final_confidence DESC, se.observation_date DESC NULLS LAST))[1] AS est_feral
        FROM scored_estimates se
        GROUP BY se.place_id
      ),
      confirmations AS (
        SELECT
          se.place_id,
          CASE
            WHEN COUNT(DISTINCT se.source_type) >= 2 AND MAX(se.total_cats) <= MIN(se.total_cats) * 1.2 THEN TRUE
            ELSE FALSE
          END AS is_multi_source_confirmed
        FROM scored_estimates se
        WHERE se.days_ago <= 90
        GROUP BY se.place_id
      )
      SELECT
        p.place_id,
        p.display_name AS place_name,
        p.formatted_address,
        p.service_zone,
        COALESCE(vc.verified_cat_count, 0) AS verified_cat_count,
        COALESCE(vc.verified_altered_count, 0) AS verified_altered_count,
        vc.last_verified_at,
        COALESCE(a.estimated_total, vc.verified_cat_count, 0) AS colony_size_estimate,
        a.best_single_estimate,
        a.estimate_min,
        a.estimate_max,
        a.est_adults,
        a.est_kittens,
        a.est_altered,
        a.est_unaltered,
        a.est_friendly,
        a.est_feral,
        a.estimate_count,
        a.recent_estimate_count,
        a.avg_confidence,
        COALESCE(c.is_multi_source_confirmed, FALSE) AS is_multi_source_confirmed,
        CASE
          WHEN c.is_multi_source_confirmed THEN LEAST(1.0, COALESCE(a.avg_confidence, 0) + 0.15)
          ELSE a.avg_confidence
        END AS final_confidence,
        a.primary_source,
        a.latest_observation,
        GREATEST(0, COALESCE(a.est_unaltered, a.estimated_total - COALESCE(vc.verified_altered_count, 0), 0)) AS estimated_work_remaining
      FROM sot.places p
      LEFT JOIN verified_counts vc ON vc.place_id = p.place_id
      LEFT JOIN aggregated a ON a.place_id = p.place_id
      LEFT JOIN confirmations c ON c.place_id = p.place_id
      WHERE vc.verified_cat_count > 0 OR a.estimate_count > 0
    `);
    console.log('  ✓ Created v_place_colony_status view');

    // 6. Populate from requests
    const result = await client.query(`
      INSERT INTO sot.place_colony_estimates (
        place_id, total_cats, kitten_count, altered_count,
        source_type, source_entity_type, source_entity_id,
        reported_by_person_id, observation_date, is_firsthand,
        source_system, source_record_id, created_by
      )
      SELECT
        r.place_id, r.estimated_cat_count, r.kitten_count, r.eartip_count,
        'trapping_request', 'request', r.request_id,
        r.requester_person_id, COALESCE(r.source_created_at::date, r.created_at::date), TRUE,
        COALESCE(r.source_system, 'atlas'), COALESCE(r.source_record_id, r.request_id::text),
        'MIG_209_initial'
      FROM ops.requests r
      WHERE r.place_id IS NOT NULL AND r.estimated_cat_count IS NOT NULL
      ON CONFLICT (source_system, source_record_id) DO NOTHING
    `);
    console.log(`  ✓ Populated ${result.rowCount} estimates from requests`);

    // 7. Check results
    const stats = await client.query(`
      SELECT
        COUNT(*) as total_places,
        SUM(colony_size_estimate) as total_estimated_cats,
        ROUND(AVG(final_confidence)::numeric, 2) as avg_confidence
      FROM sot.v_place_colony_status
    `);
    console.log('\n📊 Colony Status Summary:');
    console.log(`   Places with estimates: ${stats.rows[0].total_places}`);
    console.log(`   Total estimated cats: ${stats.rows[0].total_estimated_cats}`);
    console.log(`   Average confidence: ${stats.rows[0].avg_confidence}`);

  } catch (err) {
    console.error('Error:', err.message);
    throw err;
  } finally {
    await client.end();
  }

  console.log('\nMIG_209 complete!');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
