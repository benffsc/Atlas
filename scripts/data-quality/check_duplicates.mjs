#!/usr/bin/env node

/**
 * Data Quality: Duplicate Detection Script
 *
 * Checks for:
 * 1. Duplicate places (same normalized_address)
 * 2. Duplicate people (same email/phone across records)
 * 3. Duplicate cats (same microchip)
 * 4. Orphaned relationships (references to merged entities)
 * 5. Junk data patterns (test emails, fake phones, etc.)
 *
 * Usage:
 *   node scripts/data-quality/check_duplicates.mjs
 *   node scripts/data-quality/check_duplicates.mjs --fix  # Auto-fix where possible
 */

import pg from "pg";
import { parseArgs } from "util";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const { values: args } = parseArgs({
  options: {
    fix: { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`
Data Quality: Duplicate Detection Script

Usage:
  node scripts/data-quality/check_duplicates.mjs [options]

Options:
  --fix      Auto-fix issues where possible (merge duplicates)
  --verbose  Show detailed information about each issue
  --help     Show this help message
`);
  process.exit(0);
}

// Junk data patterns to detect
const JUNK_PATTERNS = {
  emails: [
    "test@",
    "example.com",
    "fake@",
    "noemail@",
    "no@email",
    "none@",
    "n/a@",
    "na@",
    "unknown@",
    "xxx@",
    "abc@",
    "123@",
    "asdf@",
    "qwerty@",
  ],
  phones: [
    "0000000000",
    "1111111111",
    "1234567890",
    "9999999999",
    "5555555555",
    "000-000-0000",
    "111-111-1111",
    "123-456-7890",
  ],
  names: [
    "test",
    "unknown",
    "n/a",
    "na",
    "none",
    "xxx",
    "asdf",
    "qwerty",
    "foo",
    "bar",
    "john doe",
    "jane doe",
    "sample",
  ],
};

async function main() {
  const client = await pool.connect();

  console.log("=" .repeat(60));
  console.log("  DATA QUALITY: Duplicate Detection Report");
  console.log("=" .repeat(60));
  console.log("");

  const issues = {
    duplicate_places: [],
    duplicate_people_by_email: [],
    duplicate_people_by_phone: [],
    duplicate_cats_by_microchip: [],
    orphaned_place_relationships: [],
    orphaned_person_relationships: [],
    orphaned_cat_relationships: [],
    junk_emails: [],
    junk_phones: [],
    junk_names: [],
  };

  try {
    // ================================================================
    // 1. Check for duplicate places
    // ================================================================
    console.log("Checking for duplicate places...");

    const dupPlaces = await client.query(`
      SELECT
        normalized_address,
        ARRAY_AGG(place_id) as place_ids,
        ARRAY_AGG(display_name) as display_names,
        COUNT(*) as count
      FROM sot.places
      WHERE normalized_address IS NOT NULL
        AND merged_into_place_id IS NULL
      GROUP BY normalized_address
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 50
    `);

    issues.duplicate_places = dupPlaces.rows;
    console.log(`  Found ${dupPlaces.rows.length} duplicate place groups`);

    if (args.verbose && dupPlaces.rows.length > 0) {
      console.log("  Examples:");
      for (const row of dupPlaces.rows.slice(0, 5)) {
        console.log(`    - "${row.normalized_address}" (${row.count} copies)`);
      }
    }

    // ================================================================
    // 2. Check for duplicate people by email
    // ================================================================
    console.log("\nChecking for duplicate people by email...");

    const dupPeopleEmail = await client.query(`
      SELECT
        pi.id_value_norm as email,
        ARRAY_AGG(DISTINCT p.person_id) as person_ids,
        ARRAY_AGG(DISTINCT p.display_name) as display_names,
        COUNT(DISTINCT p.person_id) as count
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND p.merged_into_person_id IS NULL
        AND pi.id_value_norm IS NOT NULL
        AND pi.id_value_norm != ''
      GROUP BY pi.id_value_norm
      HAVING COUNT(DISTINCT p.person_id) > 1
      ORDER BY count DESC
      LIMIT 50
    `);

    issues.duplicate_people_by_email = dupPeopleEmail.rows;
    console.log(`  Found ${dupPeopleEmail.rows.length} emails with multiple people`);

    // ================================================================
    // 3. Check for duplicate people by phone
    // ================================================================
    console.log("\nChecking for duplicate people by phone...");

    const dupPeoplePhone = await client.query(`
      SELECT
        pi.id_value_norm as phone,
        ARRAY_AGG(DISTINCT p.person_id) as person_ids,
        ARRAY_AGG(DISTINCT p.display_name) as display_names,
        COUNT(DISTINCT p.person_id) as count
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'phone'
        AND p.merged_into_person_id IS NULL
        AND pi.id_value_norm IS NOT NULL
        AND pi.id_value_norm != ''
        AND NOT EXISTS (
          SELECT 1 FROM ops.identity_phone_blacklist pb
          WHERE pb.phone_norm = pi.id_value_norm
        )
      GROUP BY pi.id_value_norm
      HAVING COUNT(DISTINCT p.person_id) > 1
      ORDER BY count DESC
      LIMIT 50
    `);

    issues.duplicate_people_by_phone = dupPeoplePhone.rows;
    console.log(`  Found ${dupPeoplePhone.rows.length} phones with multiple people`);

    // ================================================================
    // 4. Check for duplicate cats by microchip
    // ================================================================
    console.log("\nChecking for duplicate cats by microchip...");

    const dupCats = await client.query(`
      SELECT
        ci.id_value as microchip,
        ARRAY_AGG(DISTINCT c.cat_id) as cat_ids,
        ARRAY_AGG(DISTINCT c.display_name) as display_names,
        COUNT(DISTINCT c.cat_id) as count
      FROM sot.cat_identifiers ci
      JOIN sot.cats c ON c.cat_id = ci.cat_id
      WHERE ci.id_type = 'microchip'
        AND c.merged_into_cat_id IS NULL
        AND ci.id_value IS NOT NULL
        AND ci.id_value != ''
      GROUP BY ci.id_value
      HAVING COUNT(DISTINCT c.cat_id) > 1
      ORDER BY count DESC
      LIMIT 50
    `);

    issues.duplicate_cats_by_microchip = dupCats.rows;
    console.log(`  Found ${dupCats.rows.length} microchips with multiple cats`);

    // ================================================================
    // 5. Check for orphaned relationships
    // ================================================================
    console.log("\nChecking for orphaned relationships...");

    // Place relationships pointing to merged places
    const orphanedPlaceRels = await client.query(`
      SELECT COUNT(*) as count
      FROM sot.cat_place_relationships cpr
      JOIN sot.places p ON p.place_id = cpr.place_id
      WHERE p.merged_into_place_id IS NOT NULL
    `);
    issues.orphaned_place_relationships = parseInt(orphanedPlaceRels.rows[0].count);
    console.log(`  Orphaned cat-place relationships: ${issues.orphaned_place_relationships}`);

    // Person relationships pointing to merged people
    const orphanedPersonRels = await client.query(`
      SELECT COUNT(*) as count
      FROM sot.person_cat_relationships pcr
      JOIN sot.people p ON p.person_id = pcr.person_id
      WHERE p.merged_into_person_id IS NOT NULL
    `);
    issues.orphaned_person_relationships = parseInt(orphanedPersonRels.rows[0].count);
    console.log(`  Orphaned person-cat relationships: ${issues.orphaned_person_relationships}`);

    // Cat relationships pointing to merged cats
    const orphanedCatRels = await client.query(`
      SELECT COUNT(*) as count
      FROM sot.person_cat_relationships pcr
      JOIN sot.cats c ON c.cat_id = pcr.cat_id
      WHERE c.merged_into_cat_id IS NOT NULL
    `);
    issues.orphaned_cat_relationships = parseInt(orphanedCatRels.rows[0].count);
    console.log(`  Orphaned cat relationships: ${issues.orphaned_cat_relationships}`);

    // ================================================================
    // 6. Check for junk data patterns
    // ================================================================
    console.log("\nChecking for junk data patterns...");

    // Junk emails
    const emailPatterns = JUNK_PATTERNS.emails.map((p, i) => `pi.id_value_norm ILIKE $${i + 1}`).join(" OR ");
    const junkEmails = await client.query(
      `
      SELECT pi.id_value_norm as email, COUNT(*) as count
      FROM sot.person_identifiers pi
      WHERE pi.id_type = 'email' AND (${emailPatterns})
      GROUP BY pi.id_value_norm
      ORDER BY count DESC
      `,
      JUNK_PATTERNS.emails.map(p => `%${p}%`)
    );
    issues.junk_emails = junkEmails.rows;
    console.log(`  Junk emails found: ${junkEmails.rows.length} patterns (${junkEmails.rows.reduce((sum, r) => sum + parseInt(r.count), 0)} total)`);

    // Junk phones
    const junkPhones = await client.query(`
      SELECT pi.id_value_norm as phone, COUNT(*) as count
      FROM sot.person_identifiers pi
      WHERE pi.id_type = 'phone'
        AND pi.id_value_norm IN (${JUNK_PATTERNS.phones.map((_, i) => `$${i + 1}`).join(", ")})
      GROUP BY pi.id_value_norm
      ORDER BY count DESC
    `, JUNK_PATTERNS.phones);
    issues.junk_phones = junkPhones.rows;
    console.log(`  Junk phones found: ${junkPhones.rows.length} patterns (${junkPhones.rows.reduce((sum, r) => sum + parseInt(r.count), 0)} total)`);

    // ================================================================
    // Summary
    // ================================================================
    console.log("\n" + "=" .repeat(60));
    console.log("  SUMMARY");
    console.log("=" .repeat(60));

    const totalIssues =
      issues.duplicate_places.length +
      issues.duplicate_people_by_email.length +
      issues.duplicate_people_by_phone.length +
      issues.duplicate_cats_by_microchip.length +
      issues.orphaned_place_relationships +
      issues.orphaned_person_relationships +
      issues.orphaned_cat_relationships +
      issues.junk_emails.length +
      issues.junk_phones.length;

    console.log(`
Duplicate Groups Found:
  - Places (same normalized_address): ${issues.duplicate_places.length}
  - People (same email): ${issues.duplicate_people_by_email.length}
  - People (same phone): ${issues.duplicate_people_by_phone.length}
  - Cats (same microchip): ${issues.duplicate_cats_by_microchip.length}

Orphaned Relationships:
  - Cat-Place: ${issues.orphaned_place_relationships}
  - Person-Cat (merged person): ${issues.orphaned_person_relationships}
  - Person-Cat (merged cat): ${issues.orphaned_cat_relationships}

Junk Data:
  - Junk email patterns: ${issues.junk_emails.length} (${issues.junk_emails.reduce((sum, r) => sum + parseInt(r.count), 0)} records)
  - Junk phone patterns: ${issues.junk_phones.length} (${issues.junk_phones.reduce((sum, r) => sum + parseInt(r.count), 0)} records)

Total issues: ${totalIssues > 0 ? totalIssues : "None detected! ✓"}
`);

    // Auto-fix if requested
    if (args.fix && totalIssues > 0) {
      console.log("=" .repeat(60));
      console.log("  AUTO-FIX MODE");
      console.log("=" .repeat(60));
      console.log("\nAttempting to fix issues...\n");

      // Fix duplicate places
      if (issues.duplicate_places.length > 0) {
        console.log("Merging duplicate places...");
        let placesMerged = 0;

        for (const dup of issues.duplicate_places) {
          const placeIds = dup.place_ids;
          if (placeIds.length < 2) continue;

          // Keep the first ID, merge others into it
          const keepId = placeIds[0];
          for (let i = 1; i < placeIds.length; i++) {
            try {
              await client.query(
                `SELECT sot.merge_places($1, $2, 'auto_dedupe')`,
                [keepId, placeIds[i]]
              );
              placesMerged++;
            } catch (error) {
              console.error(`  Error merging place ${placeIds[i]} into ${keepId}:`, error.message);
            }
          }
        }
        console.log(`  Merged ${placesMerged} duplicate places`);
      }

      // Note: We don't auto-merge people or cats - that requires human review
      if (issues.duplicate_people_by_email.length > 0 || issues.duplicate_people_by_phone.length > 0) {
        console.log("\nPeople duplicates require manual review in Admin > Data Engine");
      }

      if (issues.duplicate_cats_by_microchip.length > 0) {
        console.log("\nCat duplicates require manual review");
      }

      // Fix orphaned cat-place relationships
      if (issues.orphaned_place_relationships > 0) {
        console.log("\nFixing orphaned cat-place relationships...");

        // First, delete orphaned relationships that would cause duplicates
        const deleteResult = await client.query(`
          DELETE FROM sot.cat_place_relationships cpr
          USING sot.places p
          WHERE cpr.place_id = p.place_id
            AND p.merged_into_place_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM sot.cat_place_relationships cpr2
              WHERE cpr2.cat_id = cpr.cat_id
                AND cpr2.place_id = p.merged_into_place_id
                AND cpr2.relationship_type = cpr.relationship_type
                AND cpr2.source_system = cpr.source_system
                AND cpr2.source_table = cpr.source_table
            )
        `);
        console.log(`  Deleted ${deleteResult.rowCount} duplicate orphaned relationships`);

        // Then update remaining orphaned relationships
        const updateResult = await client.query(`
          UPDATE sot.cat_place_relationships cpr
          SET place_id = p.merged_into_place_id
          FROM sot.places p
          WHERE cpr.place_id = p.place_id
            AND p.merged_into_place_id IS NOT NULL
        `);
        console.log(`  Updated ${updateResult.rowCount} relationships to canonical places`);
      }

      // Fix orphaned person-cat relationships
      if (issues.orphaned_person_relationships > 0) {
        console.log("\nFixing orphaned person-cat relationships (merged people)...");

        // Delete duplicates first
        const deleteResult = await client.query(`
          DELETE FROM sot.person_cat_relationships pcr
          USING sot.people p
          WHERE pcr.person_id = p.person_id
            AND p.merged_into_person_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM sot.person_cat_relationships pcr2
              WHERE pcr2.person_id = p.merged_into_person_id
                AND pcr2.cat_id = pcr.cat_id
                AND pcr2.relationship_type = pcr.relationship_type
                AND pcr2.source_system = pcr.source_system
                AND pcr2.source_table = pcr.source_table
            )
        `);
        console.log(`  Deleted ${deleteResult.rowCount} duplicate orphaned relationships`);

        // Update remaining
        const updateResult = await client.query(`
          UPDATE sot.person_cat_relationships pcr
          SET person_id = p.merged_into_person_id
          FROM sot.people p
          WHERE pcr.person_id = p.person_id
            AND p.merged_into_person_id IS NOT NULL
        `);
        console.log(`  Updated ${updateResult.rowCount} relationships to canonical people`);
      }

      console.log("\n✓ Auto-fix complete");
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
