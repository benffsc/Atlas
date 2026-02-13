import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import * as XLSX from "xlsx";
import crypto from "crypto";

// Serverless function timeout
export const maxDuration = 300; // 5 minutes

// ============================================================================
// Types
// ============================================================================

type FileType = "cat_info" | "owner_info" | "appointment_info";

interface ProcessingStats {
  total: number;
  sourceInserted: number;
  sourceSkipped: number;
  opsInserted: number;
  personsCreated: number;
  personsMatched: number;
  pseudoProfiles: number;
  catsCreated: number;
  catsMatched: number;
  placesCreated: number;
  placesMatched: number;
  errors: number;
  uniqueAppointments: number; // Unique visits (microchip+date)
  totalServiceItems: number;  // Total service item rows
  files: {
    cat_info: number;
    owner_info: number;
    appointment_info: number;
  };
}

interface ClassificationResult {
  type: string;
  shouldBePerson: boolean;
  reason?: string;
}

interface ClinicVisit {
  microchip: string;
  date: string;
  catInfo?: Record<string, unknown>;
  ownerInfo?: Record<string, unknown>;
  serviceItems: string[];
  appointmentRows: Record<string, unknown>[];
}

// Legacy type for compatibility - now each MergedRecord is ONE visit
interface MergedRecord {
  microchip: string;
  catInfo?: Record<string, unknown>;
  ownerInfo?: Record<string, unknown>;
  appointments: { microchip: string; date: string; serviceItems: string[]; rawRows: Record<string, unknown>[]; mergedData: Record<string, unknown> }[];
}

// ============================================================================
// Helper Functions
// ============================================================================

function computeRowHash(payload: Record<string, unknown>): string {
  const sortedJson = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash("md5").update(sortedJson).digest("hex");
}

function getString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeEmail(email: string | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim() || null;
}

// ============================================================================
// Source Layer Functions
// ============================================================================

async function insertClinicHQRaw(
  recordType: string,
  sourceRecordId: string,
  payload: Record<string, unknown>
): Promise<string | null> {
  const hash = computeRowHash(payload);

  const result = await queryOne<{ id: string }>(`
    INSERT INTO source.clinichq_raw (
      record_type, source_record_id, payload, row_hash
    ) VALUES ($1, $2, $3, $4)
    ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
    RETURNING id
  `, [recordType, sourceRecordId, JSON.stringify(payload), hash]);

  return result?.id || null;
}

// ============================================================================
// OPS Layer Functions
// ============================================================================

async function upsertAppointment(params: {
  clinichqAppointmentId: string;
  appointmentDate: string;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  ownerAddress?: string | null;
  ownerRawPayload?: Record<string, unknown>;
  serviceItems?: string[];
  sourceRawId?: string;
}): Promise<string> {
  const result = await queryOne<{ appointment_id: string }>(`
    INSERT INTO ops.appointments (
      clinichq_appointment_id, appointment_date,
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      owner_raw_payload, source_raw_id, resolution_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
    ON CONFLICT (clinichq_appointment_id) DO UPDATE SET
      owner_first_name = COALESCE(EXCLUDED.owner_first_name, ops.appointments.owner_first_name),
      owner_last_name = COALESCE(EXCLUDED.owner_last_name, ops.appointments.owner_last_name),
      owner_email = COALESCE(EXCLUDED.owner_email, ops.appointments.owner_email),
      owner_phone = COALESCE(EXCLUDED.owner_phone, ops.appointments.owner_phone),
      owner_address = COALESCE(EXCLUDED.owner_address, ops.appointments.owner_address),
      owner_raw_payload = COALESCE(EXCLUDED.owner_raw_payload, ops.appointments.owner_raw_payload),
      source_raw_id = COALESCE(EXCLUDED.source_raw_id, ops.appointments.source_raw_id),
      updated_at = NOW()
    RETURNING appointment_id
  `, [
    params.clinichqAppointmentId,
    params.appointmentDate,
    params.ownerFirstName || null,
    params.ownerLastName || null,
    params.ownerEmail || null,
    params.ownerPhone || null,
    params.ownerAddress || null,
    params.ownerRawPayload ? JSON.stringify(params.ownerRawPayload) : null,
    params.sourceRawId || null,
  ]);

  if (!result) throw new Error(`Failed to upsert appointment: ${params.clinichqAppointmentId}`);
  return result.appointment_id;
}

async function updateAppointmentResolution(
  appointmentId: string,
  personId: string | null,
  status: string,
  notes?: string
): Promise<void> {
  await query(`
    UPDATE ops.appointments
    SET resolved_person_id = $2, resolution_status = $3, resolution_notes = $4,
        resolved_at = NOW(), updated_at = NOW()
    WHERE appointment_id = $1
  `, [appointmentId, personId, status, notes || null]);
}

async function upsertClinicAccount(params: {
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  ownerAddress?: string | null;
  accountType: string;
  classificationReason?: string;
}): Promise<string> {
  const result = await queryOne<{ account_id: string }>(`
    INSERT INTO ops.clinic_accounts (
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      account_type, classification_reason, first_appointment_date, last_appointment_date
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, CURRENT_DATE)
    ON CONFLICT ON CONSTRAINT clinic_accounts_name_email_key DO UPDATE SET
      appointment_count = ops.clinic_accounts.appointment_count + 1,
      last_seen_at = NOW(),
      last_appointment_date = CURRENT_DATE,
      updated_at = NOW()
    RETURNING account_id
  `, [
    params.ownerFirstName || null,
    params.ownerLastName || null,
    params.ownerEmail || null,
    params.ownerPhone || null,
    params.ownerAddress || null,
    params.accountType,
    params.classificationReason || null,
  ]);

  if (!result) {
    const existing = await queryOne<{ account_id: string }>(`
      SELECT account_id FROM ops.clinic_accounts
      WHERE owner_first_name = $1 AND owner_last_name = $2
        AND (owner_email = $3 OR (owner_email IS NULL AND $3 IS NULL))
      LIMIT 1
    `, [params.ownerFirstName, params.ownerLastName, params.ownerEmail]);

    if (existing) return existing.account_id;
    throw new Error(`Failed to upsert clinic account`);
  }

  return result.account_id;
}

// ============================================================================
// SOT Resolver Functions (using centralized sot.* functions from MIG_2007)
// ============================================================================

async function classifyOwner(
  firstName?: string | null,
  lastName?: string | null,
  email?: string | null,
  phone?: string | null
): Promise<ClassificationResult> {
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (!displayName) {
    return { type: "garbage", shouldBePerson: false, reason: "Empty name" };
  }

  const classResult = await queryOne<{ classification: string }>(`
    SELECT sot.classify_owner_name($1) as classification
  `, [displayName]);

  const classification = classResult?.classification || "unknown";

  const shouldResult = await queryOne<{ should_create: boolean }>(`
    SELECT sot.should_be_person($1, $2, $3, $4) as should_create
  `, [firstName || null, lastName || null, email || null, phone || null]);

  const shouldBePerson = shouldResult?.should_create || false;

  let reason: string | undefined;
  if (!shouldBePerson) {
    if (!email && !phone) {
      reason = "No contact info (email or phone required)";
    } else if (classification === "organization") {
      reason = "Name classified as organization";
    } else if (classification === "site_name") {
      reason = "Name classified as site_name";
    } else if (classification === "address") {
      reason = "Name classified as address";
    } else if (classification === "garbage") {
      reason = "Name classified as garbage/invalid";
    }
  }

  return { type: classification, shouldBePerson, reason };
}

/**
 * Use Data Engine to resolve identity - returns existing person or creates new
 * This replaces the old findPersonByIdentifier + createPerson pattern
 * Uses sot.find_or_create_person() which implements:
 * - Phase 0: should_be_person() gate
 * - Phase 1: Fellegi-Sunter weighted scoring (email 40%, phone 25%, name 25%, address 10%)
 * - Phase 2: Decision (≥0.95 auto_match, 0.50-0.95 review_pending, <0.50 new_entity)
 */
async function resolvePersonIdentity(params: {
  firstName?: string | null;
  lastName?: string | null;
  email: string | null;
  phone: string | null;
  address?: string | null;
  sourceSystem: string;
}): Promise<{ personId: string | null; isNew: boolean; decision: string }> {
  // Call the centralized sot.find_or_create_person() function
  const result = await queryOne<{
    person_id: string | null;
    decision_type: string;
    is_new: boolean;
  }>(`
    SELECT
      person_id,
      decision_type,
      CASE WHEN decision_type = 'new_entity' THEN TRUE ELSE FALSE END as is_new
    FROM sot.find_or_create_person(
      p_email := $1,
      p_phone := $2,
      p_first_name := $3,
      p_last_name := $4,
      p_address := $5,
      p_source_system := $6
    )
  `, [
    params.email,
    params.phone,
    params.firstName || null,
    params.lastName || null,
    params.address || null,
    params.sourceSystem,
  ]);

  return {
    personId: result?.person_id || null,
    isNew: result?.is_new || false,
    decision: result?.decision_type || "rejected",
  };
}

/**
 * Legacy function for compatibility - calls the new resolvePersonIdentity
 * @deprecated Use resolvePersonIdentity instead
 */
async function findPersonByIdentifier(
  email: string | null,
  phone: string | null
): Promise<{ personId: string; matchedOn: string } | null> {
  if (email) {
    const byEmail = await queryOne<{ person_id: string }>(`
      SELECT pi.person_id
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'email' AND pi.id_value_norm = $1
        AND pi.confidence >= 0.5 AND p.merged_into_person_id IS NULL
      ORDER BY pi.confidence DESC LIMIT 1
    `, [email]);

    if (byEmail) return { personId: byEmail.person_id, matchedOn: "email" };
  }

  if (phone) {
    const byPhone = await queryOne<{ person_id: string }>(`
      SELECT pi.person_id
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'phone' AND pi.id_value_norm = $1
        AND pi.confidence >= 0.5 AND p.merged_into_person_id IS NULL
      ORDER BY pi.confidence DESC LIMIT 1
    `, [phone]);

    if (byPhone) return { personId: byPhone.person_id, matchedOn: "phone" };
  }

  return null;
}

/**
 * @deprecated Use resolvePersonIdentity instead - this does direct INSERT
 * Kept for reference but should not be called
 */
async function createPerson(params: {
  firstName: string;
  lastName?: string;
  email: string | null;
  phone: string | null;
  sourceSystem: string;
}): Promise<string | null> {
  // Use centralized function instead of direct INSERT
  const result = await resolvePersonIdentity({
    firstName: params.firstName,
    lastName: params.lastName,
    email: params.email,
    phone: params.phone,
    sourceSystem: params.sourceSystem,
  });

  return result.personId;
}

// ============================================================================
// Place Functions (using centralized sot.* functions from MIG_2008)
// ============================================================================

/**
 * Find or create place using centralized sot.find_or_create_place_deduped()
 * This implements:
 * - Stage 1: Exact normalized address match
 * - Stage 2: Coordinate match within 10m (if provided)
 * - Creates address + place if no match found
 */
async function resolvePlace(
  address: string,
  sourceSystem: string,
  lat?: number | null,
  lng?: number | null
): Promise<string | null> {
  const result = await queryOne<{ place_id: string }>(`
    SELECT sot.find_or_create_place_deduped(
      p_formatted_address := $1,
      p_display_name := NULL,
      p_lat := $2,
      p_lng := $3,
      p_source_system := $4
    ) as place_id
  `, [address, lat || null, lng || null, sourceSystem]);

  return result?.place_id || null;
}

/**
 * Legacy function for compatibility
 * @deprecated Use resolvePlace instead
 */
async function findPlaceByAddress(address: string): Promise<string | null> {
  // Look for existing place with matching normalized address
  const existing = await queryOne<{ place_id: string }>(`
    SELECT p.place_id
    FROM sot.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.normalized_address = sot.normalize_address($1)
    LIMIT 1
  `, [address]);

  return existing?.place_id || null;
}

/**
 * @deprecated Use resolvePlace instead
 */
async function createPlace(params: {
  address: string;
  sourceSystem: string;
}): Promise<string | null> {
  return resolvePlace(params.address, params.sourceSystem);
}

/**
 * Link person to place using centralized sot.link_person_to_place()
 * Validates entities exist and aren't merged before creating relationship
 */
async function linkPersonToPlace(
  personId: string,
  placeId: string,
  role: string = "resident"
): Promise<void> {
  await query(`
    SELECT sot.link_person_to_place(
      p_person_id := $1,
      p_place_id := $2,
      p_role := $3,
      p_evidence_type := 'appointment',
      p_source_system := 'clinichq',
      p_confidence := 'medium'
    )
  `, [personId, placeId, role]);
}

// ============================================================================
// File Parsing
// ============================================================================

function parseXlsxFile(buffer: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Use raw: true to get actual values, then convert carefully
  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: true, // Get raw values to preserve number precision
  }) as unknown[][];

  if (rawData.length === 0) return [];

  const rawHeaders = rawData[0] as string[];
  const headers = rawHeaders.map((h, i) => h ? String(h).trim() : `_col_${i + 1}`);

  // Find microchip column index for special handling
  const microchipColIndex = headers.findIndex(h =>
    h === "Microchip" || h === "Microchip Number" || h === "Chip" || h === "Microchip #"
  );

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const rowArray = rawData[i] as unknown[];
    const rowObj: Record<string, unknown> = {};
    let hasData = false;

    for (let j = 0; j < headers.length; j++) {
      let value = j < rowArray.length ? rowArray[j] : "";

      // Special handling for microchip column - convert number to string preserving precision
      if (j === microchipColIndex && typeof value === "number") {
        // Use toFixed(0) to avoid scientific notation
        value = value.toFixed(0);
      } else if (typeof value === "string") {
        value = value.trim();
      } else if (value instanceof Date) {
        value = value.toISOString();
      }

      rowObj[headers[j]] = value;
      if (value !== "" && value !== null && value !== undefined) hasData = true;
    }

    if (hasData) rows.push(rowObj);
  }

  return rows;
}

function getMicrochipFromRow(row: Record<string, unknown>): string | null {
  let chip = getString(row, "Microchip", "Microchip Number", "Chip", "Microchip #");
  if (!chip) {
    // Also check for raw number (XLSX might not convert to string)
    const rawChip = row["Microchip Number"] ?? row["Microchip"];
    if (typeof rawChip === "number") {
      // Handle scientific notation or raw number
      chip = rawChip.toFixed(0);
    }
  }
  if (!chip || chip.length < 9) return null;

  // Handle scientific notation in string form (e.g., "9.81E+14")
  if (chip.includes("E") || chip.includes("e")) {
    try {
      const num = parseFloat(chip);
      if (!isNaN(num)) {
        chip = num.toFixed(0);
      }
    } catch {
      // Keep original
    }
  }

  return chip;
}

function getDateFromRow(row: Record<string, unknown>): string | null {
  // Try many possible date column names
  const dateStr = getString(
    row,
    "Date",
    "Appointment Date",
    "Service Date",
    "Visit Date",
    "Clinic Date",
    "Appt Date",
    "AppointmentDate",
    "VisitDate",
    "ServiceDate",
    "ClinicDate",
    "date",
    "appointment_date",
    "visit_date"
  );
  if (!dateStr) return null;

  // Try to normalize the date
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0]; // YYYY-MM-DD
    }
  } catch {
    // Fall through
  }
  return dateStr; // Return as-is if can't parse
}

// ============================================================================
// Merge 3 Files by Microchip + Date (Visit-based)
// ============================================================================
// IMPORTANT: Each row in cat_info and owner_info is ONE VISIT, not one cat.
// A cat with 5 clinic visits = 5 rows in cat_info, 5 rows in owner_info.
// appointment_info has multiple rows per visit (service items).
// We merge by microchip+date to get unique visits.

function mergeFilesByVisit(
  catInfoRows: Record<string, unknown>[],
  ownerInfoRows: Record<string, unknown>[],
  appointmentInfoRows: Record<string, unknown>[]
): { visits: ClinicVisit[]; totalServiceItems: number; uniqueVisits: number } {
  const visitsByKey = new Map<string, ClinicVisit>();
  let totalServiceItems = 0;

  // Index cat_info by microchip+date (one row per visit)
  for (const row of catInfoRows) {
    const chip = getMicrochipFromRow(row);
    const date = getDateFromRow(row);
    if (chip && date) {
      const key = `${chip}|${date}`;
      if (!visitsByKey.has(key)) {
        visitsByKey.set(key, { microchip: chip, date, serviceItems: [], appointmentRows: [] });
      }
      visitsByKey.get(key)!.catInfo = row;
    }
  }

  // Index owner_info by microchip+date (one row per visit)
  for (const row of ownerInfoRows) {
    const chip = getMicrochipFromRow(row);
    const date = getDateFromRow(row);
    if (chip && date) {
      const key = `${chip}|${date}`;
      if (!visitsByKey.has(key)) {
        visitsByKey.set(key, { microchip: chip, date, serviceItems: [], appointmentRows: [] });
      }
      visitsByKey.get(key)!.ownerInfo = row;
    }
  }

  // Add appointment_info rows (multiple per visit = service items)
  for (const row of appointmentInfoRows) {
    const chip = getMicrochipFromRow(row);
    const date = getDateFromRow(row);
    if (chip && date) {
      totalServiceItems++;
      const key = `${chip}|${date}`;
      if (!visitsByKey.has(key)) {
        visitsByKey.set(key, { microchip: chip, date, serviceItems: [], appointmentRows: [] });
      }
      const visit = visitsByKey.get(key)!;
      visit.appointmentRows.push(row);

      // Extract service item name
      const serviceItem = getString(row, "Service Item", "Procedure", "Service", "Item", "Description");
      if (serviceItem) {
        visit.serviceItems.push(serviceItem);
      }
    }
  }

  const visits = Array.from(visitsByKey.values());

  return {
    visits,
    totalServiceItems,
    uniqueVisits: visits.length,
  };
}

// Legacy wrapper for compatibility with existing code
function mergeFilesByMicrochip(
  catInfoRows: Record<string, unknown>[],
  ownerInfoRows: Record<string, unknown>[],
  appointmentInfoRows: Record<string, unknown>[]
): { records: MergedRecord[]; totalServiceItems: number; uniqueAppointments: number } {
  const { visits, totalServiceItems, uniqueVisits } = mergeFilesByVisit(catInfoRows, ownerInfoRows, appointmentInfoRows);

  // Group visits by microchip to create MergedRecords (for backward compat)
  const byMicrochip = new Map<string, MergedRecord>();

  for (const visit of visits) {
    if (!byMicrochip.has(visit.microchip)) {
      byMicrochip.set(visit.microchip, { microchip: visit.microchip, appointments: [] });
    }
    const record = byMicrochip.get(visit.microchip)!;

    // Use the most recent visit's cat/owner info as the "main" info
    if (visit.catInfo) record.catInfo = visit.catInfo;
    if (visit.ownerInfo) record.ownerInfo = visit.ownerInfo;

    // Add this visit as an appointment
    record.appointments.push({
      microchip: visit.microchip,
      date: visit.date,
      serviceItems: visit.serviceItems,
      rawRows: visit.appointmentRows,
      mergedData: { ...visit.catInfo, ...visit.ownerInfo },
    });
  }

  return {
    records: Array.from(byMicrochip.values()),
    totalServiceItems,
    uniqueAppointments: uniqueVisits,
  };
}

// ============================================================================
// Process Merged Record
// ============================================================================
// IMPORTANT: Each ClinicHQ row is ONE VISIT, not one cat.
// A cat with 5 visits = 5 rows in cat_info, 5 rows in owner_info.
// Each visit has its OWN owner info (which may differ across visits).
// We create ONE cat record but process EACH visit's owner separately.

async function processMergedRecord(
  record: MergedRecord,
  stats: ProcessingStats,
  dryRun: boolean
): Promise<void> {
  // Cat fields from most recent cat_info (for creating the cat record)
  const catInfo = record.catInfo || {};
  const catName = getString(catInfo, "Cat Name", "Animal Name", "Name");
  const catSex = getString(catInfo, "Sex", "Gender");
  const catBreed = getString(catInfo, "Breed");

  // Colors - keep separate (primary goes to color column, secondary stored separately)
  const primaryColor = getString(catInfo, "Primary Color", "Color", "Colour", "Coat Color");
  const secondaryColor = getString(catInfo, "Secondary Color");

  // Altered status from cat_info (not appointment_info which has procedure flags)
  const spayNeuterStatus = getString(catInfo, "Spay Neuter Status");
  let alteredStatus: string | null = null;
  if (spayNeuterStatus === "Yes" || spayNeuterStatus === "Spayed" || spayNeuterStatus === "Neutered") {
    // Derive from sex if available
    if (catSex?.toLowerCase() === "female") {
      alteredStatus = "spayed";
    } else if (catSex?.toLowerCase() === "male") {
      alteredStatus = "neutered";
    } else {
      alteredStatus = "altered";
    }
  }

  if (dryRun) {
    // DRY RUN: Count without writing
    // Track unique owners seen to avoid double-counting
    const seenOwners = new Set<string>();

    for (const visit of record.appointments) {
      // Extract owner info FROM THIS VISIT
      const visitData = visit.mergedData || {};
      const ownerFirstName = getString(visitData, "Owner First Name", "First Name");
      const ownerLastName = getString(visitData, "Owner Last Name", "Last Name");
      const ownerEmail = normalizeEmail(getString(visitData, "Owner Email", "Email"));
      const ownerPhone = normalizePhone(getString(visitData, "Owner Phone", "Phone", "Owner Cell Phone", "Cell Phone"));
      const ownerAddress = getString(visitData, "Owner Address", "Address", "Street");

      const ownerKey = `${ownerEmail || ""}|${ownerPhone || ""}|${ownerFirstName || ""}|${ownerLastName || ""}`;

      if (!seenOwners.has(ownerKey)) {
        seenOwners.add(ownerKey);

        const classification = await classifyOwner(ownerFirstName, ownerLastName, ownerEmail, ownerPhone);

        if (classification.shouldBePerson) {
          if (ownerEmail || ownerPhone) {
            const existing = await findPersonByIdentifier(ownerEmail, ownerPhone);
            if (existing) {
              stats.personsMatched++;
            } else {
              stats.personsCreated++;
            }
          }

          if (ownerAddress) {
            const existingPlace = await findPlaceByAddress(ownerAddress);
            if (existingPlace) {
              stats.placesMatched++;
            } else {
              stats.placesCreated++;
            }
          }
        } else {
          stats.pseudoProfiles++;
        }
      }
    }

    // Cat count
    const existingCat = await queryOne<{ cat_id: string }>(`
      SELECT cat_id FROM sot.cats WHERE microchip = $1 AND merged_into_cat_id IS NULL
    `, [record.microchip]);
    if (existingCat) {
      stats.catsMatched++;
    } else {
      stats.catsCreated++;
    }

    // Appointment counts (per visit, not per service item)
    stats.opsInserted += record.appointments.length || 1;
    stats.sourceInserted += record.appointments.length || 1;

    return;
  }

  // =========================================================================
  // LIVE MODE: Write to database
  // =========================================================================

  // LAYER 1: Source - Store raw JSON for cat_info and owner_info ONCE per microchip
  // (This stores the most recent version; individual visit data is in mergedData)
  if (record.catInfo) {
    await insertClinicHQRaw("cat", record.microchip, record.catInfo);
  }
  if (record.ownerInfo) {
    await insertClinicHQRaw("owner", record.microchip, record.ownerInfo);
  }

  // LAYER 3: SOT - Create cat FIRST using most recent cat info
  // The cat entity is the same across all visits; we use the most recent data
  const catResult = await queryOne<{ cat_id: string }>(`
    SELECT sot.find_or_create_cat_by_microchip(
      p_microchip := $1,
      p_name := $2,
      p_sex := $3,
      p_breed := $4,
      p_altered_status := $5,
      p_color := $6,
      p_source_system := 'clinichq'
    ) as cat_id
  `, [record.microchip, catName || null, catSex || null, catBreed || null, alteredStatus, primaryColor || null]);

  // Update secondary color if available (separate column in sot.cats)
  if (catResult?.cat_id && secondaryColor) {
    await query(`
      UPDATE sot.cats
      SET secondary_color = COALESCE(secondary_color, $2)
      WHERE cat_id = $1
    `, [catResult.cat_id, secondaryColor]);
  }

  if (catResult?.cat_id) {
    const isNew = await queryOne<{ is_new: boolean }>(`
      SELECT created_at > NOW() - INTERVAL '1 second' as is_new
      FROM sot.cats WHERE cat_id = $1
    `, [catResult.cat_id]);

    if (isNew?.is_new) {
      stats.catsCreated++;
    } else {
      stats.catsMatched++;
    }
  }

  // Track owners we've already processed (to avoid re-creating same person)
  const processedOwners = new Map<string, { personId: string | null; placeId: string | null; classification: ClassificationResult }>();

  // LAYER 2: OPS - Create appointments (one per unique visit)
  // Each visit has its OWN owner info that may differ from other visits
  for (const visit of record.appointments) {
    const appointmentId = `${visit.date}_${record.microchip}`;

    // Extract owner info FROM THIS VISIT's mergedData (not from the cat-level data)
    const visitData = visit.mergedData || {};
    const ownerFirstName = getString(visitData, "Owner First Name", "First Name");
    const ownerLastName = getString(visitData, "Owner Last Name", "Last Name");
    const ownerEmail = normalizeEmail(getString(visitData, "Owner Email", "Email"));
    const ownerPhone = normalizePhone(getString(visitData, "Owner Phone", "Phone", "Owner Cell Phone", "Cell Phone"));
    const ownerAddress = getString(visitData, "Owner Address", "Address", "Street");

    // Create owner key for deduplication within this record
    const ownerKey = `${ownerEmail || ""}|${ownerPhone || ""}|${ownerFirstName || ""}|${ownerLastName || ""}`;

    let personId: string | null = null;
    let placeId: string | null = null;
    let classification: ClassificationResult;

    // Check if we've already processed this owner in a previous visit
    if (processedOwners.has(ownerKey)) {
      const cached = processedOwners.get(ownerKey)!;
      personId = cached.personId;
      placeId = cached.placeId;
      classification = cached.classification;
    } else {
      // First time seeing this owner - process through Data Engine
      classification = await classifyOwner(ownerFirstName, ownerLastName, ownerEmail, ownerPhone);

      if (classification.shouldBePerson) {
        // Use centralized identity resolution
        const resolution = await resolvePersonIdentity({
          firstName: ownerFirstName,
          lastName: ownerLastName,
          email: ownerEmail,
          phone: ownerPhone,
          address: ownerAddress,
          sourceSystem: "clinichq",
        });

        personId = resolution.personId;

        if (resolution.isNew) {
          stats.personsCreated++;
        } else if (personId) {
          stats.personsMatched++;
        }

        // Create/find place using centralized function
        if (ownerAddress && personId) {
          placeId = await resolvePlace(ownerAddress, "clinichq");

          if (placeId) {
            const isNewPlace = await queryOne<{ is_new: boolean }>(`
              SELECT created_at > NOW() - INTERVAL '1 second' as is_new
              FROM sot.places WHERE place_id = $1
            `, [placeId]);

            if (isNewPlace?.is_new) {
              stats.placesCreated++;
            } else {
              stats.placesMatched++;
            }

            // Link person to place
            await linkPersonToPlace(personId, placeId, "resident");
          }
        }
      } else {
        // Pseudo-profile - route to clinic_accounts
        let accountType = "unknown";
        if (classification.type === "organization") accountType = "organization";
        else if (classification.type === "site_name") accountType = "site_name";
        else if (classification.type === "address") accountType = "address";

        await upsertClinicAccount({
          ownerFirstName,
          ownerLastName,
          ownerEmail,
          ownerPhone,
          ownerAddress,
          accountType,
          classificationReason: classification.reason,
        });
        stats.pseudoProfiles++;
      }

      // Cache for future visits with same owner
      processedOwners.set(ownerKey, { personId, placeId, classification });
    }

    // Store each service item row in source layer
    for (let i = 0; i < visit.rawRows.length; i++) {
      const rawRow = visit.rawRows[i];
      await insertClinicHQRaw("appointment_service", `${appointmentId}_${i}`, rawRow);
    }

    // Create appointment with THIS VISIT's owner info
    const opsAppointmentId = await upsertAppointment({
      clinichqAppointmentId: appointmentId,
      appointmentDate: visit.date,
      ownerFirstName,
      ownerLastName,
      ownerEmail,
      ownerPhone,
      ownerAddress,
      ownerRawPayload: {
        ...visitData,
        serviceItems: visit.serviceItems,
      },
      serviceItems: visit.serviceItems,
    });
    stats.opsInserted++;
    stats.sourceInserted++;

    // Update appointment resolution
    if (personId) {
      await updateAppointmentResolution(opsAppointmentId, personId, "auto_linked", "Created/matched person");
    } else if (!classification.shouldBePerson) {
      await updateAppointmentResolution(opsAppointmentId, null, "pseudo_profile", classification.reason);
    }
  }

  // If no appointments but we have cat/owner info, create a placeholder appointment
  if (record.appointments.length === 0 && (record.catInfo || record.ownerInfo)) {
    const fallbackData = { ...record.catInfo, ...record.ownerInfo };
    const ownerFirstName = getString(fallbackData, "Owner First Name", "First Name");
    const ownerLastName = getString(fallbackData, "Owner Last Name", "Last Name");
    const ownerEmail = normalizeEmail(getString(fallbackData, "Owner Email", "Email"));
    const ownerPhone = normalizePhone(getString(fallbackData, "Owner Phone", "Phone", "Owner Cell Phone", "Cell Phone"));
    const ownerAddress = getString(fallbackData, "Owner Address", "Address", "Street");

    const classification = await classifyOwner(ownerFirstName, ownerLastName, ownerEmail, ownerPhone);
    let personId: string | null = null;

    if (classification.shouldBePerson) {
      const resolution = await resolvePersonIdentity({
        firstName: ownerFirstName,
        lastName: ownerLastName,
        email: ownerEmail,
        phone: ownerPhone,
        address: ownerAddress,
        sourceSystem: "clinichq",
      });
      personId = resolution.personId;
      if (resolution.isNew) stats.personsCreated++;
      else if (personId) stats.personsMatched++;
    } else {
      let accountType = "unknown";
      if (classification.type === "organization") accountType = "organization";
      else if (classification.type === "site_name") accountType = "site_name";
      else if (classification.type === "address") accountType = "address";

      await upsertClinicAccount({
        ownerFirstName,
        ownerLastName,
        ownerEmail,
        ownerPhone,
        ownerAddress,
        accountType,
        classificationReason: classification.reason,
      });
      stats.pseudoProfiles++;
    }

    const appointmentId = `nodate_${record.microchip}`;
    const opsAppointmentId = await upsertAppointment({
      clinichqAppointmentId: appointmentId,
      appointmentDate: new Date().toISOString().split("T")[0],
      ownerFirstName,
      ownerLastName,
      ownerEmail,
      ownerPhone,
      ownerAddress,
      ownerRawPayload: fallbackData,
    });
    stats.opsInserted++;

    if (personId) {
      await updateAppointmentResolution(opsAppointmentId, personId, "auto_linked", "Created/matched person");
    } else if (!classification.shouldBePerson) {
      await updateAppointmentResolution(opsAppointmentId, null, "pseudo_profile", classification.reason);
    }
  }
}

// ============================================================================
// API Route Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const formData = await request.formData();
    const dryRun = formData.get("dryRun") === "true";
    const stream = formData.get("stream") === "true";

    // Get all 3 files
    const catInfoFile = formData.get("cat_info") as File | null;
    const ownerInfoFile = formData.get("owner_info") as File | null;
    const appointmentInfoFile = formData.get("appointment_info") as File | null;

    if (!catInfoFile || !ownerInfoFile || !appointmentInfoFile) {
      const missing = [];
      if (!catInfoFile) missing.push("cat_info");
      if (!ownerInfoFile) missing.push("owner_info");
      if (!appointmentInfoFile) missing.push("appointment_info");
      return NextResponse.json(
        { error: `Missing files: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // Parse all 3 files
    const catInfoRows = parseXlsxFile(Buffer.from(await catInfoFile.arrayBuffer()));
    const ownerInfoRows = parseXlsxFile(Buffer.from(await ownerInfoFile.arrayBuffer()));
    const appointmentInfoRows = parseXlsxFile(Buffer.from(await appointmentInfoFile.arrayBuffer()));

    // Merge by microchip (with appointment grouping by date)
    const { records: mergedRecords, totalServiceItems, uniqueAppointments } = mergeFilesByMicrochip(
      catInfoRows,
      ownerInfoRows,
      appointmentInfoRows
    );

    // Initialize stats
    const stats: ProcessingStats = {
      total: mergedRecords.length,
      sourceInserted: 0,
      sourceSkipped: 0,
      opsInserted: 0,
      personsCreated: 0,
      personsMatched: 0,
      pseudoProfiles: 0,
      catsCreated: 0,
      catsMatched: 0,
      placesCreated: 0,
      placesMatched: 0,
      errors: 0,
      uniqueAppointments,
      totalServiceItems,
      files: {
        cat_info: catInfoRows.length,
        owner_info: ownerInfoRows.length,
        appointment_info: appointmentInfoRows.length,
      },
    };

    // Non-streaming mode (original behavior)
    if (!stream) {
      for (let i = 0; i < mergedRecords.length; i++) {
        const record = mergedRecords[i];
        try {
          await processMergedRecord(record, stats, dryRun);
        } catch (err) {
          console.error(`[V2 Ingest] Record error (${record.microchip}):`, err);
          stats.errors++;
        }
      }

      const elapsedMs = Date.now() - startTime;

      return NextResponse.json({
        success: stats.errors === 0,
        message: `Processed ${mergedRecords.length} cats with ${uniqueAppointments} unique visits (${totalServiceItems} service items)`,
        stats,
        dryRun,
        elapsedMs,
      });
    }

    // Streaming mode - use Server-Sent Events with TransformStream
    const encoder = new TextEncoder();

    // Create a transform stream that we can write to
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Helper to send SSE events
    const sendEvent = async (data: Record<string, unknown>) => {
      const event = `data: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(event));
    };

    // Start processing in the background (don't await)
    (async () => {
      // Track last error for debugging
      let lastError: string | null = null;

      try {
        // Send initial progress with clear visit/cat distinction
        await sendEvent({
          type: "progress",
          phase: "parsing",
          current: 0,
          total: mergedRecords.length,
          message: `Parsed: cat_info=${catInfoRows.length} rows, owner_info=${ownerInfoRows.length} rows, appt_info=${appointmentInfoRows.length} rows → ${mergedRecords.length} unique cats with ${uniqueAppointments} visits`,
        });

        // Process merged records with progress updates
        const progressInterval = Math.max(1, Math.floor(mergedRecords.length / 50)); // Update ~50 times

        for (let i = 0; i < mergedRecords.length; i++) {
          const record = mergedRecords[i];
          try {
            await processMergedRecord(record, stats, dryRun);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[V2 Ingest] Record error (${record.microchip}):`, err);
            lastError = `${record.microchip}: ${errorMsg}`;
            stats.errors++;
          }

          // Send progress update periodically
          if ((i + 1) % progressInterval === 0 || i === mergedRecords.length - 1) {
            await sendEvent({
              type: "progress",
              phase: "processing",
              current: i + 1,
              total: mergedRecords.length,
              message: `Processing cat ${i + 1}/${mergedRecords.length} (${record.appointments.length} visits)`,
              stats: {
                personsCreated: stats.personsCreated,
                personsMatched: stats.personsMatched,
                pseudoProfiles: stats.pseudoProfiles,
                catsCreated: stats.catsCreated,
                catsMatched: stats.catsMatched,
                placesCreated: stats.placesCreated,
                opsInserted: stats.opsInserted,
                errors: stats.errors,
                lastError: lastError,
              },
            });
          }
        }

        const elapsedMs = Date.now() - startTime;

        // Send completion
        await sendEvent({
          type: "complete",
          success: stats.errors === 0,
          message: `Processed ${mergedRecords.length} unique cats with ${uniqueAppointments} clinic visits (${totalServiceItems} service items)`,
          stats,
          dryRun,
          elapsedMs,
          lastError,
        });
      } catch (error) {
        console.error("[V2 Ingest] Stream error:", error);
        await sendEvent({
          type: "error",
          error: error instanceof Error ? error.message : "Processing failed",
        });
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      },
    });

  } catch (error) {
    console.error("[V2 Ingest] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
