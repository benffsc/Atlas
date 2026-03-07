#!/usr/bin/env node
// DEPRECATED: References v1 trapper.* schema (dropped MIG_2299). Do not run.
/**
 * Add clinic activity confidence boost to colony size view
 *
 * Adds +10% confidence boost if there was a clinic appointment
 * at that place within 90 days of the colony estimate.
 */

import pg from 'pg';
import fs from 'fs';

const { Client } = pg;

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
  console.log('Adding clinic activity boost to v_place_colony_status\n');

  try {
    // Drop and recreate view with clinic boost
    await client.query(`DROP VIEW IF EXISTS sot.v_place_colony_status CASCADE`);

    await client.query(`
      CREATE VIEW sot.v_place_colony_status AS
      WITH
      -- Get verified cat counts from place relationships
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

      -- Clinic activity per place (for confidence boost)
      -- P75 surveys are from clinic clients - boost if we have clinic procedures at that place
      clinic_activity AS (
        SELECT
          cpr.place_id,
          COUNT(DISTINCT cp.cat_id) AS cats_altered,
          MAX(cp.procedure_date) AS last_procedure_at
        FROM ops.cat_procedures cp
        JOIN sot.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
        WHERE cp.is_spay OR cp.is_neuter
        GROUP BY cpr.place_id
      ),

      -- Calculate recency-weighted confidence for each estimate
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
          CASE WHEN e.is_firsthand THEN COALESCE(sc.is_firsthand_boost, 0.05) ELSE 0 END AS firsthand_boost,
          -- Clinic boost: +10% if procedure at place within 4 weeks of observation
          -- P75 surveys are submitted after clinic visits, so this confirms the data
          CASE
            WHEN ca.last_procedure_at IS NOT NULL
              AND ABS(EXTRACT(DAY FROM ca.last_procedure_at - COALESCE(e.observation_date::timestamptz, e.reported_at))) <= 28
            THEN 0.10
            WHEN ca.cats_altered > 0 THEN 0.05  -- Any clinic history at place
            ELSE 0
          END AS clinic_boost
        FROM sot.place_colony_estimates e
        LEFT JOIN ops.colony_source_confidence sc ON sc.source_type = e.source_type
        LEFT JOIN clinic_activity ca ON ca.place_id = e.place_id
        WHERE e.total_cats IS NOT NULL
      ),

      -- Score estimates with all boosts
      scored_estimates AS (
        SELECT *,
          LEAST(1.0, (base_confidence * recency_factor) + firsthand_boost + clinic_boost) AS final_confidence
        FROM weighted_estimates
      ),

      -- Aggregate per place
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
          MAX(se.clinic_boost) AS has_clinic_boost,
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

      -- Multi-source confirmation check
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
        COALESCE(a.has_clinic_boost, 0) > 0 AS has_clinic_boost,
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
    console.log('  ✓ Created v_place_colony_status view with clinic boost');

    // Check results
    const stats = await client.query(`
      SELECT
        COUNT(*) as total_places,
        SUM(colony_size_estimate) as total_estimated_cats,
        ROUND(AVG(final_confidence)::numeric, 3) as avg_confidence,
        COUNT(*) FILTER (WHERE has_clinic_boost) as with_clinic_boost,
        COUNT(*) FILTER (WHERE is_multi_source_confirmed) as multi_confirmed
      FROM sot.v_place_colony_status
    `);
    console.log('\n📊 Colony Status Summary:');
    console.log(`   Places with estimates: ${stats.rows[0].total_places}`);
    console.log(`   Total estimated cats: ${stats.rows[0].total_estimated_cats}`);
    console.log(`   Average confidence: ${stats.rows[0].avg_confidence}`);
    console.log(`   With clinic boost (+10%): ${stats.rows[0].with_clinic_boost}`);
    console.log(`   Multi-source confirmed: ${stats.rows[0].multi_confirmed}`);

  } catch (err) {
    console.error('Error:', err.message);
    throw err;
  } finally {
    await client.end();
  }

  console.log('\nClinic boost added!');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
