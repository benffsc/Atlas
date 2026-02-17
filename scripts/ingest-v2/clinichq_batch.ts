#!/usr/bin/env npx tsx
/**
 * ClinicHQ V2 Batch Ingest Script
 *
 * For processing large ClinicHQ exports without serverless timeouts.
 * Runs locally, processes in chunks, tracks progress, can be resumed.
 *
 * Usage:
 *   source apps/web/.env.local && npx tsx scripts/ingest-v2/clinichq_batch.ts \
 *     --cat-info path/to/cat_info.xlsx \
 *     --owner-info path/to/owner_info.xlsx \
 *     --appointment-info path/to/appointment_info.xlsx \
 *     [--start-at 0] \
 *     [--batch-size 100] \
 *     [--dry-run]
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "util";
import { Pool, QueryResultRow } from "pg";
import * as crypto from "crypto";

// ============================================================================
// Configuration
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable.");
  console.error("");
  console.error("Run with:");
  console.error("  source apps/web/.env.local && npx tsx scripts/ingest-v2/clinichq_batch.ts ...");
  console.error("");
  console.error("Or export DATABASE_URL directly:");
  console.error("  export DATABASE_URL='postgresql://...'");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Database pool error:", err);
});

// ============================================================================
// Database Helper Functions
// ============================================================================

async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

// ============================================================================
// Types
// ============================================================================

interface ClinicVisit {
  microchip: string;
  date: string;
  catInfo?: Record<string, unknown>;
  ownerInfo?: Record<string, unknown>;
  serviceItems: string[];
  appointmentRows: Record<string, unknown>[];
}

interface MergedRecord {
  microchip: string;
  catInfo?: Record<string, unknown>;
  ownerInfo?: Record<string, unknown>;
  appointments: {
    microchip: string;
    date: string;
    serviceItems: string[];
    rawRows: Record<string, unknown>[];
    mergedData: Record<string, unknown>;
  }[];
}

interface Stats {
  processed: number;
  personsCreated: number;
  personsMatched: number;
  pseudoProfiles: number;
  catsCreated: number;
  catsMatched: number;
  placesCreated: number;
  placesMatched: number;
  appointmentsCreated: number;
  errors: number;
  lastError?: string;
}

interface ClassificationResult {
  type: string;
  shouldBePerson: boolean;
  reason?: string;
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

function getMicrochipFromRow(row: Record<string, unknown>): string | null {
  let chip = getString(row, "Microchip", "Microchip Number", "Chip", "Microchip #");
  if (!chip) {
    const rawChip = row["Microchip Number"] ?? row["Microchip"];
    if (typeof rawChip === "number") {
      chip = rawChip.toFixed(0);
    }
  }
  if (!chip || chip.length < 9) return null;
  if (chip.includes("E") || chip.includes("e")) {
    try {
      const num = parseFloat(chip);
      if (!isNaN(num)) chip = num.toFixed(0);
    } catch { /* keep original */ }
  }
  return chip;
}

function getDateFromRow(row: Record<string, unknown>): string | null {
  const dateStr = getString(
    row,
    "Date", "Appointment Date", "Service Date", "Visit Date", "Clinic Date",
    "Appt Date", "AppointmentDate", "VisitDate", "ServiceDate", "ClinicDate"
  );
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date.toISOString().split("T")[0];
  } catch { /* fall through */ }
  return dateStr;
}

// ============================================================================
// File Parsing
// ============================================================================

/**
 * Detects if an XLSX file uses master-detail format.
 * Master-detail format: first row has full data, subsequent rows only have
 * service-specific columns filled (Date is empty but Service/Subsidy has data).
 */
function detectMasterDetailFormat(rawData: unknown[][], headers: string[]): boolean {
  const dateColIndex = headers.findIndex(h => h === "Date");
  const serviceColIndex = headers.findIndex(h => h === "Service / Subsidy");

  // Must have both Date and Service columns
  if (dateColIndex < 0 || serviceColIndex < 0) return false;

  // Sample first 50 data rows to detect pattern
  let detailRowCount = 0;
  const sampleSize = Math.min(50, rawData.length - 1);

  for (let i = 1; i <= sampleSize; i++) {
    const row = rawData[i] as unknown[];
    const dateValue = row[dateColIndex];
    const serviceValue = row[serviceColIndex];

    // Detail row = empty date but has service value
    const hasEmptyDate = dateValue === "" || dateValue === undefined || dateValue === null;
    const hasService = serviceValue && String(serviceValue).trim() !== "";

    if (hasEmptyDate && hasService) {
      detailRowCount++;
    }
  }

  // If more than 20% of sampled rows are detail rows, it's master-detail format
  const isMasterDetail = detailRowCount > sampleSize * 0.2;

  if (isMasterDetail) {
    console.log(`  [Auto-detected] Master-detail format (${detailRowCount}/${sampleSize} detail rows in sample)`);
  }

  return isMasterDetail;
}

function parseXlsxFile(filePath: string, fillDown: boolean | "auto" = "auto"): Record<string, unknown>[] {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: true,
  }) as unknown[][];

  if (rawData.length === 0) return [];

  const rawHeaders = rawData[0] as string[];
  const headers = rawHeaders.map((h, i) => h ? String(h).trim() : `_col_${i + 1}`);

  const microchipColIndex = headers.findIndex(h =>
    h === "Microchip" || h === "Microchip Number" || h === "Chip" || h === "Microchip #"
  );

  // For fill-down, find the "Date" column - if Date is empty, it's a detail row
  const dateColIndex = headers.findIndex(h => h === "Date");

  // Auto-detect master-detail format if fillDown is "auto"
  const useFillDown = fillDown === "auto"
    ? detectMasterDetailFormat(rawData, headers)
    : fillDown;

  // Columns that should NOT be filled down (they're specific to each service line)
  const serviceOnlyColumns = new Set([
    "Service / Subsidy", "Serv Value", "Sub Value", "Invoiced", "Pot Deduct"
  ]);

  const rows: Record<string, unknown>[] = [];
  let lastMasterRow: Record<string, unknown> = {};

  for (let i = 1; i < rawData.length; i++) {
    const rowArray = rawData[i] as unknown[];
    const rowObj: Record<string, unknown> = {};
    let hasData = false;

    // Check if this is a detail row (Date column is empty)
    const isDetailRow = useFillDown && dateColIndex >= 0 &&
      (rowArray[dateColIndex] === "" || rowArray[dateColIndex] === undefined || rowArray[dateColIndex] === null);

    for (let j = 0; j < headers.length; j++) {
      let value = j < rowArray.length ? rowArray[j] : "";

      // Handle microchip as number
      if (j === microchipColIndex && typeof value === "number") {
        value = value.toFixed(0);
      } else if (typeof value === "string") {
        value = value.trim();
      } else if (value instanceof Date) {
        value = value.toISOString();
      }

      // Fill-down logic: if this is a detail row and the cell is empty,
      // use the value from the last master row (except for service-specific columns)
      if (useFillDown && isDetailRow && (value === "" || value === undefined || value === null)) {
        const header = headers[j];
        if (!serviceOnlyColumns.has(header) && lastMasterRow[header] !== undefined) {
          value = lastMasterRow[header];
        }
      }

      rowObj[headers[j]] = value;
      if (value !== "" && value !== null && value !== undefined) hasData = true;
    }

    if (hasData) {
      rows.push(rowObj);

      // If this is a master row (has Date), save it for fill-down
      if (useFillDown && !isDetailRow) {
        lastMasterRow = { ...rowObj };
      }
    }
  }

  return rows;
}

function mergeFilesByMicrochip(
  catInfoRows: Record<string, unknown>[],
  ownerInfoRows: Record<string, unknown>[],
  appointmentInfoRows: Record<string, unknown>[]
): MergedRecord[] {
  const visitsByKey = new Map<string, ClinicVisit>();

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

  // Process appointment rows - handle continuation rows (service line items without microchip)
  // ClinicHQ exports have:
  //   Row 1: Full data (Date, Number, Microchip, medical fields, primary service)
  //   Row 2-N: Empty except for "Service / Subsidy" column (additional services)
  let currentKey: string | null = null;
  for (const row of appointmentInfoRows) {
    const chip = getMicrochipFromRow(row);
    const date = getDateFromRow(row);

    if (chip && date) {
      // This is a "header row" with full appointment data
      currentKey = `${chip}|${date}`;
      if (!visitsByKey.has(currentKey)) {
        visitsByKey.set(currentKey, { microchip: chip, date, serviceItems: [], appointmentRows: [] });
      }
      const visit = visitsByKey.get(currentKey)!;
      visit.appointmentRows.push(row);
      // Extract service from header row - check multiple possible field names
      const serviceItem = getString(row, "Service / Subsidy", "Service Item", "Procedure", "Service", "Item", "Description");
      if (serviceItem) visit.serviceItems.push(serviceItem);
    } else if (currentKey) {
      // This is a "continuation row" - service line item belonging to the previous appointment
      const visit = visitsByKey.get(currentKey)!;
      visit.appointmentRows.push(row);
      // Extract service from continuation row
      const serviceItem = getString(row, "Service / Subsidy", "Service Item", "Procedure", "Service", "Item", "Description");
      if (serviceItem) visit.serviceItems.push(serviceItem);
    }
    // If no chip/date AND no currentKey, skip the row (orphan)
  }

  const byMicrochip = new Map<string, MergedRecord>();
  for (const visit of visitsByKey.values()) {
    if (!byMicrochip.has(visit.microchip)) {
      byMicrochip.set(visit.microchip, { microchip: visit.microchip, appointments: [] });
    }
    const record = byMicrochip.get(visit.microchip)!;
    if (visit.catInfo) record.catInfo = visit.catInfo;
    if (visit.ownerInfo) record.ownerInfo = visit.ownerInfo;
    record.appointments.push({
      microchip: visit.microchip,
      date: visit.date,
      serviceItems: visit.serviceItems,
      rawRows: visit.appointmentRows,
      mergedData: { ...visit.catInfo, ...visit.ownerInfo },
    });
  }

  return Array.from(byMicrochip.values());
}

// ============================================================================
// Database Functions (using direct SQL queries)
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

async function resolvePersonIdentity(params: {
  firstName?: string | null;
  lastName?: string | null;
  email: string | null;
  phone: string | null;
  address?: string | null;
  sourceSystem: string;
}): Promise<{ personId: string | null; isNew: boolean; decision: string }> {
  const result = await queryOne<{ person_id: string | null }>(`
    SELECT sot.find_or_create_person(
      p_email := $1,
      p_phone := $2,
      p_first_name := $3,
      p_last_name := $4,
      p_address := $5,
      p_source_system := $6
    ) as person_id
  `, [
    params.email,
    params.phone,
    params.firstName || null,
    params.lastName || null,
    params.address || null,
    params.sourceSystem,
  ]);

  const personId = result?.person_id || null;

  let isNew = false;
  if (personId) {
    const check = await queryOne<{ is_new: boolean }>(`
      SELECT created_at > NOW() - INTERVAL '2 seconds' as is_new
      FROM sot.people WHERE person_id = $1
    `, [personId]);
    isNew = check?.is_new || false;
  }

  return {
    personId,
    isNew,
    decision: personId ? (isNew ? "new_entity" : "auto_match") : "rejected",
  };
}

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

async function linkPersonToPlace(
  personId: string,
  placeId: string,
  relationshipType: string = "resident"
): Promise<void> {
  await query(`
    SELECT sot.link_person_to_place(
      p_person_id := $1,
      p_place_id := $2,
      p_relationship_type := $3,
      p_evidence_type := 'appointment',
      p_source_system := 'clinichq',
      p_confidence := 'medium'
    )
  `, [personId, placeId, relationshipType]);
}

async function upsertAppointment(params: {
  clinichqAppointmentId: string;
  appointmentDate: string;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  ownerAddress?: string | null;
  ownerRawPayload?: Record<string, unknown>;
  sourceRawId?: string;
  serviceType?: string | null;
  isSpay?: boolean;
  isNeuter?: boolean;
}): Promise<string> {
  const result = await queryOne<{ appointment_id: string }>(`
    INSERT INTO ops.appointments (
      clinichq_appointment_id, appointment_date,
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      owner_raw_payload, source_raw_id, resolution_status,
      service_type, is_spay, is_neuter
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, $12)
    ON CONFLICT (clinichq_appointment_id) DO UPDATE SET
      owner_first_name = COALESCE(EXCLUDED.owner_first_name, ops.appointments.owner_first_name),
      owner_last_name = COALESCE(EXCLUDED.owner_last_name, ops.appointments.owner_last_name),
      owner_email = COALESCE(EXCLUDED.owner_email, ops.appointments.owner_email),
      owner_phone = COALESCE(EXCLUDED.owner_phone, ops.appointments.owner_phone),
      owner_address = COALESCE(EXCLUDED.owner_address, ops.appointments.owner_address),
      owner_raw_payload = COALESCE(EXCLUDED.owner_raw_payload, ops.appointments.owner_raw_payload),
      source_raw_id = COALESCE(EXCLUDED.source_raw_id, ops.appointments.source_raw_id),
      service_type = COALESCE(EXCLUDED.service_type, ops.appointments.service_type),
      is_spay = EXCLUDED.is_spay OR ops.appointments.is_spay,
      is_neuter = EXCLUDED.is_neuter OR ops.appointments.is_neuter,
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
    params.serviceType || null,
    params.isSpay || false,
    params.isNeuter || false,
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
}): Promise<string | null> {
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

  return result?.account_id || null;
}

// ============================================================================
// Process Merged Record
// ============================================================================

async function processRecord(record: MergedRecord, stats: Stats, dryRun: boolean): Promise<void> {
  const catInfo = record.catInfo || {};
  const catName = getString(catInfo, "Cat Name", "Animal Name", "Name");
  const catSex = getString(catInfo, "Sex", "Gender");
  const catBreed = getString(catInfo, "Breed");
  const primaryColor = getString(catInfo, "Primary Color", "Color", "Colour", "Coat Color");
  const secondaryColor = getString(catInfo, "Secondary Color");
  const spayNeuterStatus = getString(catInfo, "Spay Neuter Status");

  let alteredStatus: string | null = null;
  if (spayNeuterStatus === "Yes" || spayNeuterStatus === "Spayed" || spayNeuterStatus === "Neutered") {
    if (catSex?.toLowerCase() === "female") alteredStatus = "spayed";
    else if (catSex?.toLowerCase() === "male") alteredStatus = "neutered";
    else alteredStatus = "altered";
  }

  if (dryRun) {
    stats.processed++;
    return;
  }

  // LAYER 1: Source - Store raw JSON
  if (record.catInfo) {
    await insertClinicHQRaw("cat", record.microchip, record.catInfo);
  }
  if (record.ownerInfo) {
    await insertClinicHQRaw("owner", record.microchip, record.ownerInfo);
  }

  // LAYER 3: SOT - Create cat
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

    if (isNew?.is_new) stats.catsCreated++;
    else stats.catsMatched++;
  }

  // Track processed owners
  const processedOwners = new Map<string, { personId: string | null; placeId: string | null; classification: ClassificationResult }>();

  // LAYER 2: OPS - Create appointments
  for (const visit of record.appointments) {
    const appointmentId = `${visit.date}_${record.microchip}`;
    const visitData = visit.mergedData || {};

    const ownerFirstName = getString(visitData, "Owner First Name", "First Name");
    const ownerLastName = getString(visitData, "Owner Last Name", "Last Name");
    const ownerEmail = normalizeEmail(getString(visitData, "Owner Email", "Email"));
    const ownerPhone = normalizePhone(getString(visitData, "Owner Phone", "Phone", "Owner Cell Phone", "Cell Phone"));
    const ownerAddress = getString(visitData, "Owner Address", "Address", "Street");

    const ownerKey = `${ownerEmail || ""}|${ownerPhone || ""}|${ownerFirstName || ""}|${ownerLastName || ""}`;

    let personId: string | null = null;
    let placeId: string | null = null;
    let classification: ClassificationResult;

    if (processedOwners.has(ownerKey)) {
      const cached = processedOwners.get(ownerKey)!;
      personId = cached.personId;
      placeId = cached.placeId;
      classification = cached.classification;
    } else {
      classification = await classifyOwner(ownerFirstName, ownerLastName, ownerEmail, ownerPhone);

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

        if (ownerAddress && personId) {
          placeId = await resolvePlace(ownerAddress, "clinichq");
          if (placeId) {
            const isNewPlace = await queryOne<{ is_new: boolean }>(`
              SELECT created_at > NOW() - INTERVAL '1 second' as is_new
              FROM sot.places WHERE place_id = $1
            `, [placeId]);

            if (isNewPlace?.is_new) stats.placesCreated++;
            else stats.placesMatched++;

            await linkPersonToPlace(personId, placeId, "resident");
          }
        }
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

      processedOwners.set(ownerKey, { personId, placeId, classification });
    }

    // Store each service item row in source layer
    for (let i = 0; i < visit.rawRows.length; i++) {
      const rawRow = visit.rawRows[i];
      await insertClinicHQRaw("appointment_service", `${appointmentId}_${i}`, rawRow);
    }

    // Extract service data from service items
    const serviceItems = visit.serviceItems || [];
    const serviceType = serviceItems.join("; ");
    const serviceTypeLower = serviceType.toLowerCase();
    const isSpay = serviceTypeLower.includes("spay") || serviceTypeLower.includes("cat spay");
    const isNeuter = serviceTypeLower.includes("neuter") || serviceTypeLower.includes("cat neuter");

    // Create appointment
    const opsAppointmentId = await upsertAppointment({
      clinichqAppointmentId: appointmentId,
      appointmentDate: visit.date,
      ownerFirstName,
      ownerLastName,
      ownerEmail,
      ownerPhone,
      ownerAddress,
      ownerRawPayload: { ...visitData, serviceItems: visit.serviceItems },
      serviceType,
      isSpay,
      isNeuter,
    });
    stats.appointmentsCreated++;

    // Update resolution
    if (personId) {
      await updateAppointmentResolution(opsAppointmentId, personId, "auto_linked", "Created/matched person");
    } else if (!classification.shouldBePerson) {
      await updateAppointmentResolution(opsAppointmentId, null, "pseudo_profile", classification.reason);
    }
  }

  stats.processed++;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { values } = parseArgs({
    options: {
      "cat-info": { type: "string" },
      "owner-info": { type: "string" },
      "appointment-info": { type: "string" },
      "start-at": { type: "string", default: "0" },
      "batch-size": { type: "string", default: "100" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const catInfoPath = values["cat-info"];
  const ownerInfoPath = values["owner-info"];
  const appointmentInfoPath = values["appointment-info"];
  const startAt = parseInt(values["start-at"] || "0", 10);
  const batchSize = parseInt(values["batch-size"] || "100", 10);
  const dryRun = values["dry-run"] || false;

  if (!catInfoPath || !ownerInfoPath || !appointmentInfoPath) {
    console.error("Usage: npx tsx scripts/ingest-v2/clinichq_batch.ts \\");
    console.error("  --cat-info path/to/cat_info.xlsx \\");
    console.error("  --owner-info path/to/owner_info.xlsx \\");
    console.error("  --appointment-info path/to/appointment_info.xlsx \\");
    console.error("  [--start-at 0] [--batch-size 100] [--dry-run]");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("ClinicHQ V2 Batch Ingest");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Start at: ${startAt}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Database: ${DATABASE_URL?.substring(0, 50)}...`);
  console.log("");

  // Test database connection
  console.log("Testing database connection...");
  try {
    const test = await queryOne<{ version: string }>("SELECT version()");
    console.log(`Connected: ${test?.version?.substring(0, 50)}...`);
  } catch (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }

  // Parse files
  // All files use auto-detection for master-detail format (fill-down).
  // ClinicHQ appointment exports use master-detail format where the first row
  // has all data and subsequent rows only have Service / Subsidy filled.
  // The parser auto-detects this pattern and applies fill-down automatically.
  console.log("\nParsing files...");
  const catInfoRows = parseXlsxFile(catInfoPath);
  const ownerInfoRows = parseXlsxFile(ownerInfoPath);
  const appointmentInfoRows = parseXlsxFile(appointmentInfoPath); // Auto-detects fill-down

  console.log(`  cat_info: ${catInfoRows.length} rows`);
  console.log(`  owner_info: ${ownerInfoRows.length} rows`);
  console.log(`  appointment_info: ${appointmentInfoRows.length} rows`);

  // Merge
  console.log("\nMerging by microchip + date...");
  const records = mergeFilesByMicrochip(catInfoRows, ownerInfoRows, appointmentInfoRows);
  console.log(`  ${records.length} unique cats`);

  const totalVisits = records.reduce((sum, r) => sum + r.appointments.length, 0);
  console.log(`  ${totalVisits} unique visits`);

  // Initialize stats
  const stats: Stats = {
    processed: 0,
    personsCreated: 0,
    personsMatched: 0,
    pseudoProfiles: 0,
    catsCreated: 0,
    catsMatched: 0,
    placesCreated: 0,
    placesMatched: 0,
    appointmentsCreated: 0,
    errors: 0,
  };

  // Process
  console.log(`\nProcessing records ${startAt} to ${Math.min(startAt + records.length, records.length)}...`);
  const startTime = Date.now();

  for (let i = startAt; i < records.length; i++) {
    const record = records[i];

    try {
      await processRecord(record, stats, dryRun);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`\nError processing ${record.microchip}: ${errorMsg}`);
      stats.errors++;
      stats.lastError = `${record.microchip}: ${errorMsg}`;
    }

    // Progress update
    if ((i + 1) % batchSize === 0 || i === records.length - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (stats.processed / parseFloat(elapsed)).toFixed(1);
      const pct = ((i + 1) / records.length * 100).toFixed(1);

      console.log("");
      console.log(`[${new Date().toISOString()}] Progress: ${i + 1}/${records.length} (${pct}%)`);
      console.log(`  Elapsed: ${elapsed}s | Rate: ${rate} cats/s`);
      console.log(`  Cats: ${stats.catsCreated} new, ${stats.catsMatched} matched`);
      console.log(`  People: ${stats.personsCreated} new, ${stats.personsMatched} matched`);
      console.log(`  Places: ${stats.placesCreated} new, ${stats.placesMatched} matched`);
      console.log(`  Pseudo-profiles: ${stats.pseudoProfiles}`);
      console.log(`  Appointments: ${stats.appointmentsCreated}`);
      console.log(`  Errors: ${stats.errors}`);
      if (stats.lastError) console.log(`  Last error: ${stats.lastError}`);

      // Save progress file for resumption
      const progressFile = path.join(path.dirname(catInfoPath), ".ingest_progress.json");
      fs.writeFileSync(progressFile, JSON.stringify({
        lastProcessed: i,
        timestamp: new Date().toISOString(),
        stats,
      }, null, 2));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("COMPLETE");
  console.log("=".repeat(60));
  console.log(JSON.stringify(stats, null, 2));

  // Cleanup
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
