#!/usr/bin/env node
/**
 * rebuild_clinichq.mjs
 *
 * Orchestrates the ClinicHQ data rebuild with:
 * 1. Cats first (cats are sacred - never deleted)
 * 2. Canonical people only (real contact info)
 * 3. Internal accounts linked to departments
 * 4. FFSC office cats flagged with unknown origin
 * 5. Data source priority: clinichq > petlink > legacy
 *
 * Usage:
 *   export $(cat .env | grep -v '^#' | xargs)
 *   node scripts/ingest/rebuild_clinichq.mjs
 *
 *   Options:
 *     --dry-run    Show what would be done without making changes
 *     --skip-ingest  Skip re-ingesting files, just run transformations
 */

import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const { reset, bold, red, green, yellow, cyan, gray } = colors;

function log(msg) {
  console.log(msg);
}

function logStep(step, msg) {
  console.log(`\n${cyan}Step ${step}:${reset} ${msg}`);
}

function logSuccess(msg) {
  console.log(`  ${green}✓${reset} ${msg}`);
}

function logWarning(msg) {
  console.log(`  ${yellow}⚠${reset} ${msg}`);
}

function logError(msg) {
  console.error(`  ${red}✗${reset} ${msg}`);
}

function logStats(label, value) {
  console.log(`  ${label}: ${bold}${value}${reset}`);
}

async function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'inherit' });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipIngest = args.includes('--skip-ingest');

  console.log(`\n${bold}╔══════════════════════════════════════════════════╗${reset}`);
  console.log(`${bold}║     ClinicHQ Data Rebuild                        ║${reset}`);
  console.log(`${bold}╚══════════════════════════════════════════════════╝${reset}`);

  if (dryRun) {
    console.log(`${yellow}DRY RUN MODE - No changes will be made${reset}`);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // ========================================
    // Step 1: Verify cats are intact (cats are sacred)
    // ========================================
    logStep(1, 'Verify cats are intact (cats are sacred)');

    const catCountBefore = await client.query('SELECT COUNT(*) FROM trapper.sot_cats');
    logStats('Total cats', catCountBefore.rows[0].count);
    logSuccess('Cats will be preserved - no deletions');

    // ========================================
    // Step 2: Refresh canonical flags
    // ========================================
    logStep(2, 'Computing canonical person flags');

    if (!dryRun) {
      const canonicalResult = await client.query('SELECT * FROM trapper.refresh_canonical_flags()');
      const r = canonicalResult.rows[0];
      logStats('Total people', r.total_people);
      logStats('Canonical', r.canonical);
      logStats('Non-canonical', r.non_canonical);
    } else {
      const preview = await client.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE trapper.compute_is_canonical(person_id)) as would_be_canonical
        FROM trapper.sot_people
        WHERE merged_into_person_id IS NULL
        LIMIT 100
      `);
      logStats('Sample (100) would be canonical', preview.rows[0].would_be_canonical);
    }

    // ========================================
    // Step 3: Analyze canonical vs non-canonical
    // ========================================
    logStep(3, 'Analyzing person canonical status');

    const canonicalStats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_canonical = TRUE) AS canonical,
        COUNT(*) FILTER (WHERE is_canonical = FALSE OR is_canonical IS NULL) AS non_canonical,
        COUNT(*) AS total
      FROM trapper.sot_people
      WHERE merged_into_person_id IS NULL
    `);
    const stats = canonicalStats.rows[0];
    logStats('Canonical (real people)', `${stats.canonical} (${Math.round(100 * stats.canonical / stats.total)}%)`);
    logStats('Non-canonical (internal)', `${stats.non_canonical} (${Math.round(100 * stats.non_canonical / stats.total)}%)`);

    // ========================================
    // Step 4: Link internal accounts to departments
    // ========================================
    logStep(4, 'Linking internal accounts to departments');

    if (!dryRun) {
      const linkResult = await client.query('SELECT trapper.link_internal_accounts_to_orgs()');
      logStats('Accounts linked', linkResult.rows[0].link_internal_accounts_to_orgs);
    }

    // Show department breakdown
    const deptStats = await client.query(`
      SELECT o.display_name as dept, COUNT(*) as accounts
      FROM trapper.person_organization_link pol
      JOIN trapper.organizations o ON o.org_id = pol.org_id
      WHERE pol.link_type = 'internal_account'
      GROUP BY o.display_name
      ORDER BY accounts DESC
    `);

    if (deptStats.rows.length > 0) {
      log('  Department breakdown:');
      deptStats.rows.forEach(r => {
        log(`    ${r.dept}: ${r.accounts}`);
      });
    }

    // ========================================
    // Step 5: Update cat data sources
    // ========================================
    logStep(5, 'Updating cat data sources (clinichq > petlink > legacy)');

    if (!dryRun) {
      const sourceResult = await client.query('SELECT * FROM trapper.update_cat_data_sources()');
      const sr = sourceResult.rows[0];
      logStats('ClinicHQ cats', sr.clinichq_count);
      logStats('PetLink cats', sr.petlink_count);
      logStats('Legacy cats', sr.legacy_count);
    }

    // Show current distribution
    const sourceStats = await client.query(`
      SELECT COALESCE(data_source::TEXT, 'NULL') as source, COUNT(*) as count
      FROM trapper.sot_cats
      GROUP BY data_source
      ORDER BY count DESC
    `);
    log('  Current distribution:');
    sourceStats.rows.forEach(r => {
      log(`    ${r.source}: ${r.count}`);
    });

    // ========================================
    // Step 6: Flag FFSC office cats
    // ========================================
    logStep(6, 'Flagging cats at FFSC office addresses (unknown origin)');

    if (!dryRun) {
      const ffscResult = await client.query('SELECT trapper.link_ffsc_office_cats()');
      logStats('FFSC office cats flagged', ffscResult.rows[0].link_ffsc_office_cats);
    }

    // Count existing
    const ffscCount = await client.query(`
      SELECT COUNT(*) FROM trapper.cat_place_relationships
      WHERE origin_unknown = TRUE
    `);
    logStats('Total cats with unknown origin', ffscCount.rows[0].count);

    // ========================================
    // Step 7: Verification checks
    // ========================================
    logStep(7, 'Running verification checks');

    // Check for mega-persons (internal accounts with too many cats)
    const megaPersons = await client.query(`
      SELECT p.display_name, p.is_canonical, COUNT(*) as cat_count
      FROM trapper.person_cat_relationships pcr
      JOIN trapper.sot_people p ON p.person_id = pcr.person_id
      WHERE p.merged_into_person_id IS NULL
      GROUP BY p.person_id, p.display_name, p.is_canonical
      HAVING COUNT(*) > 50
      ORDER BY cat_count DESC
      LIMIT 5
    `);

    if (megaPersons.rows.length > 0) {
      logWarning(`Found ${megaPersons.rows.length} mega-persons (>50 cats):`);
      megaPersons.rows.forEach(r => {
        const status = r.is_canonical ? 'canonical' : 'internal';
        log(`    ${r.display_name}: ${r.cat_count} cats (${status})`);
      });
    } else {
      logSuccess('No mega-persons detected');
    }

    // Check cats with no place linked
    const orphanCats = await client.query(`
      SELECT COUNT(*) FROM trapper.sot_cats c
      WHERE NOT EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr
        WHERE cpr.cat_id = c.cat_id
      )
    `);
    logStats('Cats with no place linked', orphanCats.rows[0].count);

    // Verify cat count unchanged
    const catCountAfter = await client.query('SELECT COUNT(*) FROM trapper.sot_cats');
    if (catCountBefore.rows[0].count === catCountAfter.rows[0].count) {
      logSuccess(`Cat count preserved: ${catCountAfter.rows[0].count}`);
    } else {
      logError(`Cat count changed! Before: ${catCountBefore.rows[0].count}, After: ${catCountAfter.rows[0].count}`);
    }

    // ========================================
    // Summary
    // ========================================
    console.log(`\n${bold}═══════════════════════════════════════════════════${reset}`);
    console.log(`${bold}                    SUMMARY                         ${reset}`);
    console.log(`${bold}═══════════════════════════════════════════════════${reset}`);

    const finalStats = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM trapper.sot_cats) as total_cats,
        (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as total_people,
        (SELECT COUNT(*) FROM trapper.sot_people WHERE is_canonical = TRUE AND merged_into_person_id IS NULL) as canonical_people,
        (SELECT COUNT(*) FROM trapper.person_organization_link WHERE link_type = 'internal_account') as internal_accounts,
        (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE origin_unknown = TRUE) as unknown_origin_cats
    `);
    const fs = finalStats.rows[0];

    log(`  Total Cats:           ${green}${fs.total_cats}${reset}`);
    log(`  Total People:         ${fs.total_people}`);
    log(`  Canonical People:     ${green}${fs.canonical_people}${reset}`);
    log(`  Internal Accounts:    ${yellow}${fs.internal_accounts}${reset}`);
    log(`  Unknown Origin Cats:  ${yellow}${fs.unknown_origin_cats}${reset}`);

    console.log(`\n${green}${bold}Rebuild Complete!${reset}\n`);

    if (dryRun) {
      console.log(`${yellow}This was a dry run. Run without --dry-run to apply changes.${reset}\n`);
    }

  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
