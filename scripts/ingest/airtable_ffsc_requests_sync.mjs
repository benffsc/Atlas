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
  const s = airtableStatus.toLowerCase();
  if (s.includes("closed") || s.includes("complete")) return "completed";
  if (s.includes("hold") || s.includes("wait")) return "on_hold";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("active") || s.includes("progress")) return "in_progress";
  if (s.includes("schedule")) return "scheduled";
  if (s.includes("triage") || s.includes("review")) return "triaged";
  return "new";
}

/**
 * Find or create a person from contact info
 */
async function findOrCreatePerson(firstName, lastName, phone, email) {
  if (!firstName && !lastName) return null;

  // First try to find by phone or email
  let personId = null;

  if (email) {
    const emailMatch = await pool.query(
      `SELECT person_id FROM trapper.person_identifiers
       WHERE id_type = 'email' AND id_value_norm = LOWER($1)`,
      [email]
    );
    if (emailMatch.rows.length > 0) {
      personId = emailMatch.rows[0].person_id;
    }
  }

  if (!personId && phone) {
    const normPhone = phone.replace(/\D/g, '').slice(-10);
    if (normPhone.length === 10) {
      const phoneMatch = await pool.query(
        `SELECT person_id FROM trapper.person_identifiers
         WHERE id_type = 'phone' AND id_value_norm = $1`,
        [normPhone]
      );
      if (phoneMatch.rows.length > 0) {
        personId = phoneMatch.rows[0].person_id;
      }
    }
  }

  // If found, return
  if (personId) return personId;

  // Create new person with display_name (sot_people doesn't have first_name/last_name)
  const displayName = `${firstName} ${lastName}`.trim();
  const insertResult = await pool.query(
    `INSERT INTO trapper.sot_people (
      display_name, created_at, updated_at
    ) VALUES ($1, NOW(), NOW())
    RETURNING person_id`,
    [displayName || 'Unknown']
  );
  personId = insertResult.rows[0].person_id;

  // Add identifiers
  if (email) {
    await pool.query(
      `INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm)
       VALUES ($1, 'email', $2, LOWER($2))
       ON CONFLICT (id_type, id_value_norm) DO NOTHING`,
      [personId, email]
    );
  }

  if (phone) {
    const normPhone = phone.replace(/\D/g, '').slice(-10);
    if (normPhone.length === 10) {
      await pool.query(
        `INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm)
         VALUES ($1, 'phone', $2, $3)
         ON CONFLICT (id_type, id_value_norm) DO NOTHING`,
        [personId, phone, normPhone]
      );
    }
  }

  return personId;
}

/**
 * Find or create a place from address
 */
async function findOrCreatePlace(address, lat, lng) {
  if (!address) return null;

  // Generate normalized address key
  const normalizedAddress = address.toUpperCase()
    .replace(/,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  // Try to find existing place by formatted_address or display_name
  const existing = await pool.query(
    `SELECT place_id FROM trapper.places
     WHERE UPPER(formatted_address) = $1 OR formatted_address = $2
     LIMIT 1`,
    [normalizedAddress, address]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].place_id;
  }

  // Try matching by street address only
  const streetOnly = address.split(',')[0].trim().toUpperCase();
  const streetMatch = await pool.query(
    `SELECT place_id FROM trapper.places
     WHERE UPPER(display_name) = $1
     LIMIT 1`,
    [streetOnly]
  );

  if (streetMatch.rows.length > 0) {
    return streetMatch.rows[0].place_id;
  }

  // Skip creating new places - the places table has complex constraints
  // Places will need to be created via the proper intake flow
  // Just return null and the request will be created without a place_id
  return null;
}

/**
 * Sync a single Trapping Request to Atlas
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

  // Find or create place and person
  const placeId = await findOrCreatePlace(address, lat, lng);
  const personId = await findOrCreatePerson(firstName, lastName, phone, email);

  // Check if request already exists
  const existingResult = await pool.query(
    `SELECT request_id FROM trapper.sot_requests
     WHERE source_system = 'airtable_ffsc' AND source_record_id = $1`,
    [record.id]
  );

  let requestId;
  const status = mapCaseStatus(f["Case Status"]);
  const summary = firstName || lastName
    ? `${firstName} ${lastName}`.trim()
    : (f["Client Name"] || `Case #${f["Case Number"] || record.id.slice(0,8)}`);

  if (existingResult.rows.length > 0) {
    // Update existing request
    requestId = existingResult.rows[0].request_id;

    await pool.query(
      `UPDATE trapper.sot_requests SET
        status = $1,
        estimated_cat_count = $2,
        notes = $3,
        place_id = COALESCE($4, place_id),
        requester_person_id = COALESCE($5, requester_person_id),
        summary = COALESCE($6, summary),
        updated_at = NOW()
       WHERE request_id = $7`,
      [
        status,
        parseInt(f["Total Cats to be trapped"]) || null,
        f["Case Info"] || null,
        placeId,
        personId,
        summary,
        requestId,
      ]
    );
  } else {
    // Create new request
    const insertResult = await pool.query(
      `INSERT INTO trapper.sot_requests (
        source_system, source_record_id, source_created_at,
        status, estimated_cat_count, notes,
        place_id, requester_person_id, summary,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING request_id`,
      [
        "airtable_ffsc",
        record.id,
        f["Case opened date"] ? new Date(f["Case opened date"]) : new Date(),
        status,
        parseInt(f["Total Cats to be trapped"]) || null,
        f["Case Info"] || null,
        placeId,
        personId,
        summary,
      ]
    );
    requestId = insertResult.rows[0].request_id;
  }

  // Sync journal entries from Internal Notes
  for (const entry of journalEntries) {
    // Check if this exact entry already exists (by text hash to avoid duplicates)
    const entryHash = Buffer.from(entry.raw).toString("base64").slice(0, 100);

    const existingEntry = await pool.query(
      `SELECT id FROM trapper.journal_entries
       WHERE primary_request_id = $1 AND legacy_hash = $2`,
      [requestId, entryHash]
    );

    if (existingEntry.rows.length === 0) {
      await pool.query(
        `INSERT INTO trapper.journal_entries (
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
 * Sync a single Appointment Request to Atlas
 */
async function syncAppointmentRequest(record) {
  const f = record.fields;

  // Appointment requests don't have Internal Notes like Trapping Requests
  const journalEntries = [];

  // Get contact info
  const firstName = f["First Name"] || "";
  const lastName = f["Last Name"] || "";
  const phone = f["Best phone number to reach you"] || "";
  const email = f["Email"] || "";

  // Get address - appointment requests use "Clean Address (Cats)" or "Clean Address"
  const address = f["Clean Address (Cats)"] || f["Clean Address"] || "";

  // Find or create place and person
  const placeId = await findOrCreatePlace(address, null, null);
  const personId = await findOrCreatePerson(firstName, lastName, phone, email);

  // Check if request already exists
  const existingResult = await pool.query(
    `SELECT request_id FROM trapper.sot_requests
     WHERE source_system = 'airtable_ffsc_appt' AND source_record_id = $1`,
    [record.id]
  );

  let requestId;
  const status = mapCaseStatus(f["Status"]);
  const summary = firstName || lastName
    ? `${firstName} ${lastName}`.trim()
    : (f["Name"] || `Appointment ${record.id.slice(0,8)}`);

  if (existingResult.rows.length > 0) {
    // Update existing request
    requestId = existingResult.rows[0].request_id;

    await pool.query(
      `UPDATE trapper.sot_requests SET
        status = $1,
        estimated_cat_count = $2,
        notes = $3,
        place_id = COALESCE($4, place_id),
        requester_person_id = COALESCE($5, requester_person_id),
        summary = COALESCE($6, summary),
        updated_at = NOW()
       WHERE request_id = $7`,
      [
        status,
        parseInt(f["Estimated number of unowned/feral/stray cats"]) || null,
        f["Describe the Situation "] || null,
        placeId,
        personId,
        summary,
        requestId,
      ]
    );
  } else {
    // Create new request
    const insertResult = await pool.query(
      `INSERT INTO trapper.sot_requests (
        source_system, source_record_id, source_created_at,
        status, estimated_cat_count, notes,
        place_id, requester_person_id, summary,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING request_id`,
      [
        "airtable_ffsc_appt",
        record.id,
        f["New Submitted"] ? new Date(f["New Submitted"]) : new Date(),
        status,
        parseInt(f["Estimated number of unowned/feral/stray cats"]) || null,
        f["Describe the Situation "] || null,
        placeId,
        personId,
        summary,
      ]
    );
    requestId = insertResult.rows[0].request_id;
  }

  // Sync journal entries from Notes
  for (const entry of journalEntries) {
    const entryHash = Buffer.from(entry.raw).toString("base64").slice(0, 100);

    const existingEntry = await pool.query(
      `SELECT id FROM trapper.journal_entries
       WHERE primary_request_id = $1 AND legacy_hash = $2`,
      [requestId, entryHash]
    );

    if (existingEntry.rows.length === 0) {
      await pool.query(
        `INSERT INTO trapper.journal_entries (
          primary_request_id, body, occurred_at, created_by_staff_id,
          entry_kind, created_by, legacy_hash, tags, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          requestId,
          entry.text,
          entry.date || new Date(),
          entry.staffPersonId, // This is now staff_id
          "note",
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
 * Ensure journal_entries table has legacy_hash column for deduplication
 */
async function ensureLegacyHashColumn() {
  await pool.query(`
    ALTER TABLE trapper.journal_entries
    ADD COLUMN IF NOT EXISTS legacy_hash TEXT;

    CREATE INDEX IF NOT EXISTS idx_journal_entries_legacy_hash
    ON trapper.journal_entries(legacy_hash)
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
      "Client Number",
      "Email",
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

    // NOTE: Appointment Requests are LEGACY INTAKE submissions, not TNR requests
    // They should be converted to modern intake format via "Make into modern request" button
    // Skip syncing them as sot_requests
    console.log("\nSkipping Appointment Requests sync (legacy intake - requires manual conversion)");

    console.log("\n=== Summary ===");
    console.log(`Trapping Requests: ${trappingSynced} synced, ${trappingJournalEntries} journal entries`);
    console.log(`Appointment Requests: ${appointmentRecords.length} found (not synced - legacy intake format)`);

    return {
      trapping: { synced: trappingSynced, journalEntries: trappingJournalEntries, errors: trappingErrors },
      appointment: { total: appointmentRecords.length, synced: 0, note: "Legacy intake - not synced" },
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
