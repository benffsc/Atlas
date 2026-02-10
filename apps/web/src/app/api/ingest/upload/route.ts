import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
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
};

export async function GET() {
  // Return available source systems
  return NextResponse.json({
    sources: Object.entries(SOURCE_CONFIGS).map(([key, config]) => ({
      value: key,
      label: config.label,
      tables: config.tables,
      accepts: config.accepts || [".csv", ".xlsx", ".xls"],
    })),
  });
}

export async function POST(request: NextRequest) {
  console.log("[UPLOAD] Starting upload request v2...");

  try {
    console.log("[UPLOAD] Parsing formData...");
    let formData;
    try {
      formData = await request.formData();
    } catch (formError) {
      console.error("[UPLOAD] FormData parse error:", formError);
      return NextResponse.json(
        { error: `FormData parse error: ${formError instanceof Error ? formError.message : String(formError)}` },
        { status: 400 }
      );
    }
    const file = formData.get("file") as File | null;
    const sourceSystem = formData.get("source_system") as string | null;
    const sourceTable = formData.get("source_table") as string | null;
    let batchId = formData.get("batch_id") as string | null;

    console.log("[UPLOAD] Got:", {
      fileName: file?.name,
      fileSize: file?.size,
      sourceSystem,
      sourceTable,
      batchId
    });

    // MIG_971: For ClinicHQ uploads, auto-generate batch_id if not provided
    // This groups the 3 files (cat_info, owner_info, appointment_info) together
    if (sourceSystem === "clinichq" && !batchId) {
      batchId = randomUUID();
      console.log("[UPLOAD] Generated batch_id for ClinicHQ:", batchId);
    }

    // Validation
    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!sourceSystem || !SOURCE_CONFIGS[sourceSystem]) {
      return NextResponse.json(
        { error: "Invalid source system" },
        { status: 400 }
      );
    }

    if (!sourceTable || !SOURCE_CONFIGS[sourceSystem].tables.includes(sourceTable)) {
      return NextResponse.json(
        { error: "Invalid source table for this system" },
        { status: 400 }
      );
    }

    // Read file content
    console.log("[UPLOAD] Reading file content...");
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    console.log("[UPLOAD] File read, size:", buffer.length);

    // Calculate file hash for duplicate detection
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    console.log("[UPLOAD] Hash:", fileHash.substring(0, 16));

    // Check for duplicate
    const existing = await queryOne<{ upload_id: string }>(
      `SELECT upload_id FROM trapper.file_uploads WHERE file_hash = $1`,
      [fileHash]
    );

    if (existing) {
      return NextResponse.json(
        {
          error: "This file has already been uploaded",
          existing_upload_id: existing.upload_id
        },
        { status: 409 }
      );
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
        console.log("[UPLOAD] File written to disk");
      } catch (fsError) {
        console.log("[UPLOAD] Filesystem write failed, using DB storage only");
      }
    } else {
      console.log("[UPLOAD] Serverless environment, using DB storage only");
    }

    // Record in database (store file content for serverless environments)
    // MIG_971: Include batch_id for ClinicHQ batch tracking
    console.log("[UPLOAD] Inserting into database...");
    let result;
    try {
      result = await queryOne<{ upload_id: string }>(
        `INSERT INTO trapper.file_uploads (
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
      return NextResponse.json(
        { error: `Database error: ${dbErrorMsg}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
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
    return NextResponse.json(
      { error: `[v2] Upload failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// Next.js App Router config - increase body size limit and timeout
export const maxDuration = 60; // 60 seconds for Pro plan, 10 for Hobby
