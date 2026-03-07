#!/usr/bin/env node
/**
 * update_cat_sex_from_export.mjs
 *
 * Updates sot_cats.sex from a corrected ClinicHQ cat_info export.
 * The animal profile sex in ClinicHQ is considered the source of truth.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/update_cat_sex_from_export.mjs --xlsx /path/to/cat_info.xlsx
 *   node scripts/ingest/update_cat_sex_from_export.mjs --date 2025-corrected
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { parseXlsxFile } from './_lib/xlsx_reader.mjs';

const { Pool } = pg;

const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH || '/Users/benmisdiaz/Desktop/AI_Ingest';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    xlsxPath: null,
    date: '2025-corrected',
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--xlsx':
        options.xlsxPath = args[++i];
        break;
      case '--date':
        options.date = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log('\n=== Update Cat Sex from Export ===');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  // Find XLSX file
  let xlsxPath = options.xlsxPath;
  if (!xlsxPath) {
    xlsxPath = path.join(DEFAULT_INGEST_PATH, 'clinichq', options.date, 'cat_info.xlsx');
  }

  if (!fs.existsSync(xlsxPath)) {
    console.error(`Error: File not found: ${xlsxPath}`);
    process.exit(1);
  }

  console.log(`Source: ${xlsxPath}`);

  // Parse XLSX
  console.log('Parsing cat_info.xlsx...');
  const { rows } = parseXlsxFile(xlsxPath);
  console.log(`  ${rows.length} records found`);

  // Build microchip -> sex map
  const catSex = new Map();
  for (const row of rows) {
    const chip = row['Microchip Number'];
    const sex = row['Sex'];
    if (chip && sex) {
      catSex.set(chip, sex);
    }
  }
  console.log(`  ${catSex.size} unique microchips with sex`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Get current cat sex data
    console.log('\nFetching current cat data...');
    const currentCats = await pool.query(`
      SELECT c.cat_id, c.sex, ci.id_value as microchip
      FROM sot.cats c
      JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    `);

    console.log(`  ${currentCats.rows.length} cats with microchips in database`);

    // Find cats that need sex updates
    const updates = [];
    let alreadyCorrect = 0;
    let noMatch = 0;

    for (const cat of currentCats.rows) {
      const exportSex = catSex.get(cat.microchip);
      if (exportSex) {
        const currentSex = (cat.sex || '').toLowerCase();
        const newSex = exportSex.toLowerCase();

        if (currentSex !== newSex) {
          updates.push({
            cat_id: cat.cat_id,
            microchip: cat.microchip,
            oldSex: cat.sex,
            newSex: exportSex,
          });
        } else {
          alreadyCorrect++;
        }
      } else {
        noMatch++;
      }
    }

    console.log(`\nAnalysis:`);
    console.log(`  Already correct: ${alreadyCorrect}`);
    console.log(`  Need update: ${updates.length}`);
    console.log(`  No match in export: ${noMatch}`);

    if (updates.length > 0) {
      console.log(`\nSample updates (first 10):`);
      console.table(updates.slice(0, 10).map(u => ({
        microchip: u.microchip,
        oldSex: u.oldSex || '(null)',
        newSex: u.newSex,
      })));
    }

    if (options.dryRun) {
      console.log('\nDry run complete. No changes made.');
    } else if (updates.length > 0) {
      console.log('\nApplying updates...');

      let updated = 0;
      for (const u of updates) {
        await pool.query(
          'UPDATE sot.cats SET sex = $1 WHERE cat_id = $2',
          [u.newSex, u.cat_id]
        );
        updated++;
      }

      console.log(`  Updated ${updated} cats`);

      // Now fix procedures based on corrected sex
      console.log('\nFixing procedures based on corrected sex...');

      // Males cannot be spayed
      const fixedMales = await pool.query(`
        UPDATE ops.cat_procedures cp
        SET procedure_type = 'neuter', is_spay = FALSE, is_neuter = TRUE
        FROM sot.cats c
        WHERE cp.cat_id = c.cat_id
          AND cp.is_spay = TRUE
          AND LOWER(c.sex) = 'male'
        RETURNING cp.cat_id
      `);
      console.log(`  Fixed ${fixedMales.rowCount} male cats (spay -> neuter)`);

      // Females cannot be neutered
      const fixedFemales = await pool.query(`
        UPDATE ops.cat_procedures cp
        SET procedure_type = 'spay', is_spay = TRUE, is_neuter = FALSE
        FROM sot.cats c
        WHERE cp.cat_id = c.cat_id
          AND cp.is_neuter = TRUE
          AND LOWER(c.sex) = 'female'
        RETURNING cp.cat_id
      `);
      console.log(`  Fixed ${fixedFemales.rowCount} female cats (neuter -> spay)`);
    } else {
      console.log('\nNo updates needed.');
    }

    // Final stats
    console.log('\n=== Final Stats ===');
    const finalStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE LOWER(sex) = 'male') as males,
        COUNT(*) FILTER (WHERE LOWER(sex) = 'female') as females,
        COUNT(*) FILTER (WHERE sex IS NULL OR sex = '') as unknown
      FROM sot.cats
    `);
    console.log(`Males: ${finalStats.rows[0].males}`);
    console.log(`Females: ${finalStats.rows[0].females}`);
    console.log(`Unknown: ${finalStats.rows[0].unknown}`);

  } finally {
    await pool.end();
  }

  console.log('\nDone!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
