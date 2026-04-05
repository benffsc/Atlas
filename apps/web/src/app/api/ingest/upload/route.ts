import { NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError, apiConflict } from "@/lib/api-response";
import { writeFile, mkdir } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import path from "path";

// Supported source systems and their expected tables
const SOURCE_CONFIGS: Record<string, { tables: string[]; label: string; accepts?: string[] }> = {
  clinichq: {
    label: "ClinicHQ",
    tables: ["cat_info", "owner_info", "appointment_info"],
  },
  volunteerhub: {
    label: "VolunteerHub",
    tables: ["users"],
  },
  airtable: {
    label: "Airtable",
    tables: ["trapping_requests", "appointment_requests", "trapper_cats"],
  },
  shelterluv: {
    label: "Shelterluv",
    tables: ["animals", "people", "outcomes"],
  },
  petlink: {
    label: "PetLink",
    tables: ["pets", "owners"],
  },
  google_maps: {
    label: "Google Maps",
    tables: ["placemarks"],
    accepts: [".kmz", ".kml"],
  },
  clinic_waiver: {
    label: "Clinic Waiver",
    tables: ["waiver_scan"],
    accepts: [".pdf"],
  },
};

export async function GET() {
  // Return available source systems
  return apiSuccess({
    sources: Object.entries(SOURCE_CONFIGS).map(([key, config]) => ({
      value: key,
      label: config.label,
      tables: config.tables,
      accepts: config.accepts || [".csv", ".xlsx", ".xls"],
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    let formData;
    try {
      formData = await request.formData();
    } catch (formError) {
      console.error("[UPLOAD] FormData parse error:", formError);
      return apiBadRequest(`FormData parse error: ${formError instanceof Error ? formError.message : String(formError)}`);
    }
    const file = formData.get("file") as File | null;
    const sourceSystem = formData.get("source_system") as string | null;
    const sourceTable = formData.get("source_table") as string | null;
    let batchId = formData.get("batch_id") as string | null;

    // MIG_971: For ClinicHQ uploads, auto-generate batch_id if not provided
    // This groups the 3 files (cat_info, owner_info, appointment_info) together
    if (sourceSystem === "clinichq" && !batchId) {
      batchId = randomUUID();
    }

    // Validation
    if (!file) {
      return apiBadRequest("No file provided");
    }

    if (!sourceSystem || !SOURCE_CONFIGS[sourceSystem]) {
      return apiBadRequest("Invalid source system");
    }

    if (!sourceTable || !SOURCE_CONFIGS[sourceSystem].tables.includes(sourceTable)) {
      return apiBadRequest("Invalid source table for this system");
    }

    // Read file content
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // ClinicHQ column header validation — prevent swapped files (FFS-735)
    if (sourceSystem === "clinichq") {
      try {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: 2 });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
        if (rows.length > 0) {
          const headers = new Set((rows[0] as string[]).map((h) => String(h).trim()));
          // Signature columns that uniquely identify each file type
          const signatures: Record<string, string[]> = {
            cat_info: ["Breed", "Primary Color", "Secondary Color"],
            owner_info: ["Owner First Name", "Owner Last Name", "Owner Email"],
            appointment_info: ["Service / Subsidy", "Vet Name", "Technician"],
          };
          // Detect what this file actually is
          let detectedType: string | null = null;
          for (const [type, cols] of Object.entries(signatures)) {
            const matched = cols.filter((c) => headers.has(c)).length;
            if (matched >= 2) { detectedType = type; break; }
          }
          if (detectedType && detectedType !== sourceTable) {
            return apiBadRequest(
              `File mismatch: this looks like ${detectedType} (found columns: ${signatures[detectedType].filter((c) => headers.has(c)).join(", ")}), but was uploaded as ${sourceTable}. Please check the file assignment.`
            );
          }
        }
      } catch (xlsxErr) {
        console.warn("[UPLOAD] Column header validation skipped:", xlsxErr);
        // Non-fatal — allow upload to proceed if XLSX parsing fails
      }
    }

    // Calculate file hash for duplicate detection
    const fileHash = createHash("sha256").update(buffer).digest("hex");

    // Check for duplicate - but allow re-upload if previous attempt failed
    const existing = await queryOne<{ upload_id: string; status: string }>(
      `SELECT upload_id, status FROM ops.file_uploads WHERE file_hash = $1`,
      [fileHash]
    );

    if (existing) {
      // Allow re-upload if previous was failed or pending (stalled) - delete the old record first
      if (existing.status === 'failed' || existing.status === 'pending') {
        console.error(`[UPLOAD] Previous upload was ${existing.status}, allowing re-upload`);
        await query(`DELETE FROM ops.staged_records WHERE file_upload_id = $1`, [existing.upload_id]);
        await query(`DELETE FROM ops.file_uploads WHERE upload_id = $1`, [existing.upload_id]);
      } else if (existing.status === 'completed') {
        // Allow re-upload if it's part of a new batch (user retrying after partial failure).
        // Clean up old record so the new batch can include this file.
        if (batchId) {
          console.error(`[UPLOAD] Re-uploading completed file into new batch ${batchId}, replacing old record`);
          await query(`DELETE FROM ops.staged_records WHERE file_upload_id = $1`, [existing.upload_id]);
          await query(`DELETE FROM ops.file_uploads WHERE upload_id = $1`, [existing.upload_id]);
        } else {
          return apiConflict(`This file has already been processed successfully (upload_id: ${existing.upload_id}). Upload a new export if you have new data.`);
        }
      } else {
        return apiConflict(`This file is currently being processed (upload_id: ${existing.upload_id}, status: ${existing.status}). Please wait.`);
      }
    }

    // Generate storage filename: {source}_{table}_{timestamp}_{hash8}.{ext}
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const hashPrefix = fileHash.substring(0, 8);
    const originalExt = file.name.split('.').pop()?.toLowerCase() || 'csv';
    const validExts = SOURCE_CONFIGS[sourceSystem].accepts
      ? SOURCE_CONFIGS[sourceSystem].accepts.map(e => e.replace('.', ''))
      : ['csv', 'xlsx', 'xls'];
    const ext = validExts.includes(originalExt) ? originalExt : validExts[0];
    const storedFilename = `${sourceSystem}_${sourceTable}_${timestamp}_${hashPrefix}.${ext}`;

    // Skip filesystem on serverless - store in DB only
    // Vercel's filesystem is read-only except /tmp
    const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (!isServerless) {
      try {
        const uploadDir = path.join(process.cwd(), "uploads", "ingest");
        await mkdir(uploadDir, { recursive: true });
        const filePath = path.join(uploadDir, storedFilename);
        await writeFile(filePath, buffer);
      } catch (fsError) {
        console.error("[UPLOAD] Filesystem write failed, using DB storage only");
      }
    }

    // Record in database (store file content for serverless environments)
    // MIG_971: Include batch_id for ClinicHQ batch tracking
    let result;
    try {
      result = await queryOne<{ upload_id: string }>(
        `INSERT INTO ops.file_uploads (
          original_filename,
          stored_filename,
          file_size_bytes,
          file_hash,
          source_system,
          source_table,
          status,
          file_content,
          batch_id
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
        RETURNING upload_id`,
        [
          file.name,
          storedFilename,
          buffer.length,
          fileHash,
          sourceSystem,
          sourceTable,
          buffer,
          batchId,
        ]
      );
    } catch (dbError) {
      console.error("[UPLOAD] Database insert failed:", dbError);
      const dbErrorMsg = dbError instanceof Error ? dbError.message : String(dbError);
      return apiServerError(`Database error: ${dbErrorMsg}`);
    }

    return apiSuccess({
      success: true,
      upload_id: result?.upload_id,
      original_filename: file.name,
      stored_filename: storedFilename,
      file_size: buffer.length,
      // MIG_971: Return batch_id for ClinicHQ batch tracking
      batch_id: batchId,
      message: batchId
        ? "File uploaded successfully. Part of batch - upload remaining files before processing."
        : "File uploaded successfully. Ready for processing.",
    });
  } catch (error) {
    console.error("Upload error:", error);
    const errorMessage = error instanceof Error
      ? `${error.name}: ${error.message}`
      : JSON.stringify(error);
    return apiServerError(`[v2] Upload failed: ${errorMessage}`);
  }
}

// Next.js App Router config - increase body size limit and timeout
export const maxDuration = 60; // 60 seconds for Pro plan, 10 for Hobby
