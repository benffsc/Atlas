import { NextRequest } from "next/server";
import { queryOne, execute, queryRows } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";

/**
 * Process a VolunteerHub Excel export into source.volunteerhub_volunteers
 *
 * This is the manual fallback for when the VH API is down.
 * Staff exports "ALL Users & Fields" from VH admin → uploads here → Atlas syncs.
 *
 * Expected columns from VH export:
 * - User ID, Username, Name - FirstName, Name - LastName, Email
 * - Home Phone, Mobile Phone, Street Address - Address1/City/State/PostalCode
 * - Is Active, Trapping, Fostering, etc.
 *
 * POST /api/ingest/process-vh-upload
 * Body: { upload_id: string } — references ops.file_uploads row
 */

export const maxDuration = 120;

// Map Excel column headers → source.volunteerhub_volunteers columns
const COLUMN_MAP: Record<string, string> = {
  "User ID": "volunteerhub_id",
  "Username": "username",
  "Name - FirstName": "first_name",
  "Name - LastName": "last_name",
  "Email": "email",
  "Home Phone": "phone",
  "Mobile Phone": "phone_mobile",
  "Street Address  - Address1": "address",
  "Street Address  - City": "city",
  "Street Address  - State": "state",
  "Street Address  - PostalCode": "zip",
  "Street Address  - Address2": "address_2",
  "Is Active": "is_active",
  "Hours": "hours_logged",
  "Event Count": "event_count",
  "Last Update": "last_api_sync_at",
  "Last Login": "last_login_at",
  "Created": "joined_at",
  "Last Activity": "last_activity_at",
  "What are your preferred pronouns? ": "pronouns",
  "Occupation": "occupation",
  "How did you hear about Forgotten Felines?": "how_heard",
  "Why would you like to Volunteer with FFSC? ": "volunteer_motivation",
  "Volunteer Experience ": "volunteer_experience",
  "Volunteer Notes": "volunteer_notes",
  "Available Days & Times to Volunteer? ": "volunteer_availability",
  "Are you fluent in other languages?": "languages",
  "Emergency Contact ": "emergency_contact_raw",
  "Do you drive?": "can_drive",
  "Waiver": "waiver_status",
  "Date of Birth": "date_of_birth",
  // Skill/interest flags — stored in raw_data
  "Trapping": "_trapping",
  "Fostering": "_fostering",
  "Transportation ": "_transportation",
  "Special Skills ": "_special_skills",
  "Spay/Neuter Clinic": "_clinic",
  "Cat Colony Caretaking ": "_colony_caretaking",
  "Cat Reunification ": "_cat_reunification",
  "Cat or Kitten Experience ": "_cat_experience",
  "Laundry Angel ": "_laundry_angel",
  "Special Events/Fundraising ": "_events_fundraising",
};

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  return digits.length >= 10 ? digits : null;
}

function parseDateSafe(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const str = String(val).trim();
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseBool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const lower = val.toLowerCase().trim();
    return lower === "true" || lower === "yes" || lower === "1";
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const uploadId = body.upload_id;

    if (!uploadId) {
      return apiBadRequest("upload_id is required");
    }

    // Get the file from ops.file_uploads
    const upload = await queryOne<{
      upload_id: string;
      file_path: string;
      source_system: string;
      source_table: string;
      status: string;
    }>(
      `SELECT upload_id, file_path, source_system, source_table, status
       FROM ops.file_uploads WHERE upload_id = $1`,
      [uploadId]
    );

    if (!upload) {
      return apiBadRequest("Upload not found");
    }

    if (upload.source_system !== "volunteerhub") {
      return apiBadRequest("This endpoint only processes VolunteerHub uploads");
    }

    // Mark as processing
    await execute(
      `UPDATE ops.file_uploads SET status = 'processing', updated_at = NOW() WHERE upload_id = $1`,
      [uploadId]
    );

    // Read and parse XLSX
    const fs = await import("fs/promises");
    const XLSX = await import("xlsx");
    const fileBuffer = await fs.readFile(upload.file_path);
    const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    const stats = {
      total: rows.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      matched: 0,
      errors: 0,
      errorDetails: [] as string[],
    };

    for (const row of rows) {
      try {
        const vhId = String(row["User ID"] || "").trim();
        if (!vhId) {
          stats.skipped++;
          continue;
        }

        const firstName = String(row["Name - FirstName"] || "").trim();
        const lastName = String(row["Name - LastName"] || "").trim();
        const displayName = `${firstName} ${lastName}`.trim();
        const email = String(row["Email"] || "").trim().toLowerCase() || null;
        const homePhone = normalizePhone(row["Home Phone"] as string);
        const mobilePhone = normalizePhone(row["Mobile Phone"] as string);
        const phone = homePhone || mobilePhone;
        const isActive = parseBool(row["Is Active"]);

        // Build address
        const addr1 = String(row["Street Address  - Address1"] || "").trim();
        const addr2 = String(row["Street Address  - Address2"] || "").trim();
        const city = String(row["Street Address  - City"] || "").trim();
        const state = String(row["Street Address  - State"] || "").trim();
        const zip = String(row["Street Address  - PostalCode"] || "").trim();
        const fullAddress = [addr1, addr2, city, state, zip].filter(Boolean).join(", ") || null;

        // Build skill/interest tags
        const skills: string[] = [];
        if (parseBool(row["Trapping"])) skills.push("trapping");
        if (parseBool(row["Fostering"])) skills.push("fostering");
        if (parseBool(row["Transportation "])) skills.push("transportation");
        if (parseBool(row["Spay/Neuter Clinic"])) skills.push("clinic");
        if (parseBool(row["Cat Colony Caretaking "])) skills.push("colony_caretaking");
        if (parseBool(row["Cat Reunification "])) skills.push("cat_reunification");
        if (parseBool(row["Laundry Angel "])) skills.push("laundry_angel");
        if (parseBool(row["Special Events/Fundraising "])) skills.push("events_fundraising");

        // Store full row as raw_data for reference
        const rawData = JSON.stringify(row);

        const result = await queryOne<{ was_inserted: boolean }>(
          `INSERT INTO source.volunteerhub_volunteers (
             volunteerhub_id, username, display_name, first_name, last_name,
             email, phone, address, city, state, zip, full_address,
             status, is_active, hours_logged, event_count,
             joined_at, last_activity_at, last_login_at, last_api_sync_at,
             pronouns, occupation, how_heard, volunteer_motivation,
             volunteer_experience, volunteer_notes, volunteer_availability,
             languages, emergency_contact_raw, can_drive, waiver_status,
             date_of_birth, skills, raw_data,
             imported_at, synced_at, sync_status
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16,
             $17, $18, $19, $20,
             $21, $22, $23, $24,
             $25, $26, $27,
             $28, $29, $30, $31,
             $32, $33::JSONB, $34::JSONB,
             NOW(), NOW(), 'synced'
           )
           ON CONFLICT (volunteerhub_id) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             email = COALESCE(EXCLUDED.email, volunteerhub_volunteers.email),
             phone = COALESCE(EXCLUDED.phone, volunteerhub_volunteers.phone),
             address = EXCLUDED.address,
             city = EXCLUDED.city,
             state = EXCLUDED.state,
             zip = EXCLUDED.zip,
             full_address = EXCLUDED.full_address,
             status = EXCLUDED.status,
             is_active = EXCLUDED.is_active,
             hours_logged = EXCLUDED.hours_logged,
             event_count = EXCLUDED.event_count,
             last_activity_at = EXCLUDED.last_activity_at,
             last_login_at = EXCLUDED.last_login_at,
             last_api_sync_at = EXCLUDED.last_api_sync_at,
             pronouns = EXCLUDED.pronouns,
             occupation = EXCLUDED.occupation,
             skills = EXCLUDED.skills,
             raw_data = EXCLUDED.raw_data,
             synced_at = NOW(),
             sync_status = 'synced',
             updated_at = NOW()
           RETURNING (xmax = 0) AS was_inserted`,
          [
            vhId, row["Username"] || null, displayName, firstName, lastName,
            email, phone, addr1 || null, city || null, state || null, zip || null, fullAddress,
            isActive ? "active" : "inactive", isActive,
            typeof row["Hours"] === "number" ? row["Hours"] : null,
            typeof row["Event Count"] === "number" ? row["Event Count"] : null,
            parseDateSafe(row["Created"]),
            parseDateSafe(row["Last Activity"]),
            parseDateSafe(row["Last Login"]),
            parseDateSafe(row["Last Update"]),
            String(row["What are your preferred pronouns? "] || "").trim() || null,
            String(row["Occupation"] || "").trim() || null,
            String(row["How did you hear about Forgotten Felines?"] || "").trim() || null,
            String(row["Why would you like to Volunteer with FFSC? "] || "").trim() || null,
            String(row["Volunteer Experience "] || "").trim() || null,
            String(row["Volunteer Notes"] || "").trim() || null,
            String(row["Available Days & Times to Volunteer? "] || "").trim() || null,
            String(row["Are you fluent in other languages?"] || "").trim() || null,
            String(row["Emergency Contact "] || "").trim() || null,
            parseBool(row["Do you drive?"]),
            String(row["Waiver"] || "").trim() || null,
            parseDateSafe(row["Date of Birth"]),
            JSON.stringify(skills),
            rawData,
          ]
        );

        if (result?.was_inserted) {
          stats.inserted++;
          // New volunteer: run identity matching
          try {
            await execute(`SELECT sot.match_volunteerhub_volunteer($1)`, [vhId]);
            stats.matched++;
          } catch {
            // Non-fatal
          }
        } else {
          stats.updated++;
        }

        // Process roles for matched volunteers
        const matched = await queryOne<{ matched_person_id: string }>(
          `SELECT matched_person_id FROM source.volunteerhub_volunteers
           WHERE volunteerhub_id = $1 AND matched_person_id IS NOT NULL`,
          [vhId]
        );

        if (matched) {
          try {
            await execute(
              `SELECT ops.process_volunteerhub_group_roles($1, $2)`,
              [matched.matched_person_id, vhId]
            );
          } catch {
            // Non-fatal — group roles may not be in the Excel export
          }
        }
      } catch (err) {
        stats.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        if (stats.errorDetails.length < 10) {
          stats.errorDetails.push(msg.substring(0, 200));
        }
      }
    }

    // Mark upload as complete
    await execute(
      `UPDATE ops.file_uploads SET
         status = 'processed',
         records_found = $2,
         records_processed = $3,
         records_errors = $4,
         updated_at = NOW()
       WHERE upload_id = $1`,
      [uploadId, stats.total, stats.inserted + stats.updated, stats.errors]
    );

    console.log(
      `[VH-UPLOAD] Processed: ${stats.total} rows, ${stats.inserted} inserted, ${stats.updated} updated, ${stats.matched} matched, ${stats.errors} errors`
    );

    return apiSuccess({
      message: `Processed ${stats.total} volunteers`,
      ...stats,
    });
  } catch (error) {
    console.error("[VH-UPLOAD] Fatal error:", error);
    return apiServerError("Failed to process VolunteerHub upload");
  }
}
