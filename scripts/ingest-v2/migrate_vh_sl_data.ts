#!/usr/bin/env npx tsx
/**
 * Migrate VolunteerHub and ShelterLuv data from V1 to V2
 *
 * This script:
 * 1. Copies volunteerhub_user_groups from V1 to V2
 * 2. Copies volunteerhub_volunteers from V1 to V2
 * 3. Copies volunteerhub_group_memberships from V1 to V2
 * 4. Updates matched_person_id references for V2
 *
 * Usage:
 *   npx tsx scripts/ingest-v2/migrate_vh_sl_data.ts
 */

import pg from "pg";

const V1_DATABASE_URL = process.env.V1_DATABASE_URL ||
  "postgresql://postgres.tpjllrfpdlkenbapvpko:vfh0xba%21ujx%21gwz%21UGJ@aws-1-us-east-2.pooler.supabase.com:6543/postgres";

const V2_DATABASE_URL = process.env.V2_DATABASE_URL ||
  "postgresql://postgres.afxpboxisgoxttyrbtpw:BfuM42NhYjPfLY%21%40vdBV@aws-0-us-west-2.pooler.supabase.com:5432/postgres";

async function migrate() {
  console.log("Starting VH/SL data migration from V1 to V2...\n");

  const v1 = new pg.Pool({ connectionString: V1_DATABASE_URL });
  const v2 = new pg.Pool({ connectionString: V2_DATABASE_URL });

  try {
    // ========================================
    // 1. Migrate volunteerhub_user_groups
    // ========================================
    console.log("1. Migrating volunteerhub_user_groups...");

    const v1Groups = await v1.query(`
      SELECT user_group_uid, name, description, parent_user_group_uid,
             atlas_role, atlas_trapper_type, is_approved_parent, synced_at, created_at
      FROM source.volunteerhub_user_groups
    `);

    let groupsInserted = 0;
    for (const row of v1Groups.rows) {
      try {
        await v2.query(`
          INSERT INTO source.volunteerhub_user_groups (
            user_group_uid, name, description, parent_user_group_uid,
            atlas_role, atlas_trapper_type, is_approved_parent, synced_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (user_group_uid) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            atlas_role = EXCLUDED.atlas_role,
            atlas_trapper_type = EXCLUDED.atlas_trapper_type,
            is_approved_parent = EXCLUDED.is_approved_parent,
            synced_at = EXCLUDED.synced_at
        `, [
          row.user_group_uid,
          row.name,
          row.description,
          row.parent_user_group_uid,
          row.atlas_role,
          row.atlas_trapper_type,
          row.is_approved_parent,
          row.synced_at,
          row.created_at
        ]);
        groupsInserted++;
      } catch (err: unknown) {
        const error = err as Error;
        console.error(`  Error inserting group ${row.user_group_uid}: ${error.message}`);
      }
    }
    console.log(`  ✓ Migrated ${groupsInserted}/${v1Groups.rowCount} groups\n`);

    // ========================================
    // 2. Migrate volunteerhub_volunteers
    // ========================================
    console.log("2. Migrating volunteerhub_volunteers...");

    // Build email -> V2 person_id lookup for re-matching
    const v2EmailToPersonId = new Map<string, string>();
    const v2People = await v2.query(`
      SELECT pi.id_value_norm AS email_norm, pi.person_id
      FROM sot.person_identifiers pi
      WHERE pi.id_type = 'email' AND pi.confidence >= 0.5
    `);
    for (const row of v2People.rows) {
      v2EmailToPersonId.set(row.email_norm, row.person_id);
    }

    // Get V1 volunteers - simplified columns (excluding generated ones)
    const v1Volunteers = await v1.query(`
      SELECT volunteerhub_id, email, first_name, last_name, phone,
             address, city, state, zip, status, roles, tags, hours_logged,
             last_activity_at, joined_at, raw_data, imported_at, synced_at,
             sync_status, sync_error, matched_person_id, matched_at,
             match_confidence, match_method, created_at, updated_at,
             user_group_uids, vh_version, last_api_sync_at, volunteer_notes,
             skills, volunteer_availability, languages, pronouns, occupation,
             how_heard, volunteer_motivation, emergency_contact_raw,
             can_drive, date_of_birth, volunteer_experience, is_active,
             event_count, last_login_at, username, waiver_status, match_locked
      FROM source.volunteerhub_volunteers
    `);

    let volunteersInserted = 0;
    let volunteersMatched = 0;
    for (const row of v1Volunteers.rows) {
      try {
        // Try to find matching person in V2 by email
        let v2PersonId: string | null = null;
        if (row.email) {
          const emailNorm = row.email.toLowerCase().trim();
          v2PersonId = v2EmailToPersonId.get(emailNorm) || null;
          if (v2PersonId) {
            volunteersMatched++;
          }
        }

        // Insert with only non-generated columns (exclude display_name, phone_norm, email_norm, full_address)
        await v2.query(`
          INSERT INTO source.volunteerhub_volunteers (
            volunteerhub_id, email, first_name, last_name, phone,
            address, city, state, zip, status, roles, tags, hours_logged,
            last_activity_at, joined_at, raw_data, imported_at, synced_at,
            sync_status, sync_error, matched_person_id, matched_at,
            match_confidence, match_method, created_at, updated_at,
            user_group_uids, vh_version, last_api_sync_at, volunteer_notes,
            skills, volunteer_availability, languages, pronouns, occupation,
            how_heard, volunteer_motivation, emergency_contact_raw,
            can_drive, date_of_birth, volunteer_experience, is_active,
            event_count, last_login_at, username, waiver_status, match_locked
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
            $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
            $41, $42, $43, $44, $45
          )
          ON CONFLICT (volunteerhub_id) DO UPDATE SET
            email = EXCLUDED.email,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            phone = EXCLUDED.phone,
            address = EXCLUDED.address,
            city = EXCLUDED.city,
            state = EXCLUDED.state,
            zip = EXCLUDED.zip,
            status = EXCLUDED.status,
            user_group_uids = EXCLUDED.user_group_uids,
            matched_person_id = COALESCE(EXCLUDED.matched_person_id, source.volunteerhub_volunteers.matched_person_id),
            synced_at = NOW()
        `, [
          row.volunteerhub_id, row.email, row.first_name, row.last_name, row.phone,
          row.address, row.city, row.state, row.zip, row.status,
          row.roles, row.tags, row.hours_logged, row.last_activity_at, row.joined_at,
          row.raw_data, row.imported_at, row.synced_at, row.sync_status, row.sync_error,
          v2PersonId, row.matched_at, row.match_confidence, row.match_method,
          row.created_at, row.updated_at, row.user_group_uids, row.vh_version,
          row.last_api_sync_at, row.volunteer_notes, row.skills, row.volunteer_availability,
          row.languages, row.pronouns, row.occupation, row.how_heard,
          row.volunteer_motivation, row.emergency_contact_raw, row.can_drive,
          row.date_of_birth, row.volunteer_experience, row.is_active,
          row.event_count, row.last_login_at, row.username, row.waiver_status, row.match_locked
        ]);
        volunteersInserted++;
      } catch (err: unknown) {
        const error = err as Error;
        console.error(`  Error inserting volunteer ${row.volunteerhub_id}: ${error.message}`);
      }
    }
    console.log(`  ✓ Migrated ${volunteersInserted}/${v1Volunteers.rowCount} volunteers`);
    console.log(`  ✓ Re-matched ${volunteersMatched} to V2 people\n`);

    // ========================================
    // 3. Migrate volunteerhub_group_memberships
    // ========================================
    console.log("3. Migrating volunteerhub_group_memberships...");

    const v1Memberships = await v1.query(`
      SELECT membership_id, volunteerhub_id, user_group_uid, joined_at, left_at, source, created_at, updated_at
      FROM source.volunteerhub_group_memberships
    `);

    let membershipsInserted = 0;
    for (const row of v1Memberships.rows) {
      try {
        await v2.query(`
          INSERT INTO source.volunteerhub_group_memberships (
            membership_id, volunteerhub_id, user_group_uid, joined_at, left_at, source, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (membership_id) DO UPDATE SET
            left_at = EXCLUDED.left_at,
            updated_at = EXCLUDED.updated_at
        `, [
          row.membership_id, row.volunteerhub_id, row.user_group_uid,
          row.joined_at, row.left_at, row.source, row.created_at, row.updated_at
        ]);
        membershipsInserted++;
      } catch (err: unknown) {
        const error = err as Error;
        // FK errors expected if volunteer doesn't exist
        if (!error.message.includes("foreign key")) {
          console.error(`  Error inserting membership ${row.membership_id}: ${error.message}`);
        }
      }
    }
    console.log(`  ✓ Migrated ${membershipsInserted}/${v1Memberships.rowCount} memberships\n`);

    // ========================================
    // 4. Migrate shelterluv_sync_state
    // ========================================
    console.log("4. Migrating shelterluv_sync_state...");

    const v1SyncState = await v1.query(`
      SELECT sync_type, last_sync_timestamp, last_sync_at, records_synced,
             total_records, error_message, created_at, updated_at, last_check_at
      FROM trapper.shelterluv_sync_state
    `);

    let syncStateInserted = 0;
    for (const row of v1SyncState.rows) {
      try {
        await v2.query(`
          INSERT INTO source.shelterluv_sync_state (
            sync_type, last_sync_timestamp, last_sync_at, records_synced,
            total_records, error_message, created_at, updated_at, last_check_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (sync_type) DO UPDATE SET
            last_sync_timestamp = EXCLUDED.last_sync_timestamp,
            last_sync_at = EXCLUDED.last_sync_at,
            records_synced = EXCLUDED.records_synced,
            total_records = EXCLUDED.total_records,
            updated_at = NOW()
        `, [
          row.sync_type, row.last_sync_timestamp, row.last_sync_at,
          row.records_synced, row.total_records, row.error_message,
          row.created_at, row.updated_at, row.last_check_at
        ]);
        syncStateInserted++;
      } catch (err: unknown) {
        const error = err as Error;
        console.error(`  Error inserting sync_state ${row.sync_type}: ${error.message}`);
      }
    }
    console.log(`  ✓ Migrated ${syncStateInserted}/${v1SyncState.rowCount} sync state records\n`);

    // ========================================
    // 5. Summary
    // ========================================
    console.log("=== Migration Summary ===");
    console.log(`User groups: ${groupsInserted}`);
    console.log(`Volunteers: ${volunteersInserted} (${volunteersMatched} re-matched to V2)`);
    console.log(`Group memberships: ${membershipsInserted}`);
    console.log(`Sync state: ${syncStateInserted}`);

    // Verify counts
    const v2Counts = await v2.query(`
      SELECT
        (SELECT COUNT(*) FROM source.volunteerhub_user_groups) AS groups,
        (SELECT COUNT(*) FROM source.volunteerhub_volunteers) AS volunteers,
        (SELECT COUNT(*) FROM source.volunteerhub_volunteers WHERE matched_person_id IS NOT NULL) AS matched,
        (SELECT COUNT(*) FROM source.volunteerhub_group_memberships) AS memberships
    `);
    console.log(`\nV2 Final Counts:`);
    console.log(`  Groups: ${v2Counts.rows[0].groups}`);
    console.log(`  Volunteers: ${v2Counts.rows[0].volunteers} (${v2Counts.rows[0].matched} matched)`);
    console.log(`  Memberships: ${v2Counts.rows[0].memberships}`);

    console.log("\n✓ Migration complete!");

  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await v1.end();
    await v2.end();
  }
}

migrate();
