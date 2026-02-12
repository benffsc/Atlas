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

interface AppointmentVisit {
  microchip: string;
  date: string;
  serviceItems: string[];
  rawRows: Record<string, unknown>[];
  mergedData: Record<string, unknown>;
}

interface MergedRecord {
  microchip: string;
  catInfo?: Record<string, unknown>;
  ownerInfo?: Record<string, unknown>;
  appointments: AppointmentVisit[]; // Multiple visits per cat
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
// SOT Resolver Functions
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

async function createPerson(params: {
  firstName: string;
  lastName?: string;
  email: string | null;
  phone: string | null;
  sourceSystem: string;
}): Promise<string | null> {
  const displayName = [params.firstName, params.lastName].filter(Boolean).join(" ").trim();

  const result = await queryOne<{ person_id: string }>(`
    INSERT INTO sot.people (
      first_name, last_name, display_name, primary_email, primary_phone,
      source_system, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING person_id
  `, [params.firstName, params.lastName || null, displayName || null, params.email, params.phone, params.sourceSystem]);

  if (!result) return null;

  if (params.email) {
    await query(`
      INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
      VALUES ($1, 'email', $2, $2, 1.0, $3)
      ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING
    `, [result.person_id, params.email, params.sourceSystem]);
  }

  if (params.phone) {
    await query(`
      INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
      VALUES ($1, 'phone', $2, $3, 1.0, $4)
      ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING
    `, [result.person_id, params.phone, params.phone, params.sourceSystem]);
  }

  return result.person_id;
}

// ============================================================================
// Place Functions
// ============================================================================

async function findPlaceByAddress(address: string): Promise<string | null> {
  // Look for existing place with matching address
  const existing = await queryOne<{ place_id: string }>(`
    SELECT p.place_id
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.address_id
    WHERE p.merged_into_place_id IS NULL
      AND (a.display_address ILIKE $1 OR a.raw_input ILIKE $1)
    LIMIT 1
  `, [address]);

  return existing?.place_id || null;
}

async function createPlace(params: {
  address: string;
  sourceSystem: string;
}): Promise<string | null> {
  // First create address
  const addressResult = await queryOne<{ address_id: string }>(`
    INSERT INTO sot.addresses (raw_input, display_address, source_system, created_at, updated_at)
    VALUES ($1, $1, $2, NOW(), NOW())
    ON CONFLICT DO NOTHING
    RETURNING address_id
  `, [params.address, params.sourceSystem]);

  let addressId = addressResult?.address_id;

  if (!addressId) {
    // Find existing address
    const existing = await queryOne<{ address_id: string }>(`
      SELECT address_id FROM sot.addresses WHERE raw_input = $1 LIMIT 1
    `, [params.address]);
    addressId = existing?.address_id;
  }

  if (!addressId) return null;

  // Create place
  const placeResult = await queryOne<{ place_id: string }>(`
    INSERT INTO sot.places (address_id, display_name, source_system, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT DO NOTHING
    RETURNING place_id
  `, [addressId, params.address, params.sourceSystem]);

  return placeResult?.place_id || null;
}

async function linkPersonToPlace(
  personId: string,
  placeId: string,
  relationshipType: string = "resident"
): Promise<void> {
  await query(`
    INSERT INTO sot.person_place (person_id, place_id, relationship_type, confidence, source_system, created_at)
    VALUES ($1, $2, $3, 0.8, 'clinichq', NOW())
    ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING
  `, [personId, placeId, relationshipType]);
}

// ============================================================================
// File Parsing
// ============================================================================

function parseXlsxFile(buffer: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  }) as unknown[][];

  if (rawData.length === 0) return [];

  const rawHeaders = rawData[0] as string[];
  const headers = rawHeaders.map((h, i) => h ? String(h).trim() : `_col_${i + 1}`);

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const rowArray = rawData[i] as unknown[];
    const rowObj: Record<string, unknown> = {};
    let hasData = false;

    for (let j = 0; j < headers.length; j++) {
      let value = j < rowArray.length ? rowArray[j] : "";
      if (typeof value === "string") value = value.trim();
      if (value instanceof Date) value = value.toISOString();
      rowObj[headers[j]] = value;
      if (value !== "" && value !== null && value !== undefined) hasData = true;
    }

    if (hasData) rows.push(rowObj);
  }

  return rows;
}

function getMicrochipFromRow(row: Record<string, unknown>): string | null {
  const chip = getString(row, "Microchip", "Microchip Number", "Chip", "Microchip #");
  if (!chip || chip.length < 9) return null;
  return chip;
}

function getDateFromRow(row: Record<string, unknown>): string | null {
  const dateStr = getString(row, "Date", "Appointment Date", "Service Date");
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
// Merge 3 Files by Microchip (with appointment grouping)
// ============================================================================

function mergeFilesByMicrochip(
  catInfoRows: Record<string, unknown>[],
  ownerInfoRows: Record<string, unknown>[],
  appointmentInfoRows: Record<string, unknown>[]
): { records: MergedRecord[]; totalServiceItems: number; uniqueAppointments: number } {
  const byMicrochip = new Map<string, MergedRecord>();
  let totalServiceItems = 0;
  let uniqueAppointments = 0;

  // Index cat_info by microchip (one per cat)
  for (const row of catInfoRows) {
    const chip = getMicrochipFromRow(row);
    if (chip) {
      if (!byMicrochip.has(chip)) {
        byMicrochip.set(chip, { microchip: chip, appointments: [] });
      }
      byMicrochip.get(chip)!.catInfo = row;
    }
  }

  // Index owner_info by microchip (one per cat)
  for (const row of ownerInfoRows) {
    const chip = getMicrochipFromRow(row);
    if (chip) {
      if (!byMicrochip.has(chip)) {
        byMicrochip.set(chip, { microchip: chip, appointments: [] });
      }
      byMicrochip.get(chip)!.ownerInfo = row;
    }
  }

  // Group appointment_info by microchip + date (multiple rows = service items for same visit)
  const appointmentsByChipDate = new Map<string, AppointmentVisit>();

  for (const row of appointmentInfoRows) {
    const chip = getMicrochipFromRow(row);
    const date = getDateFromRow(row);

    if (chip && date) {
      totalServiceItems++;
      const key = `${chip}|${date}`;

      if (!appointmentsByChipDate.has(key)) {
        appointmentsByChipDate.set(key, {
          microchip: chip,
          date,
          serviceItems: [],
          rawRows: [],
          mergedData: {},
        });
        uniqueAppointments++;
      }

      const visit = appointmentsByChipDate.get(key)!;

      // Extract service item name
      const serviceItem = getString(row, "Service Item", "Procedure", "Service", "Item", "Description");
      if (serviceItem) {
        visit.serviceItems.push(serviceItem);
      }

      visit.rawRows.push(row);

      // Merge data (first row wins for most fields, aggregate services)
      visit.mergedData = { ...row, ...visit.mergedData };
    }
  }

  // Attach appointments to their cats
  for (const [, visit] of appointmentsByChipDate) {
    if (!byMicrochip.has(visit.microchip)) {
      byMicrochip.set(visit.microchip, { microchip: visit.microchip, appointments: [] });
    }
    byMicrochip.get(visit.microchip)!.appointments.push(visit);
  }

  return {
    records: Array.from(byMicrochip.values()),
    totalServiceItems,
    uniqueAppointments,
  };
}

// ============================================================================
// Process Merged Record
// ============================================================================

async function processMergedRecord(
  record: MergedRecord,
  stats: ProcessingStats,
  dryRun: boolean
): Promise<void> {
  // Merge cat + owner info (one canonical record per cat)
  const catOwnerMerged: Record<string, unknown> = {
    Microchip: record.microchip,
    ...record.catInfo,
    ...record.ownerInfo, // Owner info takes precedence
  };

  // Extract owner fields
  const ownerFirstName = getString(catOwnerMerged, "Owner First Name", "First Name");
  const ownerLastName = getString(catOwnerMerged, "Owner Last Name", "Last Name");
  const ownerEmail = normalizeEmail(getString(catOwnerMerged, "Owner Email", "Email"));
  const ownerPhone = normalizePhone(getString(catOwnerMerged, "Owner Phone", "Phone", "Owner Cell Phone", "Cell Phone"));
  const ownerAddress = getString(catOwnerMerged, "Owner Address", "Address", "Street");

  // Cat fields
  const catName = getString(catOwnerMerged, "Cat Name", "Animal Name", "Name");
  const catSex = getString(catOwnerMerged, "Sex", "Gender");
  const catColor = getString(catOwnerMerged, "Color", "Colour", "Coat Color");

  // Classify owner once per cat (applies to all appointments)
  const classification = await classifyOwner(ownerFirstName, ownerLastName, ownerEmail, ownerPhone);

  if (dryRun) {
    // DRY RUN: Count without writing

    // Person/pseudo-profile count (once per unique owner)
    if (classification.shouldBePerson) {
      if (ownerEmail || ownerPhone) {
        const existing = await findPersonByIdentifier(ownerEmail, ownerPhone);
        if (existing) {
          stats.personsMatched++;
        } else {
          stats.personsCreated++;
        }
      }

      // Place count
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

  // LAYER 1: Source - Store raw JSON
  if (record.catInfo) {
    await insertClinicHQRaw("cat", record.microchip, record.catInfo);
  }
  if (record.ownerInfo) {
    await insertClinicHQRaw("owner", record.microchip, record.ownerInfo);
  }

  // LAYER 3: SOT - Identity Resolution for Owner (do this first to get personId)
  let personId: string | null = null;
  let placeId: string | null = null;

  if (classification.shouldBePerson) {
    const existing = await findPersonByIdentifier(ownerEmail, ownerPhone);

    if (existing) {
      personId = existing.personId;
      stats.personsMatched++;
    } else if (ownerFirstName) {
      personId = await createPerson({
        firstName: ownerFirstName,
        lastName: ownerLastName,
        email: ownerEmail,
        phone: ownerPhone,
        sourceSystem: "clinichq",
      });
      if (personId) stats.personsCreated++;
    }

    // Create/find place for this person
    if (ownerAddress && personId) {
      const existingPlace = await findPlaceByAddress(ownerAddress);
      if (existingPlace) {
        placeId = existingPlace;
        stats.placesMatched++;
      } else {
        placeId = await createPlace({
          address: ownerAddress,
          sourceSystem: "clinichq",
        });
        if (placeId) stats.placesCreated++;
      }

      // Link person to place
      if (placeId) {
        await linkPersonToPlace(personId, placeId, "resident");
      }
    }
  } else {
    // Pseudo-profile
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

  // LAYER 2: OPS - Create appointments (one per unique visit)
  for (const visit of record.appointments) {
    const appointmentId = `${visit.date}_${record.microchip}`;

    // Store each service item row in source layer
    for (const rawRow of visit.rawRows) {
      await insertClinicHQRaw("appointment_service", `${appointmentId}_${visit.serviceItems.length}`, rawRow);
    }

    // Merge visit data with owner data
    const mergedForOps = {
      ...visit.mergedData,
      ...catOwnerMerged,
      serviceItems: visit.serviceItems,
    };

    const opsAppointmentId = await upsertAppointment({
      clinichqAppointmentId: appointmentId,
      appointmentDate: visit.date,
      ownerFirstName,
      ownerLastName,
      ownerEmail,
      ownerPhone,
      ownerAddress,
      ownerRawPayload: mergedForOps,
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

  // If no appointments but we have cat info, create a placeholder
  if (record.appointments.length === 0) {
    const appointmentId = `nodate_${record.microchip}`;
    const opsAppointmentId = await upsertAppointment({
      clinichqAppointmentId: appointmentId,
      appointmentDate: new Date().toISOString().split("T")[0],
      ownerFirstName,
      ownerLastName,
      ownerEmail,
      ownerPhone,
      ownerAddress,
      ownerRawPayload: catOwnerMerged,
    });
    stats.opsInserted++;

    if (personId) {
      await updateAppointmentResolution(opsAppointmentId, personId, "auto_linked", "Created/matched person");
    } else if (!classification.shouldBePerson) {
      await updateAppointmentResolution(opsAppointmentId, null, "pseudo_profile", classification.reason);
    }
  }

  // LAYER 3: SOT - Create/Update Cat
  const existingCat = await queryOne<{ cat_id: string }>(`
    SELECT cat_id FROM sot.cats WHERE microchip = $1 AND merged_into_cat_id IS NULL
  `, [record.microchip]);

  if (existingCat) {
    stats.catsMatched++;
  } else {
    await query(`
      INSERT INTO sot.cats (microchip, name, sex, color, source_system, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'clinichq', NOW(), NOW())
      ON CONFLICT (microchip) WHERE merged_into_cat_id IS NULL DO NOTHING
    `, [record.microchip, catName || null, catSex || null, catColor || null]);
    stats.catsCreated++;
  }
}

// ============================================================================
// SSE Helper for Progress Streaming
// ============================================================================

function createSSEStream(controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder();

  return {
    sendProgress(data: {
      phase: string;
      current: number;
      total: number;
      message: string;
      stats?: Partial<ProcessingStats>;
    }) {
      const event = `data: ${JSON.stringify({ type: "progress", ...data })}\n\n`;
      controller.enqueue(encoder.encode(event));
    },
    sendComplete(data: {
      success: boolean;
      message: string;
      stats: ProcessingStats;
      dryRun: boolean;
      elapsedMs: number;
    }) {
      const event = `data: ${JSON.stringify({ type: "complete", ...data })}\n\n`;
      controller.enqueue(encoder.encode(event));
      controller.close();
    },
    sendError(error: string) {
      const event = `data: ${JSON.stringify({ type: "error", error })}\n\n`;
      controller.enqueue(encoder.encode(event));
      controller.close();
    },
  };
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

    // Streaming mode - use Server-Sent Events
    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sse = createSSEStream(controller);

        try {
          // Send initial progress
          sse.sendProgress({
            phase: "parsing",
            current: 0,
            total: mergedRecords.length,
            message: `Parsed ${catInfoRows.length + ownerInfoRows.length + appointmentInfoRows.length} rows, merged into ${mergedRecords.length} cats`,
          });

          // Process merged records with progress updates
          const progressInterval = Math.max(1, Math.floor(mergedRecords.length / 50)); // Update ~50 times

          for (let i = 0; i < mergedRecords.length; i++) {
            const record = mergedRecords[i];
            try {
              await processMergedRecord(record, stats, dryRun);
            } catch (err) {
              console.error(`[V2 Ingest] Record error (${record.microchip}):`, err);
              stats.errors++;
            }

            // Send progress update periodically
            if ((i + 1) % progressInterval === 0 || i === mergedRecords.length - 1) {
              sse.sendProgress({
                phase: "processing",
                current: i + 1,
                total: mergedRecords.length,
                message: `Processing cat ${i + 1}/${mergedRecords.length}`,
                stats: {
                  personsCreated: stats.personsCreated,
                  personsMatched: stats.personsMatched,
                  pseudoProfiles: stats.pseudoProfiles,
                  catsCreated: stats.catsCreated,
                  placesCreated: stats.placesCreated,
                  errors: stats.errors,
                },
              });
            }
          }

          const elapsedMs = Date.now() - startTime;

          // Send completion
          sse.sendComplete({
            success: stats.errors === 0,
            message: `Processed ${mergedRecords.length} cats with ${uniqueAppointments} unique visits (${totalServiceItems} service items)`,
            stats,
            dryRun,
            elapsedMs,
          });
        } catch (error) {
          console.error("[V2 Ingest] Stream error:", error);
          sse.sendError(error instanceof Error ? error.message : "Processing failed");
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
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
