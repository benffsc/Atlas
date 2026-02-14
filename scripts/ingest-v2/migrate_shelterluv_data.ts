#!/usr/bin/env npx tsx
/**
 * Migrate ShelterLuv data from V1 to V2
 *
 * IMPORTANT: V2 entities have DIFFERENT UUIDs than V1.
 * This script matches by identifier (shelterluv_id, email) NOT by UUID.
 *
 * Strategy:
 * 1. Migrate ShelterLuv cats (create new UUIDs in V2)
 * 2. Migrate cat_identifiers (shelterluv_id, microchip)
 * 3. Migrate person_cat relationships (match people by email)
 *
 * Follows CLAUDE.md ingestion principles:
 * - Preserve provenance (source_system, source_record_id)
 * - Match by identifier, not UUID
 * - No duplicate creation (check before insert)
 * - Proper column mapping
 *
 * Usage:
 *   npx tsx scripts/ingest-v2/migrate_shelterluv_data.ts
 *   npx tsx scripts/ingest-v2/migrate_shelterluv_data.ts --dry-run
 */

import pg from "pg";

const V1_DATABASE_URL = process.env.V1_DATABASE_URL ||
  "postgresql://postgres.tpjllrfpdlkenbapvpko:vfh0xba%21ujx%21gwz%21UGJ@aws-1-us-east-2.pooler.supabase.com:6543/postgres";

const V2_DATABASE_URL = process.env.V2_DATABASE_URL ||
  "postgresql://postgres.afxpboxisgoxttyrbtpw:BfuM42NhYjPfLY%21%40vdBV@aws-0-us-west-2.pooler.supabase.com:5432/postgres";

const DRY_RUN = process.argv.includes("--dry-run");

interface V1Cat {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  birth_year: number | null;
  breed: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  notes: string | null;
  data_source: string;
  ownership_type: string | null;
  is_deceased: boolean;
  deceased_date: string | null;
  created_at: string;
  updated_at: string;
}

interface V1CatIdentifier {
  cat_id: string;
  id_type: string;
  id_value: string;
  source_system: string;
  created_at: string;
}

interface V1PersonCatRel {
  person_id: string;
  cat_id: string;
  relationship_type: string;
  confidence: number;
  source_system: string;
  created_at: string;
  person_email: string | null;
  person_phone: string | null;
}

async function migrateShelterLuv() {
  console.log("=".repeat(70));
  console.log("  ShelterLuv Data Migration: V1 → V2");
  console.log("=".repeat(70));
  console.log("");
  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE - No changes will be made\n");
  }

  const v1 = new pg.Pool({ connectionString: V1_DATABASE_URL });
  const v2 = new pg.Pool({ connectionString: V2_DATABASE_URL });

  try {
    // =========================================================================
    // Pre-flight checks
    // =========================================================================
    console.log("1. Pre-flight checks...");

    // Check V2 doesn't already have ShelterLuv cats
    const v2SlCheck = await v2.query(`
      SELECT COUNT(*) as cnt FROM sot.cats WHERE source_system = 'shelterluv'
    `);
    if (parseInt(v2SlCheck.rows[0].cnt) > 0) {
      console.log(`   ⚠️  V2 already has ${v2SlCheck.rows[0].cnt} ShelterLuv cats`);
      console.log("   Skipping cat migration to avoid duplicates");
    }

    // =========================================================================
    // Step 1: Fetch V1 ShelterLuv cats with identifiers
    // =========================================================================
    console.log("\n2. Fetching V1 ShelterLuv cats...");

    const v1Cats = await v1.query<V1Cat>(`
      SELECT
        cat_id,
        display_name,
        sex,
        altered_status,
        birth_year,
        breed,
        primary_color,
        secondary_color,
        notes,
        data_source,
        ownership_type,
        COALESCE(is_deceased, false) as is_deceased,
        deceased_date,
        created_at,
        updated_at
      FROM sot.cats
      WHERE data_source = 'shelterluv'
        AND merged_into_cat_id IS NULL
      ORDER BY created_at
    `);
    console.log(`   Found ${v1Cats.rowCount} ShelterLuv cats in V1`);

    // Fetch identifiers for these cats
    const v1Identifiers = await v1.query<V1CatIdentifier>(`
      SELECT
        ci.cat_id,
        ci.id_type,
        ci.id_value,
        ci.source_system,
        ci.created_at
      FROM sot.cat_identifiers ci
      JOIN sot.cats c ON c.cat_id = ci.cat_id
      WHERE c.data_source = 'shelterluv'
        AND c.merged_into_cat_id IS NULL
    `);
    console.log(`   Found ${v1Identifiers.rowCount} identifiers for ShelterLuv cats`);

    // Build lookup: V1 cat_id → identifiers
    const catIdentifiers = new Map<string, V1CatIdentifier[]>();
    for (const ident of v1Identifiers.rows) {
      if (!catIdentifiers.has(ident.cat_id)) {
        catIdentifiers.set(ident.cat_id, []);
      }
      catIdentifiers.get(ident.cat_id)!.push(ident);
    }

    // =========================================================================
    // Step 2: Build V2 person lookup by email (for relationship matching)
    // =========================================================================
    console.log("\n3. Building V2 person lookup by email...");

    const v2People = await v2.query<{ person_id: string; email: string }>(`
      SELECT person_id, LOWER(TRIM(id_value_norm)) as email
      FROM sot.person_identifiers
      WHERE id_type = 'email'
        AND confidence >= 0.5
    `);

    const v2PersonByEmail = new Map<string, string>();
    for (const p of v2People.rows) {
      if (!v2PersonByEmail.has(p.email)) {
        v2PersonByEmail.set(p.email, p.person_id);
      }
    }
    console.log(`   V2 has ${v2PersonByEmail.size} unique emails`);

    // =========================================================================
    // Step 3: Fetch V1 person_cat relationships with person emails
    // =========================================================================
    console.log("\n4. Fetching V1 person-cat relationships...");

    const v1Relationships = await v1.query<V1PersonCatRel>(`
      SELECT
        pcr.person_id,
        pcr.cat_id,
        pcr.relationship_type,
        pcr.confidence,
        pcr.source_system,
        pcr.created_at,
        (
          SELECT LOWER(TRIM(pi.id_value_norm))
          FROM sot.person_identifiers pi
          WHERE pi.person_id = pcr.person_id
            AND pi.id_type = 'email'
          ORDER BY pi.created_at
          LIMIT 1
        ) as person_email,
        (
          SELECT pi.id_value_norm
          FROM sot.person_identifiers pi
          WHERE pi.person_id = pcr.person_id
            AND pi.id_type = 'phone'
          ORDER BY pi.created_at
          LIMIT 1
        ) as person_phone
      FROM sot.person_cat pcr
      JOIN sot.cats c ON c.cat_id = pcr.cat_id
      WHERE c.data_source = 'shelterluv'
        AND c.merged_into_cat_id IS NULL
    `);
    console.log(`   Found ${v1Relationships.rowCount} person-cat relationships`);

    // =========================================================================
    // Step 4: Migrate cats
    // =========================================================================
    console.log("\n5. Migrating cats to V2...");

    // Map V1 cat_id → V2 cat_id (for relationship migration)
    const v1ToV2CatId = new Map<string, string>();
    let catsInserted = 0;
    let catsSkipped = 0;
    let catErrors = 0;

    for (const cat of v1Cats.rows) {
      // Get shelterluv_id for this cat
      const identifiers = catIdentifiers.get(cat.cat_id) || [];
      const slIdent = identifiers.find(i => i.id_type === "shelterluv_id");
      const microchip = identifiers.find(i => i.id_type === "microchip");

      // Check if already exists in V2 by shelterluv_id
      if (slIdent) {
        const existing = await v2.query(`
          SELECT cat_id FROM sot.cats WHERE shelterluv_animal_id = $1
        `, [slIdent.id_value]);

        if (existing.rowCount && existing.rowCount > 0) {
          v1ToV2CatId.set(cat.cat_id, existing.rows[0].cat_id);
          catsSkipped++;
          continue;
        }
      }

      // Insert new cat
      if (!DRY_RUN) {
        try {
          const result = await v2.query(`
            INSERT INTO sot.cats (
              name,
              microchip,
              shelterluv_animal_id,
              sex,
              breed,
              primary_color,
              secondary_color,
              altered_status,
              ownership_type,
              is_deceased,
              deceased_at,
              data_quality,
              source_system,
              source_record_id,
              created_at,
              updated_at,
              source_created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING cat_id
          `, [
            cat.display_name,
            microchip?.id_value || null,
            slIdent?.id_value || null,
            cat.sex,
            cat.breed,
            cat.primary_color,
            cat.secondary_color,
            cat.altered_status,
            cat.ownership_type,
            cat.is_deceased,
            cat.deceased_date,
            "normal",
            "shelterluv",
            slIdent?.id_value || cat.cat_id,
            cat.created_at,
            cat.updated_at,
            cat.created_at
          ]);

          v1ToV2CatId.set(cat.cat_id, result.rows[0].cat_id);
          catsInserted++;
        } catch (err: unknown) {
          const error = err as Error;
          catErrors++;
          if (catErrors <= 5) {
            console.error(`   Error inserting cat ${cat.display_name}: ${error.message}`);
          }
        }
      } else {
        // Dry run - generate a placeholder UUID
        v1ToV2CatId.set(cat.cat_id, `dry-run-${cat.cat_id}`);
        catsInserted++;
      }

      // Progress
      if ((catsInserted + catsSkipped) % 200 === 0) {
        console.log(`   Progress: ${catsInserted + catsSkipped}/${v1Cats.rowCount} cats...`);
      }
    }

    console.log(`\n   Cats inserted: ${catsInserted}`);
    console.log(`   Cats skipped (already exist): ${catsSkipped}`);
    console.log(`   Errors: ${catErrors}`);

    // =========================================================================
    // Step 5: Migrate cat identifiers
    // =========================================================================
    console.log("\n6. Migrating cat identifiers...");

    let identsInserted = 0;
    let identsSkipped = 0;

    for (const [v1CatId, identifiers] of catIdentifiers) {
      const v2CatId = v1ToV2CatId.get(v1CatId);
      if (!v2CatId || v2CatId.startsWith("dry-run-")) {
        continue;
      }

      for (const ident of identifiers) {
        if (!DRY_RUN) {
          try {
            await v2.query(`
              INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, confidence, created_at)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (cat_id, id_type, id_value) DO NOTHING
            `, [
              v2CatId,
              ident.id_type,
              ident.id_value,
              ident.source_system,
              1.0,
              ident.created_at
            ]);
            identsInserted++;
          } catch {
            identsSkipped++;
          }
        } else {
          identsInserted++;
        }
      }
    }

    console.log(`   Identifiers inserted: ${identsInserted}`);
    console.log(`   Identifiers skipped: ${identsSkipped}`);

    // =========================================================================
    // Step 6: Migrate person-cat relationships
    // =========================================================================
    console.log("\n7. Migrating person-cat relationships...");

    let relsInserted = 0;
    let relsSkipped = 0;
    let relsNoMatch = 0;

    for (const rel of v1Relationships.rows) {
      const v2CatId = v1ToV2CatId.get(rel.cat_id);
      if (!v2CatId || v2CatId.startsWith("dry-run-")) {
        relsSkipped++;
        continue;
      }

      // Find V2 person by email
      let v2PersonId: string | null = null;
      if (rel.person_email) {
        v2PersonId = v2PersonByEmail.get(rel.person_email) || null;
      }

      if (!v2PersonId) {
        relsNoMatch++;
        continue;
      }

      if (!DRY_RUN) {
        try {
          await v2.query(`
            INSERT INTO sot.person_cat (
              person_id,
              cat_id,
              relationship_type,
              evidence_type,
              confidence,
              source_system,
              created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (person_id, cat_id, relationship_type) DO NOTHING
          `, [
            v2PersonId,
            v2CatId,
            rel.relationship_type,
            "system",
            rel.confidence,
            rel.source_system || "shelterluv",
            rel.created_at
          ]);
          relsInserted++;
        } catch {
          relsSkipped++;
        }
      } else {
        relsInserted++;
      }
    }

    console.log(`   Relationships inserted: ${relsInserted}`);
    console.log(`   Relationships skipped: ${relsSkipped}`);
    console.log(`   No V2 person match: ${relsNoMatch}`);

    // =========================================================================
    // Step 7: Verification
    // =========================================================================
    console.log("\n8. Verification...");

    if (!DRY_RUN) {
      const v2CatCount = await v2.query(`
        SELECT source_system, COUNT(*) as cnt
        FROM sot.cats
        WHERE merged_into_cat_id IS NULL
        GROUP BY source_system
        ORDER BY cnt DESC
      `);
      console.log("\n   V2 cats by source:");
      for (const row of v2CatCount.rows) {
        console.log(`     ${row.source_system}: ${row.cnt}`);
      }

      const v2RelCount = await v2.query(`
        SELECT pc.relationship_type, COUNT(*) as cnt
        FROM sot.person_cat pc
        JOIN sot.cats c ON c.cat_id = pc.cat_id
        WHERE c.source_system = 'shelterluv'
        GROUP BY pc.relationship_type
        ORDER BY cnt DESC
      `);
      console.log("\n   ShelterLuv person-cat relationships:");
      for (const row of v2RelCount.rows) {
        console.log(`     ${row.relationship_type}: ${row.cnt}`);
      }
    }

    // =========================================================================
    // Summary
    // =========================================================================
    console.log("\n" + "=".repeat(70));
    console.log("  ShelterLuv Migration Complete!");
    console.log("=".repeat(70));
    console.log(`\nSummary:`);
    console.log(`  - Cats migrated: ${catsInserted}`);
    console.log(`  - Cat identifiers: ${identsInserted}`);
    console.log(`  - Person-cat relationships: ${relsInserted}`);
    console.log(`  - People not found in V2: ${relsNoMatch}`);
    if (DRY_RUN) {
      console.log("\n⚠️  This was a DRY RUN. Run without --dry-run to apply changes.");
    }

  } catch (error) {
    console.error("\nMigration failed:", error);
    process.exit(1);
  } finally {
    await v1.end();
    await v2.end();
  }
}

migrateShelterLuv();
