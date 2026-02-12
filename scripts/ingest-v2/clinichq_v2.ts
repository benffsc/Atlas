#!/usr/bin/env npx tsx
/**
 * V2 Ingest Pipeline - ClinicHQ Processor
 *
 * Processes ClinicHQ XLSX exports through the 3-layer V2 architecture:
 *   Layer 1 (Source): Raw JSON stored in source.clinichq_raw
 *   Layer 2 (OPS): Operational data in ops.appointments
 *   Layer 3 (SOT): Canonical entities in sot.* (via identity resolution)
 *
 * Usage:
 *   source .env && npx tsx scripts/ingest-v2/clinichq_v2.ts --file <path>
 *
 * Options:
 *   --file <path>     Path to XLSX file
 *   --date <date>     Date folder (uses default ingest path)
 *   --dry-run         Parse and validate only, no database writes
 *   --verbose         Show detailed processing info
 */

import path from "path";
import fs from "fs";
import { closePool } from "./lib/db.js";
import {
  insertClinicHQRaw,
  ClinicHQRecordType,
} from "./lib/source_layer.js";
import {
  upsertAppointment,
  updateAppointmentResolution,
  upsertClinicAccount,
  ClinicAccountType,
} from "./lib/ops_layer.js";
import {
  classifyOwner,
  resolvePersonIdentity,
  resolveCatByMicrochip,
  resolvePlaceByAddress,
  validateMicrochip,
} from "./lib/sot_resolver.js";

// Import xlsx parsing (reuse V1 lib)
import XLSX from "xlsx";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH || "/Users/benmisdiaz/Desktop/AI_Ingest";
const SOURCE_SYSTEM = "clinichq";

interface ProcessingOptions {
  xlsxPath: string;
  dryRun: boolean;
  verbose: boolean;
}

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
}

// ============================================================================
// XLSX Parsing (simplified from V1)
// ============================================================================

function parseXlsxFile(filePath: string): { headers: string[]; rows: Record<string, unknown>[] } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, {
    type: "file",
    cellDates: true,
    cellNF: false,
    cellText: false,
  });

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  }) as unknown[][];

  if (rawData.length === 0) {
    return { headers: [], rows: [] };
  }

  // First row is headers
  const rawHeaders = rawData[0] as string[];
  const headers = rawHeaders.map((h, i) =>
    h ? String(h).trim() : `_col_${i + 1}`
  );

  // Remaining rows are data
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const rowArray = rawData[i] as unknown[];
    const rowObj: Record<string, unknown> = {};
    let hasData = false;

    for (let j = 0; j < headers.length; j++) {
      let value = j < rowArray.length ? rowArray[j] : "";
      if (typeof value === "string") {
        value = value.trim();
      }
      if (value instanceof Date) {
        value = value.toISOString();
      }
      rowObj[headers[j]] = value;
      if (value !== "" && value !== null && value !== undefined) {
        hasData = true;
      }
    }

    if (hasData) {
      rows.push(rowObj);
    }
  }

  return { headers, rows };
}

// ============================================================================
// Field Extraction Helpers
// ============================================================================

function getString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function getAppointmentId(row: Record<string, unknown>): string {
  // Try various ID field names
  const id = getString(row, "ID", "id", "Appointment ID", "Number");
  if (id) return id;

  // Generate from date + number if no explicit ID
  const date = getString(row, "Date", "Appointment Date");
  const number = getString(row, "Number", "#");
  if (date && number) {
    return `${date}_${number}`;
  }

  throw new Error("Cannot determine appointment ID");
}

function getRecordType(row: Record<string, unknown>): ClinicHQRecordType {
  // Detect record type from fields present
  if (row["Microchip"] || row["Cat Name"] || row["Animal Name"]) {
    return "cat";
  }
  if (row["Owner First Name"] || row["Owner Last Name"] || row["Owner Email"]) {
    return "owner";
  }
  if (row["Procedure"] || row["Surgery"]) {
    return "procedure";
  }
  if (row["Date"] || row["Appointment Date"]) {
    return "appointment";
  }
  return "unknown";
}

function classifyAccountType(classification: string): ClinicAccountType {
  switch (classification) {
    case "organization":
      return "organization";
    case "address":
      return "address";
    case "garbage":
      return "unknown";
    default:
      return "unknown";
  }
}

// ============================================================================
// Main Processing Functions
// ============================================================================

async function processAppointmentRow(
  row: Record<string, unknown>,
  stats: ProcessingStats,
  options: ProcessingOptions
): Promise<void> {
  const appointmentId = getAppointmentId(row);
  const recordType = getRecordType(row);

  // =========================================================================
  // LAYER 1: Source - Store raw JSON
  // =========================================================================
  const sourceRawId = await insertClinicHQRaw({
    recordType,
    sourceRecordId: appointmentId,
    payload: row,
  });

  if (sourceRawId) {
    stats.sourceInserted++;
    if (options.verbose) {
      console.log(`  [SOURCE] New: ${appointmentId}`);
    }
  } else {
    stats.sourceSkipped++;
    if (options.verbose) {
      console.log(`  [SOURCE] Unchanged: ${appointmentId}`);
    }
  }

  // =========================================================================
  // LAYER 2: OPS - Create operational appointment
  // =========================================================================
  const ownerFirstName = getString(row, "Owner First Name", "First Name");
  const ownerLastName = getString(row, "Owner Last Name", "Last Name");
  const ownerEmail = getString(row, "Owner Email", "Email");
  const ownerPhone = getString(row, "Owner Phone", "Phone", "Owner Cell Phone", "Cell Phone");
  const ownerAddress = getString(row, "Owner Address", "Address", "Street");
  const appointmentDate = getString(row, "Date", "Appointment Date") || new Date().toISOString().split("T")[0];

  // Get cat info if present
  const catId = getString(row, "Cat ID", "Animal ID");
  const microchip = getString(row, "Microchip", "Microchip Number", "Chip");

  const opsAppointmentId = await upsertAppointment({
    clinichqAppointmentId: appointmentId,
    appointmentDate,
    ownerFirstName,
    ownerLastName,
    ownerEmail,
    ownerPhone,
    ownerAddress,
    ownerRawPayload: row,
    sourceRawId: sourceRawId || undefined,
    catId,
  });

  stats.opsInserted++;

  // =========================================================================
  // LAYER 3: SOT - Identity Resolution
  // =========================================================================

  // Classify owner to determine routing
  const classification = await classifyOwner(
    ownerFirstName,
    ownerLastName,
    ownerEmail,
    ownerPhone
  );

  if (classification.shouldBePerson) {
    // Route to SOT: Real person
    const personResult = await resolvePersonIdentity({
      firstName: ownerFirstName || "",
      lastName: ownerLastName,
      email: ownerEmail,
      phone: ownerPhone,
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordId: appointmentId,
    });

    if (personResult.personId) {
      await updateAppointmentResolution(
        opsAppointmentId,
        personResult.personId,
        personResult.status === "created" ? "auto_linked" : "auto_linked",
        personResult.notes
      );

      if (personResult.status === "created") {
        stats.personsCreated++;
        if (options.verbose) {
          console.log(`  [SOT] Person created: ${ownerFirstName} ${ownerLastName}`);
        }
      } else {
        stats.personsMatched++;
        if (options.verbose) {
          console.log(`  [SOT] Person matched: ${ownerFirstName} ${ownerLastName}`);
        }
      }
    }
  } else {
    // Route to OPS: Pseudo-profile (clinic account)
    await upsertClinicAccount({
      ownerFirstName,
      ownerLastName,
      ownerEmail,
      ownerPhone,
      ownerAddress,
      accountType: classifyAccountType(classification.type),
      classificationReason: classification.reason,
    });

    await updateAppointmentResolution(
      opsAppointmentId,
      null,
      "pseudo_profile",
      classification.reason
    );

    stats.pseudoProfiles++;
    if (options.verbose) {
      console.log(`  [OPS] Pseudo-profile: ${ownerFirstName} ${ownerLastName} (${classification.type})`);
    }
  }

  // =========================================================================
  // Process Cat (if microchip present)
  // =========================================================================
  if (microchip) {
    const catResult = await resolveCatByMicrochip({
      microchip,
      name: getString(row, "Cat Name", "Animal Name", "Name"),
      sex: getString(row, "Sex", "Gender"),
      color: getString(row, "Color", "Colour", "Coat Color"),
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordId: appointmentId,
    });

    if (catResult.catId) {
      if (catResult.status === "created") {
        stats.catsCreated++;
      } else {
        stats.catsMatched++;
      }
    }
  }

  // =========================================================================
  // Process Place (if address present)
  // =========================================================================
  if (ownerAddress && classification.shouldBePerson) {
    const placeResult = await resolvePlaceByAddress({
      address: ownerAddress,
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordId: appointmentId,
    });

    if (placeResult.placeId) {
      if (placeResult.status === "created") {
        stats.placesCreated++;
      } else {
        stats.placesMatched++;
      }
    }
  }
}

async function processFile(options: ProcessingOptions): Promise<ProcessingStats> {
  const stats: ProcessingStats = {
    total: 0,
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
  };

  console.log(`\n${"═".repeat(60)}`);
  console.log("  ClinicHQ V2 Ingest Pipeline");
  console.log(`${"═".repeat(60)}\n`);
  console.log(`Source: ${options.xlsxPath}`);
  console.log(`Mode: ${options.dryRun ? "DRY RUN" : "LIVE"}\n`);

  // Parse XLSX
  const { headers, rows } = parseXlsxFile(options.xlsxPath);
  stats.total = rows.length;

  console.log(`Parsed: ${rows.length} rows, ${headers.length} columns`);
  if (options.verbose) {
    console.log(`Headers: ${headers.slice(0, 5).join(", ")}...`);
  }

  if (rows.length === 0) {
    console.log("No data rows found.");
    return stats;
  }

  if (options.dryRun) {
    console.log("\n[DRY RUN] Would process rows without writing to database.");
    // In dry run, just validate the data
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const row = rows[i];
      const classification = await classifyOwner(
        getString(row, "Owner First Name"),
        getString(row, "Owner Last Name"),
        getString(row, "Owner Email"),
        getString(row, "Owner Phone")
      );
      console.log(`  Row ${i + 1}: ${classification.type} (${classification.shouldBePerson ? "person" : "pseudo"})`);
    }
    return stats;
  }

  // Process each row
  console.log("\nProcessing...\n");
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    try {
      await processAppointmentRow(row, stats, options);

      // Progress indicator
      if ((i + 1) % 100 === 0 || i === rows.length - 1) {
        process.stdout.write(`\r  Processed: ${i + 1}/${rows.length}`);
      }
    } catch (error) {
      stats.errors++;
      console.error(`\n  Error row ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n\nCompleted in ${elapsed}s\n`);

  return stats;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): ProcessingOptions {
  const args = process.argv.slice(2);
  const options: ProcessingOptions = {
    xlsxPath: "",
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
        options.xlsxPath = args[++i];
        break;
      case "--date":
        const date = args[++i];
        options.xlsxPath = path.join(DEFAULT_INGEST_PATH, "clinichq", date, "appointment_info.xlsx");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--help":
      case "-h":
        console.log(`
ClinicHQ V2 Ingest Pipeline

Usage:
  npx tsx scripts/ingest-v2/clinichq_v2.ts --file <path>
  npx tsx scripts/ingest-v2/clinichq_v2.ts --date <YYYY-MM-DD>

Options:
  --file <path>     Path to XLSX file
  --date <date>     Date folder (uses default ingest path)
  --dry-run         Parse and validate only, no database writes
  --verbose, -v     Show detailed processing info
  --help, -h        Show this help

Environment:
  DATABASE_URL      Required. PostgreSQL connection string.
  LOCAL_INGEST_PATH Optional. Default: /Users/benmisdiaz/Desktop/AI_Ingest
`);
        process.exit(0);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (!options.xlsxPath) {
    console.error("Error: --file or --date required. Use --help for usage.");
    process.exit(1);
  }

  if (!fs.existsSync(options.xlsxPath)) {
    console.error(`Error: File not found: ${options.xlsxPath}`);
    process.exit(1);
  }

  try {
    const stats = await processFile(options);

    // Print summary
    console.log(`${"─".repeat(40)}`);
    console.log("Summary");
    console.log(`${"─".repeat(40)}`);
    console.log(`Total rows:        ${stats.total}`);
    console.log(`Source inserted:   ${stats.sourceInserted}`);
    console.log(`Source unchanged:  ${stats.sourceSkipped}`);
    console.log(`OPS appointments:  ${stats.opsInserted}`);
    console.log(`Persons created:   ${stats.personsCreated}`);
    console.log(`Persons matched:   ${stats.personsMatched}`);
    console.log(`Pseudo-profiles:   ${stats.pseudoProfiles}`);
    console.log(`Cats created:      ${stats.catsCreated}`);
    console.log(`Cats matched:      ${stats.catsMatched}`);
    console.log(`Places created:    ${stats.placesCreated}`);
    console.log(`Places matched:    ${stats.placesMatched}`);
    console.log(`Errors:            ${stats.errors}`);

    if (stats.errors > 0) {
      process.exit(1);
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
