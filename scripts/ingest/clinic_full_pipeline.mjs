#!/usr/bin/env node
/**
 * clinic_full_pipeline.mjs
 *
 * Complete pipeline for ingesting ClinicHQ data:
 * 1. Ingest cat_info.xlsx → staged_records + sot_cats
 * 2. Ingest owner_info.xlsx → staged_records + sot_people
 * 3. Ingest appointment_info.xlsx → staged_records + sot_appointments
 * 4. Extract procedures from appointments (service_type based)
 * 5. Fix procedures based on cat sex
 * 6. Auto-link cats to places via person relationships
 * 7. Update sot_cats.altered_status
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/clinic_full_pipeline.mjs --date 2026-01-13
 *   node scripts/ingest/clinic_full_pipeline.mjs --folder /path/to/folder
 *   node scripts/ingest/clinic_full_pipeline.mjs --dry-run
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH || '/Users/benmisdiaz/Desktop/AI_Ingest';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    date: null,
    folder: null,
    dryRun: false,
    skipIngest: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--date':
        options.date = args[++i];
        break;
      case '--folder':
        options.folder = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-ingest':
        options.skipIngest = true;
        break;
    }
  }

  return options;
}

function runScript(scriptPath, args = [], options = {}) {
  const cmd = `node ${scriptPath} ${args.join(' ')}`;
  console.log(`\n  Running: ${cmd}`);

  if (options.dryRun) {
    console.log('  [DRY RUN - skipped]');
    return;
  }

  try {
    execSync(cmd, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    });
  } catch (e) {
    console.error(`  Error running ${scriptPath}`);
    if (!options.continueOnError) throw e;
  }
}

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log('\n' + '='.repeat(60));
  console.log('  CLINIC FULL INGEST PIPELINE');
  console.log('='.repeat(60));
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  // Determine folder path
  let folder = options.folder;
  if (!folder && options.date) {
    folder = path.join(DEFAULT_INGEST_PATH, 'clinichq', options.date);
  }

  if (!folder) {
    console.error('Error: Must specify --date or --folder');
    console.log('Usage:');
    console.log('  node scripts/ingest/clinic_full_pipeline.mjs --date 2026-01-13');
    console.log('  node scripts/ingest/clinic_full_pipeline.mjs --folder /path/to/folder');
    process.exit(1);
  }

  if (!fs.existsSync(folder)) {
    console.error(`Error: Folder not found: ${folder}`);
    process.exit(1);
  }

  console.log(`\nSource folder: ${folder}`);

  // Check for expected files
  const files = {
    catInfo: path.join(folder, 'cat_info.xlsx'),
    ownerInfo: path.join(folder, 'owner_info.xlsx'),
    appointmentInfo: path.join(folder, 'appointment_info.xlsx'),
  };

  console.log('\nFiles found:');
  for (const [name, filePath] of Object.entries(files)) {
    const exists = fs.existsSync(filePath);
    console.log(`  ${exists ? '✓' : '✗'} ${name}: ${path.basename(filePath)}`);
  }

  if (!options.skipIngest) {
    // Step 1: Ingest cat_info
    if (fs.existsSync(files.catInfo)) {
      console.log('\n' + '-'.repeat(40));
      console.log('STEP 1: Ingest cat_info.xlsx');
      console.log('-'.repeat(40));
      runScript('scripts/ingest/clinichq_cat_info_xlsx.mjs', ['--xlsx', files.catInfo], options);
    }

    // Step 2: Ingest owner_info
    if (fs.existsSync(files.ownerInfo)) {
      console.log('\n' + '-'.repeat(40));
      console.log('STEP 2: Ingest owner_info.xlsx');
      console.log('-'.repeat(40));
      runScript('scripts/ingest/clinichq_owner_info_xlsx.mjs', ['--xlsx', files.ownerInfo], options);
    }

    // Step 3: Ingest appointment_info
    if (fs.existsSync(files.appointmentInfo)) {
      console.log('\n' + '-'.repeat(40));
      console.log('STEP 3: Ingest appointment_info.xlsx');
      console.log('-'.repeat(40));
      runScript('scripts/ingest/clinichq_appointment_info_xlsx.mjs', ['--xlsx', files.appointmentInfo], options);
    }
  } else {
    console.log('\n[Skipping ingest steps - --skip-ingest specified]');
  }

  // Step 4-7: Extract and clean data
  console.log('\n' + '-'.repeat(40));
  console.log('STEP 4: Extract procedures from appointments');
  console.log('-'.repeat(40));
  runScript('scripts/ingest/extract_procedures_from_appointments.mjs', options.dryRun ? ['--dry-run'] : [], options);

  // Step 5: Update cat sex from cat_info export
  if (fs.existsSync(files.catInfo)) {
    console.log('\n' + '-'.repeat(40));
    console.log('STEP 5: Update cat sex from export');
    console.log('-'.repeat(40));
    runScript('scripts/ingest/update_cat_sex_from_export.mjs', ['--xlsx', files.catInfo], options);
  }

  // Step 6: Run data cleaning layer
  console.log('\n' + '-'.repeat(40));
  console.log('STEP 6: Run data cleaning layer');
  console.log('-'.repeat(40));

  if (!options.dryRun) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
      // Fix procedures based on cat sex
      console.log('  Fixing procedures based on cat sex...');

      const fixedMales = await pool.query(`
        UPDATE ops.cat_procedures cp
        SET procedure_type = 'neuter', is_spay = FALSE, is_neuter = TRUE
        FROM sot.cats c
        WHERE cp.cat_id = c.cat_id
          AND cp.is_spay = TRUE
          AND LOWER(c.sex) = 'male'
        RETURNING cp.cat_id
      `);
      console.log(`    Fixed ${fixedMales.rowCount} male cats (spay -> neuter)`);

      const fixedFemales = await pool.query(`
        UPDATE ops.cat_procedures cp
        SET procedure_type = 'spay', is_spay = TRUE, is_neuter = FALSE
        FROM sot.cats c
        WHERE cp.cat_id = c.cat_id
          AND cp.is_neuter = TRUE
          AND LOWER(c.sex) = 'female'
        RETURNING cp.cat_id
      `);
      console.log(`    Fixed ${fixedFemales.rowCount} female cats (neuter -> spay)`);

      // Auto-link cats to places
      console.log('\n  Auto-linking cats to places via person relationships...');

      const linkedCats = await pool.query(`
        INSERT INTO sot.cat_place_relationships (
          cat_id, place_id, relationship_type, confidence, source_system, source_table
        )
        SELECT DISTINCT
          a.cat_id,
          ppr.place_id,
          'appointment_site',
          'high',
          'auto_link',
          'clinic_pipeline'
        FROM ops.appointments a
        JOIN sot.person_place_relationships ppr ON ppr.person_id = a.person_id
        WHERE a.cat_id IS NOT NULL
          AND ppr.place_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM sot.cat_place_relationships cpr
            WHERE cpr.cat_id = a.cat_id
              AND cpr.place_id = ppr.place_id
          )
        ON CONFLICT DO NOTHING
        RETURNING cat_id
      `);
      console.log(`    Linked ${linkedCats.rowCount} cats to places`);

      // Update altered_status
      console.log('\n  Updating altered_status...');

      await pool.query(`
        UPDATE sot.cats c
        SET altered_status = 'spayed'
        WHERE c.altered_status IS DISTINCT FROM 'spayed'
          AND EXISTS (
            SELECT 1 FROM ops.cat_procedures cp
            WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE
          )
      `);

      await pool.query(`
        UPDATE sot.cats c
        SET altered_status = 'neutered'
        WHERE c.altered_status IS DISTINCT FROM 'neutered'
          AND EXISTS (
            SELECT 1 FROM ops.cat_procedures cp
            WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE
          )
      `);

      console.log('    Updated altered_status from procedures');

    } finally {
      await pool.end();
    }
  } else {
    console.log('  [DRY RUN - skipped]');
  }

  // Step 7: Queue processing jobs for the unified pipeline
  console.log('\n' + '-'.repeat(40));
  console.log('STEP 7: Queue unified processing jobs');
  console.log('-'.repeat(40));

  if (!options.dryRun) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
      // Enqueue processing jobs for each file type
      // These will be processed by the unified /api/ingest/process endpoint
      for (const [name, filePath] of Object.entries(files)) {
        if (fs.existsSync(filePath)) {
          const sourceTable = name === 'catInfo' ? 'cat_info'
            : name === 'ownerInfo' ? 'owner_info'
            : 'appointment_info';

          const result = await pool.query(`
            SELECT ops.enqueue_processing(
              'clinichq',
              $1,
              'cli_ingest',
              NULL,
              0
            ) as job_id
          `, [sourceTable]);

          console.log(`  ✓ Queued processing job for ${sourceTable}: ${result.rows[0].job_id}`);
        }
      }

      console.log('\n  Jobs queued. They will be processed by /api/ingest/process cron.');
      console.log('  Or run manually: SELECT * FROM ops.process_next_job();');

    } catch (e) {
      console.error('  Error queueing processing jobs:', e.message);
      console.log('  Note: This is non-fatal - data was staged successfully.');
    } finally {
      await pool.end();
    }
  } else {
    console.log('  [DRY RUN - skipped]');
  }

  // Final stats
  console.log('\n' + '='.repeat(60));
  console.log('  PIPELINE COMPLETE');
  console.log('='.repeat(60));

  if (!options.dryRun) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
      const stats = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM sot.cats) as total_cats,
          (SELECT COUNT(*) FROM ops.cat_procedures WHERE is_spay) as spays,
          (SELECT COUNT(*) FROM ops.cat_procedures WHERE is_neuter) as neuters,
          (SELECT COUNT(*) FROM sot.cat_place_relationships) as cat_place_links
      `);

      console.log(`\nFinal stats:`);
      console.log(`  Total cats: ${stats.rows[0].total_cats}`);
      console.log(`  Spay procedures: ${stats.rows[0].spays}`);
      console.log(`  Neuter procedures: ${stats.rows[0].neuters}`);
      console.log(`  Cat-place links: ${stats.rows[0].cat_place_links}`);

    } finally {
      await pool.end();
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDuration: ${duration}s`);
  console.log('Done!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
