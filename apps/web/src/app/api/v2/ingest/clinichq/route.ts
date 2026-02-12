import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import XLSX from "xlsx";
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

interface MergedRecord {
  microchip: string;
  catInfo?: Record<string, unknown>;
  ownerInfo?: Record<string, unknown>;
  appointmentInfo?: Record<string, unknown>;
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
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  ownerAddress?: string;
  ownerRawPayload?: Record<string, unknown>;
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
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  ownerAddress?: string;
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
    // If conflict but no return, find existing
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
  firstName?: string,
  lastName?: string,
  email?: string,
  phone?: string
): Promise<ClassificationResult> {
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (!displayName) {
    return { type: "garbage", shouldBePerson: false, reason: "Empty name" };
  }

  // Call SQL classification function
  const classResult = await queryOne<{ classification: string }>(`
    SELECT sot.classify_owner_name($1) as classification
  `, [displayName]);

  const classification = classResult?.classification || "unknown";

  // Call SQL should_be_person function
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

  // Create identifiers
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

// ============================================================================
// Merge 3 Files by Microchip
// ============================================================================

function mergeFilesByMicrochip(
  catInfoRows: Record<string, unknown>[],
  ownerInfoRows: Record<string, unknown>[],
  appointmentInfoRows: Record<string, unknown>[]
): MergedRecord[] {
  const byMicrochip = new Map<string, MergedRecord>();

  // Index cat_info by microchip
  for (const row of catInfoRows) {
    const chip = getMicrochipFromRow(row);
    if (chip) {
      if (!byMicrochip.has(chip)) {
        byMicrochip.set(chip, { microchip: chip });
      }
      byMicrochip.get(chip)!.catInfo = row;
    }
  }

  // Index owner_info by microchip
  for (const row of ownerInfoRows) {
    const chip = getMicrochipFromRow(row);
    if (chip) {
      if (!byMicrochip.has(chip)) {
        byMicrochip.set(chip, { microchip: chip });
      }
      byMicrochip.get(chip)!.ownerInfo = row;
    }
  }

  // Index appointment_info by microchip
  for (const row of appointmentInfoRows) {
    const chip = getMicrochipFromRow(row);
    if (chip) {
      if (!byMicrochip.has(chip)) {
        byMicrochip.set(chip, { microchip: chip });
      }
      byMicrochip.get(chip)!.appointmentInfo = row;
    }
  }

  return Array.from(byMicrochip.values());
}

// ============================================================================
// Process Merged Record
// ============================================================================

async function processMergedRecord(
  record: MergedRecord,
  stats: ProcessingStats,
  dryRun: boolean
): Promise<void> {
  // Merge fields from all 3 sources, preferring owner_info for owner data
  const merged: Record<string, unknown> = {
    Microchip: record.microchip,
    ...record.catInfo,
    ...record.appointmentInfo,
    ...record.ownerInfo, // Owner info takes precedence for owner fields
  };

  // Extract fields from all sources
  const ownerFirstName = getString(merged, "Owner First Name", "First Name");
  const ownerLastName = getString(merged, "Owner Last Name", "Last Name");
  const ownerEmail = normalizeEmail(getString(merged, "Owner Email", "Email"));
  const ownerPhone = normalizePhone(getString(merged, "Owner Phone", "Phone", "Owner Cell Phone", "Cell Phone"));
  const ownerAddress = getString(merged, "Owner Address", "Address", "Street");
  const appointmentDate = getString(merged, "Date", "Appointment Date", "Service Date") || new Date().toISOString().split("T")[0];

  // Cat fields from cat_info
  const catName = getString(merged, "Cat Name", "Animal Name", "Name");
  const catSex = getString(merged, "Sex", "Gender");
  const catColor = getString(merged, "Color", "Colour", "Coat Color");

  // Generate appointment ID
  const appointmentId = getString(merged, "ID", "Appointment ID", "Number") ||
    `${appointmentDate}_${record.microchip}`;

  if (dryRun) {
    // Just validate and count
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
    } else {
      stats.pseudoProfiles++;
    }

    if (record.microchip) {
      // Check if cat exists by microchip
      const existingCat = await queryOne<{ cat_id: string }>(`
        SELECT cat_id FROM sot.cats WHERE microchip = $1 AND merged_into_cat_id IS NULL
      `, [record.microchip]);
      if (existingCat) {
        stats.catsMatched++;
      } else {
        stats.catsCreated++;
      }
    }

    stats.sourceInserted++; // Would insert
    stats.opsInserted++;
    return;
  }

  // LAYER 1: Source - Store raw JSON for each file type present
  if (record.catInfo) {
    await insertClinicHQRaw("cat", record.microchip, record.catInfo);
  }
  if (record.ownerInfo) {
    await insertClinicHQRaw("owner", record.microchip, record.ownerInfo);
  }
  if (record.appointmentInfo) {
    const sourceRawId = await insertClinicHQRaw("appointment", appointmentId, record.appointmentInfo);
    if (sourceRawId) stats.sourceInserted++;
    else stats.sourceSkipped++;
  }

  // LAYER 2: OPS - Create operational appointment with merged data
  const opsAppointmentId = await upsertAppointment({
    clinichqAppointmentId: appointmentId,
    appointmentDate,
    ownerFirstName,
    ownerLastName,
    ownerEmail,
    ownerPhone,
    ownerAddress,
    ownerRawPayload: merged,
  });
  stats.opsInserted++;

  // LAYER 3: SOT - Identity Resolution for Owner
  const classification = await classifyOwner(ownerFirstName, ownerLastName, ownerEmail, ownerPhone);

  if (classification.shouldBePerson) {
    const existing = await findPersonByIdentifier(ownerEmail, ownerPhone);

    if (existing) {
      await updateAppointmentResolution(opsAppointmentId, existing.personId, "auto_linked", `Matched on ${existing.matchedOn}`);
      stats.personsMatched++;
    } else if (ownerFirstName) {
      const newPersonId = await createPerson({
        firstName: ownerFirstName,
        lastName: ownerLastName,
        email: ownerEmail,
        phone: ownerPhone,
        sourceSystem: "clinichq",
      });

      if (newPersonId) {
        await updateAppointmentResolution(opsAppointmentId, newPersonId, "auto_linked", "Created new person");
        stats.personsCreated++;
      }
    }
  } else {
    // Map classification types to account types
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

    await updateAppointmentResolution(opsAppointmentId, null, "pseudo_profile", classification.reason);
    stats.pseudoProfiles++;
  }

  // LAYER 3: SOT - Create/Update Cat if microchip present
  if (record.microchip) {
    const existingCat = await queryOne<{ cat_id: string }>(`
      SELECT cat_id FROM sot.cats WHERE microchip = $1 AND merged_into_cat_id IS NULL
    `, [record.microchip]);

    if (existingCat) {
      stats.catsMatched++;
    } else {
      // Create new cat
      await query(`
        INSERT INTO sot.cats (microchip, name, sex, color, source_system, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'clinichq', NOW(), NOW())
        ON CONFLICT (microchip) WHERE merged_into_cat_id IS NULL DO NOTHING
      `, [record.microchip, catName || null, catSex || null, catColor || null]);
      stats.catsCreated++;
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

    // Merge by microchip
    const mergedRecords = mergeFilesByMicrochip(catInfoRows, ownerInfoRows, appointmentInfoRows);

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
      files: {
        cat_info: catInfoRows.length,
        owner_info: ownerInfoRows.length,
        appointment_info: appointmentInfoRows.length,
      },
    };

    // Process merged records
    for (const record of mergedRecords) {
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
      message: `Merged ${mergedRecords.length} records from 3 files (${catInfoRows.length}/${ownerInfoRows.length}/${appointmentInfoRows.length})`,
      stats,
      dryRun,
      elapsedMs,
    });

  } catch (error) {
    console.error("[V2 Ingest] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
