#!/usr/bin/env npx tsx
/**
 * V2 Workflow Data Migration Script
 *
 * Migrates requests, intakes, and journal entries from V1 (East DB) to V2 (West DB).
 * Must be run AFTER ClinicHQ data ingest so that people/places exist in V2.
 *
 * Process:
 * 1. Reads requests/intakes from East DB
 * 2. Matches requesters to V2 people by email/phone
 * 3. Matches places to V2 places by address
 * 4. Inserts into West DB with correct V2 IDs
 *
 * Usage:
 *   export V1_DATABASE_URL='postgresql://...'  # East DB
 *   export V2_DATABASE_URL='postgresql://...'  # West DB
 *   npx tsx scripts/ingest-v2/migrate_workflow_data.ts [--dry-run]
 */

import { Pool, QueryResultRow } from "pg";
import { parseArgs } from "util";

// ============================================================================
// Configuration
// ============================================================================

const V1_DB_URL = process.env.V1_DATABASE_URL;
const V2_DB_URL = process.env.V2_DATABASE_URL;

if (!V1_DB_URL || !V2_DB_URL) {
  console.error("Missing database URLs.");
  console.error("");
  console.error("Run with:");
  console.error("  export V1_DATABASE_URL='postgresql://...east...'");
  console.error("  export V2_DATABASE_URL='postgresql://...west...'");
  console.error("  npx tsx scripts/ingest-v2/migrate_workflow_data.ts [--dry-run]");
  process.exit(1);
}

const v1Pool = new Pool({
  connectionString: V1_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

const v2Pool = new Pool({
  connectionString: V2_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// ============================================================================
// Helper Functions
// ============================================================================

async function v1Query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await v1Pool.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function v2Query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await v2Pool.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function v2QueryOne<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await v2Query<T>(sql, params);
  return rows[0] || null;
}

interface Stats {
  requests: { total: number; migrated: number; skipped: number; errors: number };
  intakes: { total: number; migrated: number; skipped: number; errors: number };
  journals: { total: number; migrated: number; skipped: number; errors: number };
  personMatches: number;
  placeMatches: number;
}

// ============================================================================
// Person Matching (V1 person_id -> V2 person_id)
// ============================================================================

async function findV2PersonId(v1PersonId: string): Promise<string | null> {
  // Get V1 person's email and phone
  const v1Person = await v1Query<{ primary_email: string | null; primary_phone: string | null }>(`
    SELECT primary_email, primary_phone
    FROM sot.people
    WHERE person_id = $1
  `, [v1PersonId]);

  if (!v1Person[0]) return null;
  const { primary_email, primary_phone } = v1Person[0];

  // Match in V2 by email first
  if (primary_email) {
    const byEmail = await v2QueryOne<{ person_id: string }>(`
      SELECT pi.person_id
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = LOWER($1)
        AND pi.confidence >= 0.5
        AND p.merged_into_person_id IS NULL
      ORDER BY pi.confidence DESC
      LIMIT 1
    `, [primary_email]);
    if (byEmail) return byEmail.person_id;
  }

  // Try phone
  if (primary_phone) {
    const phone = primary_phone.replace(/\D/g, "");
    const normalized = phone.length === 11 && phone.startsWith("1") ? phone.slice(1) : phone;

    const byPhone = await v2QueryOne<{ person_id: string }>(`
      SELECT pi.person_id
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'phone'
        AND pi.id_value_norm = $1
        AND pi.confidence >= 0.5
        AND p.merged_into_person_id IS NULL
      ORDER BY pi.confidence DESC
      LIMIT 1
    `, [normalized]);
    if (byPhone) return byPhone.person_id;
  }

  return null;
}

// ============================================================================
// Place Matching (V1 place_id -> V2 place_id)
// ============================================================================

async function findV2PlaceId(v1PlaceId: string): Promise<string | null> {
  // Get V1 place's address
  const v1Place = await v1Query<{ formatted_address: string | null }>(`
    SELECT formatted_address
    FROM sot.places
    WHERE place_id = $1
  `, [v1PlaceId]);

  if (!v1Place[0]?.formatted_address) return null;

  // Match in V2 by normalized address
  const v2Place = await v2QueryOne<{ place_id: string }>(`
    SELECT place_id
    FROM sot.places
    WHERE merged_into_place_id IS NULL
      AND normalized_address = sot.normalize_address($1)
    LIMIT 1
  `, [v1Place[0].formatted_address]);

  return v2Place?.place_id || null;
}

// ============================================================================
// Migrate Requests
// ============================================================================

async function migrateRequests(stats: Stats, dryRun: boolean): Promise<void> {
  console.log("\n=== Migrating Requests ===");

  // Get all requests from V1 - matching actual V1 column names
  const v1Requests = await v1Query<{
    request_id: string;
    status: string;
    priority: string | null;
    hold_reason: string | null;
    resolution_reason: string | null;
    summary: string | null;
    notes: string | null;
    internal_notes: string | null;
    estimated_cat_count: number | null;
    total_cats_reported: number | null;
    cat_count_semantic: string | null;
    place_id: string | null;
    requester_person_id: string | null;
    assignment_status: string | null;
    no_trapper_reason: string | null;
    resolved_at: Date | null;
    last_activity_at: Date | null;
    source_system: string | null;
    source_record_id: string | null;
    created_at: Date;
    updated_at: Date | null;
    source_created_at: Date | null;
  }>(`
    SELECT
      request_id, status, priority, hold_reason, resolution_reason,
      summary, notes, internal_notes,
      estimated_cat_count, total_cats_reported, cat_count_semantic,
      place_id, requester_person_id, assignment_status, no_trapper_reason,
      resolved_at, last_activity_at,
      source_system, source_record_id, created_at, updated_at, source_created_at
    FROM ops.requests
    ORDER BY created_at
  `);

  console.log(`  Found ${v1Requests.length} requests in V1`);
  stats.requests.total = v1Requests.length;

  for (const req of v1Requests) {
    try {
      // Check if already exists in V2
      const existing = await v2QueryOne<{ request_id: string }>(`
        SELECT request_id FROM ops.requests WHERE request_id = $1
      `, [req.request_id]);

      if (existing) {
        stats.requests.skipped++;
        continue;
      }

      // Find V2 person and place
      let v2PersonId: string | null = null;
      let v2PlaceId: string | null = null;

      if (req.requester_person_id) {
        v2PersonId = await findV2PersonId(req.requester_person_id);
        if (v2PersonId) stats.personMatches++;
      }

      if (req.place_id) {
        v2PlaceId = await findV2PlaceId(req.place_id);
        if (v2PlaceId) stats.placeMatches++;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would migrate request ${req.request_id} (person: ${v2PersonId ? "matched" : "null"}, place: ${v2PlaceId ? "matched" : "null"})`);
        stats.requests.migrated++;
        continue;
      }

      // Map V1 assignment_status to V2 allowed values
      // V2 allows: pending, assigned, accepted, declined, no_trapper_needed
      // V1 has: pending, assigned, client_trapping
      const mappedAssignmentStatus = req.assignment_status === "client_trapping"
        ? "no_trapper_needed"
        : req.assignment_status;

      // Insert into V2 - map resolution_reason -> resolution
      await v2Query(`
        INSERT INTO ops.requests (
          request_id, status, priority, hold_reason, resolution,
          summary, notes, internal_notes,
          estimated_cat_count, total_cats_reported, cat_count_semantic,
          place_id, requester_person_id, assignment_status, no_trapper_reason,
          resolved_at, last_activity_at,
          source_system, source_record_id, created_at, updated_at,
          source_created_at, migrated_at, original_created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, NOW(), $20
        )
        ON CONFLICT (request_id) DO NOTHING
      `, [
        req.request_id, req.status, req.priority, req.hold_reason, req.resolution_reason,
        req.summary, req.notes, req.internal_notes,
        req.estimated_cat_count, req.total_cats_reported, req.cat_count_semantic,
        v2PlaceId, v2PersonId, mappedAssignmentStatus, req.no_trapper_reason,
        req.resolved_at, req.last_activity_at,
        req.source_system || "airtable", req.source_record_id, req.created_at, req.updated_at,
        req.source_created_at,
      ]);

      stats.requests.migrated++;
    } catch (err) {
      console.error(`  Error migrating request ${req.request_id}:`, err);
      stats.requests.errors++;
    }
  }

  console.log(`  Migrated: ${stats.requests.migrated}, Skipped: ${stats.requests.skipped}, Errors: ${stats.requests.errors}`);
}

// ============================================================================
// Migrate Intakes
// ============================================================================

async function migrateIntakes(stats: Stats, dryRun: boolean): Promise<void> {
  console.log("\n=== Migrating Intakes ===");

  // Get all intakes from V1 with actual column names
  const v1Intakes = await v1Query<{
    submission_id: string;
    submitted_at: Date;
    ip_address: string | null;
    user_agent: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    requester_address: string | null;
    requester_city: string | null;
    requester_zip: string | null;
    cats_address: string | null;
    cats_city: string | null;
    cats_zip: string | null;
    county: string | null;
    ownership_status: string | null;
    cat_count_estimate: number | null;
    cat_count_text: string | null;
    fixed_status: string | null;
    has_kittens: boolean | null;
    kitten_count: number | null;
    kitten_age_estimate: string | null;
    awareness_duration: string | null;
    has_medical_concerns: boolean | null;
    medical_description: string | null;
    is_emergency: boolean | null;
    cats_being_fed: boolean | null;
    feeder_info: string | null;
    has_property_access: boolean | null;
    access_notes: string | null;
    is_property_owner: boolean | null;
    situation_description: string | null;
    referral_source: string | null;
    media_urls: string[] | null;
    triage_category: string | null;
    triage_score: number | null;
    triage_reasons: string[] | null;
    triage_computed_at: Date | null;
    reviewed_by: string | null;
    reviewed_at: Date | null;
    review_notes: string | null;
    final_category: string | null;
    matched_person_id: string | null;
    matched_place_id: string | null;
    created_request_id: string | null;
    status: string;
    created_at: Date;
  }>(`
    SELECT
      submission_id, submitted_at, ip_address, user_agent,
      first_name, last_name, email, phone,
      requester_address, requester_city, requester_zip,
      cats_address, cats_city, cats_zip, county,
      ownership_status, cat_count_estimate, cat_count_text, fixed_status,
      has_kittens, kitten_count, kitten_age_estimate, awareness_duration,
      has_medical_concerns, medical_description, is_emergency,
      cats_being_fed, feeder_info, has_property_access, access_notes,
      is_property_owner, situation_description, referral_source, media_urls,
      triage_category, triage_score, triage_reasons, triage_computed_at,
      reviewed_by, reviewed_at, review_notes, final_category,
      matched_person_id, matched_place_id, created_request_id, status, created_at
    FROM ops.web_intake_submissions
    ORDER BY submitted_at
  `);

  console.log(`  Found ${v1Intakes.length} intakes in V1`);
  stats.intakes.total = v1Intakes.length;

  for (const intake of v1Intakes) {
    try {
      // Check if exists
      const existing = await v2QueryOne<{ submission_id: string }>(`
        SELECT submission_id FROM ops.intake_submissions WHERE submission_id = $1
      `, [intake.submission_id]);

      if (existing) {
        stats.intakes.skipped++;
        continue;
      }

      // Skip slow person/place matching for now - will re-link after ClinicHQ batch completes
      // This avoids the very slow individual lookups for each intake
      const v2PersonId: string | null = null;
      const v2PlaceId: string | null = null;

      if (dryRun) {
        console.log(`  [DRY RUN] Would migrate intake ${intake.submission_id} (${intake.first_name} ${intake.last_name})`);
        stats.intakes.migrated++;
        continue;
      }

      // Map V1 status to V2 allowed values
      // V2 allows: new, triaged, reviewed, request_created, redirected, spam, closed
      // V1 has: new, request_created, triaged, archived
      const mappedStatus = intake.status === "archived" ? "closed" : intake.status;

      // Insert with V1->V2 column mapping
      await v2Query(`
        INSERT INTO ops.intake_submissions (
          submission_id, submitted_at, ip_address, user_agent,
          first_name, last_name, email, phone,
          requester_address, requester_city, requester_zip,
          cats_address, cats_city, cats_zip, county,
          ownership_status, cat_count_estimate, cat_count_text, fixed_status,
          has_kittens, kitten_count, kitten_age_estimate, awareness_duration,
          has_medical_concerns, medical_description, is_emergency,
          cats_being_fed, feeder_info, has_property_access, access_notes,
          is_property_owner, situation_description, referral_source, media_urls,
          triage_category, triage_score, triage_reasons, triage_computed_at,
          reviewed_by, reviewed_at, review_notes, final_category,
          person_id, place_id, request_id, status, created_at,
          migrated_at, original_created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
          $41, $42, $43, $44, $45, $46, $47, NOW(), $2
        )
        ON CONFLICT (submission_id) DO NOTHING
      `, [
        intake.submission_id, intake.submitted_at, intake.ip_address, intake.user_agent,
        intake.first_name, intake.last_name, intake.email, intake.phone,
        intake.requester_address, intake.requester_city, intake.requester_zip,
        intake.cats_address, intake.cats_city, intake.cats_zip, intake.county,
        intake.ownership_status, intake.cat_count_estimate, intake.cat_count_text, intake.fixed_status,
        intake.has_kittens, intake.kitten_count, intake.kitten_age_estimate, intake.awareness_duration,
        intake.has_medical_concerns, intake.medical_description, intake.is_emergency,
        intake.cats_being_fed, intake.feeder_info, intake.has_property_access, intake.access_notes,
        intake.is_property_owner, intake.situation_description, intake.referral_source, intake.media_urls,
        intake.triage_category, intake.triage_score, intake.triage_reasons, intake.triage_computed_at,
        intake.reviewed_by, intake.reviewed_at, intake.review_notes, intake.final_category,
        v2PersonId, v2PlaceId, intake.created_request_id, mappedStatus, intake.created_at,
      ]);

      stats.intakes.migrated++;
    } catch (err) {
      console.error(`  Error migrating intake ${intake.submission_id}:`, err);
      stats.intakes.errors++;
    }
  }

  console.log(`  Migrated: ${stats.intakes.migrated}, Skipped: ${stats.intakes.skipped}, Errors: ${stats.intakes.errors}`);
}

// ============================================================================
// Migrate Journal Entries
// ============================================================================

async function migrateJournals(stats: Stats, dryRun: boolean): Promise<void> {
  console.log("\n=== Migrating Journal Entries ===");

  // V1 uses different column names - map to V2
  const v1Journals = await v1Query<{
    id: string;
    entry_kind: string | null;
    title: string | null;
    body: string | null;
    primary_place_id: string | null;
    primary_request_id: string | null;
    primary_person_id: string | null;
    occurred_at: Date | null;
    created_by_staff_id: string | null;
    created_at: Date;
    updated_at: Date | null;
  }>(`
    SELECT
      id, entry_kind, title, body,
      primary_place_id, primary_request_id, primary_person_id,
      occurred_at, created_by_staff_id, created_at, updated_at
    FROM ops.journal_entries
    ORDER BY created_at
  `);

  console.log(`  Found ${v1Journals.length} journals in V1`);
  stats.journals.total = v1Journals.length;

  for (const journal of v1Journals) {
    try {
      const existing = await v2QueryOne<{ entry_id: string }>(`
        SELECT entry_id FROM ops.journal_entries WHERE entry_id = $1
      `, [journal.id]);

      if (existing) {
        stats.journals.skipped++;
        continue;
      }

      // Skip slow place matching for now - will re-link after ClinicHQ batch completes
      const v2PlaceId: string | null = null;

      if (dryRun) {
        stats.journals.migrated++;
        continue;
      }

      // Combine title and body for content
      const content = [journal.title, journal.body].filter(Boolean).join("\n\n");

      // Keep original entry_kind as entry_type (V2 constraint updated to support all V1 values)
      const entryType = journal.entry_kind || "note";

      await v2Query(`
        INSERT INTO ops.journal_entries (
          entry_id, place_id, entry_type, content, visibility,
          entry_date, source_system, created_at, updated_at, migrated_at
        ) VALUES ($1, $2, $3, $4, 'staff', $5, 'atlas', $6, $7, NOW())
        ON CONFLICT (entry_id) DO NOTHING
      `, [
        journal.id, v2PlaceId, entryType, content,
        journal.occurred_at || journal.created_at,
        journal.created_at, journal.updated_at,
      ]);

      stats.journals.migrated++;
    } catch (err) {
      console.error(`  Error migrating journal ${journal.id}:`, err);
      stats.journals.errors++;
    }
  }

  console.log(`  Migrated: ${stats.journals.migrated}, Skipped: ${stats.journals.skipped}, Errors: ${stats.journals.errors}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
    },
  });

  const dryRun = values["dry-run"] || false;

  console.log("=".repeat(60));
  console.log("V2 Workflow Data Migration");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log("");

  // Test connections
  console.log("Testing database connections...");
  try {
    const v1Test = await v1Query<{ count: string }>("SELECT COUNT(*) as count FROM ops.requests");
    console.log(`  V1 (East): Connected - ${v1Test[0].count} requests`);

    const v2Test = await v2Query<{ count: string }>("SELECT COUNT(*) as count FROM ops.requests");
    console.log(`  V2 (West): Connected - ${v2Test[0].count} requests`);
  } catch (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }

  const stats: Stats = {
    requests: { total: 0, migrated: 0, skipped: 0, errors: 0 },
    intakes: { total: 0, migrated: 0, skipped: 0, errors: 0 },
    journals: { total: 0, migrated: 0, skipped: 0, errors: 0 },
    personMatches: 0,
    placeMatches: 0,
  };

  await migrateRequests(stats, dryRun);
  await migrateIntakes(stats, dryRun);
  await migrateJournals(stats, dryRun);

  console.log("\n" + "=".repeat(60));
  console.log("COMPLETE");
  console.log("=".repeat(60));
  console.log(`Requests: ${stats.requests.migrated}/${stats.requests.total} migrated`);
  console.log(`Intakes: ${stats.intakes.migrated}/${stats.intakes.total} migrated`);
  console.log(`Journals: ${stats.journals.migrated}/${stats.journals.total} migrated`);
  console.log(`Person matches: ${stats.personMatches}`);
  console.log(`Place matches: ${stats.placeMatches}`);

  await v1Pool.end();
  await v2Pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
