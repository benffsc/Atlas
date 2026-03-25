#!/usr/bin/env node
/**
 * Airtable FFSC Center Base Sync
 *
 * Syncs Trapping Requests and Appointment Requests from the main
 * Forgotten Felines Center Base into Atlas, including parsing
 * Internal Notes as legacy journal entries.
 *
 * Data flow:
 * 1. Fetch records from FFSC Center Base (Trapping Requests, Appointment Requests)
 * 2. Upsert into Atlas sot_requests
 * 3. Parse Internal Notes into journal entries with staff attribution
 *
 * Run manually:
 *   node scripts/ingest/airtable_ffsc_requests_sync.mjs
 *
 * Or via cron for ongoing sync.
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
dotenv.config({ path: join(__dirname, "../../.env") });

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const FFSC_BASE_ID = "appl6zLrRFDvsz0dh";
const TRAPPING_REQUESTS_TABLE = "tblc1bva7jFzg8DVF";
const APPOINTMENT_REQUESTS_TABLE = "tbltFEFUPMS6KZU8Y";
const DATABASE_URL = process.env.DATABASE_URL;

if (!AIRTABLE_PAT || !DATABASE_URL) {
  console.error("Missing AIRTABLE_PAT or DATABASE_URL");
  process.exit(1);
}

// Staff initials to Atlas staff_id mapping (for journal entries)
const STAFF_INITIALS = {
  AA: "19548fbd-1027-4a75-aaa2-90b7893ca536", // Addie Anderson
  BM: "cf7109a1-c17b-4ef9-a67a-9bc9b79b780e", // Ben Mis
  BB: "4f262ee8-56e9-46da-a1a7-e9329d0dc4f0", // Brian Benn
  BS: "bd166496-b53b-4b98-a7f6-be465b0409fa", // Bridget Shannon
  CF: "540dd040-2c6c-4754-874b-2d1a5e27a089", // Crystal Furtado
  EB: "bb00a6d3-3c04-4cd7-83b9-94bef8c1a60a", // Ethan Britton
  HF: "06c80af5-b7fd-46c2-bedd-aafe13a72aa9", // Heidi Fantacone
  JK: "cc5ac3b1-c439-4dab-b9e3-1982fdd9da15", // Jami Knuthson
  JC: "6f509893-ec0b-41df-88ce-3343f9f1c8ed", // Jennifer Cochran
  JR: "c9f4f842-19bc-461d-a272-e7160e445935", // Julia Rosenfeld
  KM: "221e3e4f-34f6-4812-81c0-4170bb576cf2", // Kate McLaren
  NH: "8ee52274-d3a4-44a7-97a7-18dd9f58321d", // Neely Hart
  PM: "a51bf233-2daa-4ce5-b533-5a4f5c944ee4", // Pip Marquez de la Plata
  SN: "931d1b49-3f77-4620-bf69-4e806c56e32c", // Sandra Nicander
  SF: "cedbb19d-caee-498e-a928-53874233b75d", // Stephanie Fuller
  TA: "faa5e0b4-3978-4aba-8ef8-c321dc60f115", // Tyce Abbot
  VV: "36e6ac85-66af-4896-a0fa-6d445b51261c", // Valentina Viti
};

// Database connection
const pool = new pg.Pool({ connectionString: DATABASE_URL });

/**
 * Parse Internal Notes into individual journal entries
 *
 * Format patterns:
 * - "MM/DD/YY INITIALS note text"
 * - "MM/DD/YYYY INITIALS note text"
 * - "YYYY-MM-DDTHH:MM:SS.sssZ INITIALS note text"
 *
 * Entries are separated by double newlines
 */
function parseInternalNotes(notesText) {
  if (!notesText || typeof notesText !== "string") return [];

  const entries = [];

  // Split by double newlines (entries are separated this way)
  const blocks = notesText.split(/\n\n+/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Try to parse date and initials from the start of the block
    // Pattern 1: MM/DD/YY or MM/DD/YYYY
    const datePattern1 = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+([A-Z]{2})\s+/;
    // Pattern 2: ISO format
    const datePattern2 = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+([A-Z]{2})\s+/;

    let entryDate = null;
    let staffInitials = null;
    let noteText = trimmed;

    const match1 = trimmed.match(datePattern1);
    const match2 = trimmed.match(datePattern2);

    if (match1) {
      const [fullMatch, month, day, year] = match1;
      staffInitials = match1[4];
      // Convert 2-digit year to 4-digit
      const fullYear = year.length === 2 ? `20${year}` : year;
      entryDate = new Date(`${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
      noteText = trimmed.slice(fullMatch.length).trim();
    } else if (match2) {
      const [fullMatch, isoDate, initials] = match2;
      entryDate = new Date(isoDate);
      staffInitials = initials;
      noteText = trimmed.slice(fullMatch.length).trim();
    } else {
      // No date pattern found - might be continuation or unparseable
      // Check if it starts with just initials
      const initialsOnly = /^([A-Z]{2})\s+/;
      const initialsMatch = trimmed.match(initialsOnly);
      if (initialsMatch) {
        staffInitials = initialsMatch[1];
        noteText = trimmed.slice(initialsMatch[0].length).trim();
      }
    }

    if (noteText) {
      entries.push({
        date: entryDate,
        initials: staffInitials,
        staffPersonId: staffInitials ? STAFF_INITIALS[staffInitials] || null : null,
        text: noteText,
        raw: trimmed,
      });
    }
  }

  return entries;
}

/**
 * Fetch all records from an Airtable table with pagination
 */
async function fetchAllRecords(tableId, fields = []) {
  const allRecords = [];
  let offset = null;

  do {
    let url = `https://api.airtable.com/v0/${FFSC_BASE_ID}/${tableId}?pageSize=100`;
    if (fields.length > 0) {
      url += "&" + fields.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join("&");
    }
    if (offset) {
      url += `&offset=${offset}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    });

    if (!response.ok) {
      throw new Error(`Airtable fetch failed: ${response.status}`);
    }

    const data = await response.json();
    allRecords.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return allRecords;
}

/**
 * Map Airtable Case Status to Atlas request status
 */
function mapCaseStatus(airtableStatus) {
  if (!airtableStatus) return "new";
  const s = airtableStatus.toLowerCase().trim();

  // Completed/closed states
  if (s.includes("closed") || s === "complete") return "completed";
  if (s.includes("partially complete")) return "in_progress"; // Still has work to do

  // Cancelled/inactive states
  if (s.includes("duplicate")) return "cancelled";
  if (s.includes("denied")) return "cancelled";
  if (s.includes("referred")) return "cancelled"; // Referred elsewhere = not our case
  if (s.includes("cancel")) return "cancelled";

  // On hold / revisit
  if (s.includes("hold") || s.includes("wait")) return "on_hold";
  if (s.includes("revisit")) return "on_hold"; // Will revisit later

  // Active states
  if (s.includes("active") || s.includes("progress")) return "in_progress";
  if (s.includes("schedule")) return "scheduled";
  if (s.includes("triage") || s.includes("review")) return "triaged";

  // Only "Requested" should map to "new"
  return "new";
}

/**
 * Find or create a person from contact info
 * Uses the centralized SQL function for consistency with other ingests
 */
async function findOrCreatePerson(firstName, lastName, phone, email) {
  if (!firstName && !lastName) return null;
  if (!email && !phone) return null;

  // Use the centralized find_or_create_person SQL function
  // This function handles:
  // - Email/phone normalization using sot.norm_phone_us()
  // - Lookup via person_identifiers table
  // - Phone blacklist checking
  // - Canonical person resolution (handles merged persons)
  // - Creating person and identifiers if not found
  const result = await pool.query(
    `SELECT sot.find_or_create_person($1, $2, $3, $4, NULL, 'airtable') as person_id`,
    [email || null, phone || null, firstName || null, lastName || null]
  );

  return result.rows[0]?.person_id || null;
}

/**
 * Find or create a place from address using the deduped SQL function
 * This auto-queues places for geocoding if no coordinates provided
 */
async function findOrCreatePlace(address, lat, lng) {
  if (!address) return null;

  // Use the SQL function that handles deduplication and auto-queues geocoding
  const result = await pool.query(
    `SELECT sot.find_or_create_place_deduped($1, NULL, $2, $3, 'airtable') as place_id`,
    [address, lat || null, lng || null]
  );

  return result.rows[0]?.place_id || null;
}

/**
 * Sync a single Trapping Request to Atlas
 *
 * Uses the centralized find_or_create_request() function per CLAUDE.md guidelines.
 * This function handles:
 * - Deduplication by source_system + source_record_id
 * - Auto-creation of places from raw address
 * - Auto-creation of people from contact info
 * - Proper source_created_at tracking for attribution windows
 * - Audit logging to entity_edits
 */
async function syncTrappingRequest(record) {
  const f = record.fields;

  // Build address
  const address = f["Address"] || "";
  const lat = f["Latitude"];
  const lng = f["Longitude"];

  // Get contact info
  const firstName = f["First Name"] || "";
  const lastName = f["Last Name"] || "";
  const phone = f["Client Number"] || "";
  const email = f["Email"] || "";

  // Parse internal notes
  const internalNotes = f["Internal Notes "] || "";
  const journalEntries = parseInternalNotes(internalNotes);

  // Build summary: prefer client name, then Client Name field, then address/place name
  let summary;
  if (firstName || lastName) {
    summary = `${firstName} ${lastName}`.trim();
  } else if (f["Client Name"]) {
    summary = f["Client Name"];
  } else if (address) {
    // Use address as summary for legacy requests without client info
    // Truncate long addresses for display
    summary = address.length > 50 ? address.slice(0, 47) + "..." : address;
  } else {
    summary = `Case #${f["Case Number"] || record.id.slice(0, 8)}`;
  }

  const status = mapCaseStatus(f["Case Status"]);

  // Find or create place first (if we have lat/lng, use that)
  // Otherwise, find_or_create_request will create place from raw address
  let placeId = null;
  if (lat && lng) {
    placeId = await findOrCreatePlace(address, lat, lng);
  }

  // Use centralized find_or_create_request() function
  // This handles deduplication, person/place creation, and audit logging
  const result = await pool.query(
    `SELECT ops.find_or_create_request(
      p_source_system := $1,
      p_source_record_id := $2,
      p_source_created_at := $3,
      p_place_id := $4,
      p_raw_address := $5,
      p_requester_email := $6,
      p_requester_phone := $7,
      p_requester_name := $8,
      p_summary := $9,
      p_notes := $10,
      p_estimated_cat_count := $11,
      p_status := $12,
      p_request_purpose := $13,
      p_internal_notes := $14,
      p_created_by := $15
    ) as request_id`,
    [
      "airtable",                                              // source_system
      record.id,                                               // source_record_id
      f["Case opened date"] ? new Date(f["Case opened date"]) : null, // source_created_at
      placeId,                                                 // place_id (if we have coords)
      placeId ? null : address || null,                        // raw_address (only if no place_id)
      email || null,                                           // requester_email
      phone || null,                                           // requester_phone
      (firstName || lastName) ? `${firstName} ${lastName}`.trim() : (f["Client Name"] || null), // requester_name
      summary,                                                 // summary
      f["Case Info"] || null,                                  // notes
      parseInt(f["Total Cats to be trapped"]) || null,        // estimated_cat_count
      status,                                                  // status
      "tnr",                                                   // request_purpose
      internalNotes || null,                                   // internal_notes
      "airtable_ffsc_sync",                                    // created_by
    ]
  );

  const requestId = result.rows[0]?.request_id;

  // Sync journal entries from Internal Notes
  for (const entry of journalEntries) {
    // Check if this exact entry already exists (by text hash to avoid duplicates)
    const entryHash = Buffer.from(entry.raw).toString("base64").slice(0, 100);

    const existingEntry = await pool.query(
      `SELECT id FROM ops.journal_entries
       WHERE primary_request_id = $1 AND legacy_hash = $2`,
      [requestId, entryHash]
    );

    if (existingEntry.rows.length === 0) {
      await pool.query(
        `INSERT INTO ops.journal_entries (
          primary_request_id, body, occurred_at, created_by_staff_id,
          entry_kind, created_by, legacy_hash, tags, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          requestId,
          entry.text,
          entry.date || new Date(),
          entry.staffPersonId, // This is now staff_id
          "note", // Legacy notes are all internal notes
          "airtable_ffsc_legacy",
          entryHash,
          ["legacy", "imported"],
        ]
      );
    }
  }

  return { requestId, journalEntriesCount: journalEntries.length };
}

/**
 * Sync a single Appointment Request to Atlas as Legacy Intake Submission
 * These go to web_intake_submissions (not sot_requests)
 */
async function syncAppointmentToIntake(record) {
  const f = record.fields;

  // Get contact info
  const firstName = f["First Name"] || "";
  const lastName = f["Last Name"] || "";
  const phone = f["Best phone number to reach you"] || "";
  const email = f["Email"] || "";

  // Get address - appointment requests use "Clean Address (Cats)" or "Clean Address"
  const address = f["Clean Address (Cats)"] || f["Clean Address"] || "";

  // Find or create place using the deduped function (auto-queues geocoding)
  const placeId = await findOrCreatePlace(address, null, null);

  // Find or create person
  const personId = await findOrCreatePerson(firstName, lastName, phone, email);

  // Map Airtable status to intake status
  // Valid statuses: new, triaged, reviewed, request_created, redirected, client_handled, archived
  const airtableStatus = (f["Status"] || "").toLowerCase();
  let intakeStatus = "new";
  if (airtableStatus.includes("complete") || airtableStatus.includes("done")) {
    intakeStatus = "archived";
  } else if (airtableStatus.includes("cancel")) {
    intakeStatus = "archived";
  } else if (airtableStatus.includes("scheduled") || airtableStatus.includes("appt")) {
    intakeStatus = "request_created";
  } else if (airtableStatus.includes("pending") || airtableStatus.includes("review")) {
    intakeStatus = "new";
  } else if (airtableStatus.includes("triage")) {
    intakeStatus = "triaged";
  }

  // Check if already exists
  const existingResult = await pool.query(
    `SELECT submission_id FROM ops.intake_submissions
     WHERE legacy_source_id = $1`,
    [record.id]
  );

  const submittedAt = f["New Submitted"] ? new Date(f["New Submitted"]) : new Date(record.createdTime);
  const catCount = parseInt(f["Estimated number of unowned/feral/stray cats"]) || null;
  const situationDesc = f["Describe the Situation "] || null;

  if (existingResult.rows.length > 0) {
    // Update existing
    const submissionId = existingResult.rows[0].submission_id;
    await pool.query(
      `UPDATE ops.intake_submissions SET
        first_name = $1,
        last_name = $2,
        email = $3,
        phone = $4,
        cats_address = $5,
        cat_count_estimate = $6,
        situation_description = $7,
        place_id = COALESCE($8, place_id),
        matched_person_id = COALESCE($9, matched_person_id),
        status = $10,
        updated_at = NOW()
       WHERE submission_id = $11`,
      [firstName, lastName, email, phone, address, catCount, situationDesc, placeId, personId, intakeStatus, submissionId]
    );
    return { submissionId, isNew: false };
  } else {
    // Create new intake submission
    const insertResult = await pool.query(
      `INSERT INTO ops.intake_submissions (
        submitted_at, first_name, last_name, email, phone,
        cats_address, cat_count_estimate, situation_description,
        place_id, matched_person_id, matched_place_id,
        is_legacy, legacy_source_id, intake_source, status,
        ownership_status, fixed_status,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
      RETURNING submission_id`,
      [
        submittedAt,
        firstName,
        lastName,
        email,
        phone,
        address,
        catCount,
        situationDesc,
        placeId,
        personId,
        placeId, // matched_place_id same as place_id
        true, // is_legacy
        record.id, // legacy_source_id
        "legacy_airtable", // intake_source enum
        intakeStatus,
        "unknown_stray", // Default ownership_status for legacy records
        "unknown", // Default fixed_status for legacy records
      ]
    );
    return { submissionId: insertResult.rows[0].submission_id, isNew: true };
  }
}

/**
 * Ensure journal_entries table has legacy_hash column for deduplication
 */
async function ensureLegacyHashColumn() {
  await pool.query(`
    ALTER TABLE ops.journal_entries
    ADD COLUMN IF NOT EXISTS legacy_hash TEXT;

    CREATE INDEX IF NOT EXISTS idx_journal_entries_legacy_hash
    ON ops.journal_entries(legacy_hash)
    WHERE legacy_hash IS NOT NULL;
  `);
}

async function main() {
  console.log("=== Airtable FFSC Center Base Sync ===");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("");

  try {
    // Ensure schema is ready
    await ensureLegacyHashColumn();

    // Fetch Trapping Requests
    console.log("Fetching Trapping Requests...");
    const trappingFields = [
      "Case Number",
      "Case Status",
      "Address",
      "Nearest City",
      "Total Cats to be trapped",
      "Case opened date",
      "Case Info",
      "Internal Notes ",
      "First Name",
      "Last Name",
      "Client Name",
      "Client Number",
      "Email",
      "Latitude",
      "Longitude",
    ];
    const trappingRecords = await fetchAllRecords(TRAPPING_REQUESTS_TABLE, trappingFields);
    console.log(`Found ${trappingRecords.length} Trapping Requests`);

    // Fetch Appointment Requests
    console.log("Fetching Appointment Requests...");
    const appointmentFields = [
      "Name",
      "Status",
      "Describe the Situation ",
      "Estimated number of unowned/feral/stray cats",
      "New Submitted",
      "First Name",
      "Last Name",
      "Email",
      "Best phone number to reach you",
      "Clean Address (Cats)",
      "Clean Address",
    ];
    const appointmentRecords = await fetchAllRecords(APPOINTMENT_REQUESTS_TABLE, appointmentFields);
    console.log(`Found ${appointmentRecords.length} Appointment Requests`);

    // Sync Trapping Requests
    console.log("\nSyncing Trapping Requests...");
    let trappingSynced = 0;
    let trappingJournalEntries = 0;
    let trappingErrors = 0;

    for (const record of trappingRecords) {
      try {
        const result = await syncTrappingRequest(record);
        trappingSynced++;
        trappingJournalEntries += result.journalEntriesCount;
      } catch (err) {
        console.error(`  Error syncing ${record.id}: ${err.message}`);
        trappingErrors++;
      }
    }
    console.log(`  Synced: ${trappingSynced}, Journal entries: ${trappingJournalEntries}, Errors: ${trappingErrors}`);

    // Sync Appointment Requests as legacy intake submissions
    console.log("\nSyncing Appointment Requests to intake submissions...");
    let appointmentSynced = 0;
    let appointmentErrors = 0;
    let appointmentNew = 0;

    for (const record of appointmentRecords) {
      try {
        const result = await syncAppointmentToIntake(record);
        appointmentSynced++;
        if (result.isNew) appointmentNew++;
      } catch (err) {
        console.error(`  Error syncing ${record.id}: ${err.message}`);
        appointmentErrors++;
      }
    }
    console.log(`  Synced: ${appointmentSynced} (${appointmentNew} new), Errors: ${appointmentErrors}`);

    console.log("\n=== Summary ===");
    console.log(`Trapping Requests: ${trappingSynced} synced, ${trappingJournalEntries} journal entries`);
    console.log(`Appointment Requests: ${appointmentSynced} synced to intake submissions (${appointmentNew} new)`);

    return {
      trapping: { synced: trappingSynced, journalEntries: trappingJournalEntries, errors: trappingErrors },
      appointment: { total: appointmentRecords.length, synced: appointmentSynced, new: appointmentNew, errors: appointmentErrors },
    };
  } catch (err) {
    console.error("Sync failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
main();
