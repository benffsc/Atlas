import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, query } from "@/lib/db";

/**
 * Airtable Sync Cron Job
 *
 * Runs every 30 minutes on Vercel to sync intake submissions from
 * the Atlas Sync Airtable base into Atlas.
 *
 * Vercel Cron: Add to vercel.json:
 *   "crons": [{ "path": "/api/cron/airtable-sync", "schedule": "*/30 * * * *" }]
 *
 * Environment Variables Required:
 *   - AIRTABLE_PAT: Airtable Personal Access Token
 *   - CRON_SECRET: Optional secret for manual trigger security
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const ATLAS_SYNC_BASE_ID = "appwFuRddph1krmcd";
const STANDARDIZED_INTAKE_TABLE = "Standardized Intake";
const CRON_SECRET = process.env.CRON_SECRET;

interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: {
    "First Name"?: string;
    "Last Name"?: string;
    Email?: string;
    Phone?: string;
    "Requester Address"?: string;
    "Requester City"?: string;
    "Requester ZIP"?: string;
    "Is Third Party Report"?: boolean;
    "Third Party Relationship"?: string;
    "Property Owner Name"?: string;
    "Property Owner Phone"?: string;
    "Property Owner Email"?: string;
    "Cats Address"?: string;
    "Cats City"?: string;
    "Cats ZIP"?: string;
    County?: string;
    "Address Notes"?: string;
    "Ownership Status"?: string;
    "Cat Count Estimate"?: number;
    "Cat Count Text"?: string;
    "Peak Count"?: number;
    "Eartip Count Observed"?: number;
    "Fixed Status"?: string;
    "Awareness Duration"?: string;
    "Has Kittens"?: boolean;
    "Kitten Count"?: number;
    "Kitten Age Estimate"?: string;
    "Kitten Age Weeks"?: number;
    "Kitten Mixed Ages"?: boolean;
    "Kitten Mixed Ages Description"?: string;
    "Kitten Behavior"?: string;
    "Kitten Contained"?: string;
    "Mom Present"?: string;
    "Mom Fixed"?: string;
    "Can Bring In"?: string;
    "Kitten Notes"?: string;
    "Feeds Cat"?: boolean;
    "Feeding Frequency"?: string;
    "Feeding Duration"?: string;
    "Cat Comes Inside"?: string;
    "Is Emergency"?: boolean;
    "Emergency Acknowledged"?: boolean;
    "Has Medical Concerns"?: boolean;
    "Medical Description"?: string;
    "Cats Being Fed"?: boolean;
    "Feeder Info"?: string;
    "Has Property Access"?: boolean;
    "Access Notes"?: string;
    "Is Property Owner"?: boolean;
    "Situation Description"?: string;
    "Referral Source"?: string;
    "Submitted At"?: string;
    Source?: string;
    "Jotform Submission ID"?: string;
    "Sync Status"?: string;
    "Atlas Submission ID"?: string;
    "Sync Error"?: string;
  };
}

interface SyncResult {
  success: boolean;
  recordId: string;
  atlasId?: string;
  error?: string;
}

async function airtableFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `https://api.airtable.com/v0${endpoint}`;

  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

async function getPendingRecords(): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  // Fetch records with Sync Status = 'pending' or null
  const filterFormula = `OR({Sync Status}='pending', {Sync Status}=BLANK())`;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${ATLAS_SYNC_BASE_ID}/${encodeURIComponent(STANDARDIZED_INTAKE_TABLE)}`
    );
    url.searchParams.set("filterByFormula", filterFormula);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await airtableFetch(url.toString());
    const data = await res.json();

    if (data.error) {
      console.error("Airtable API error:", data.error);
      break;
    }

    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

async function updateAirtableRecord(
  recordId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await airtableFetch(
    `/${ATLAS_SYNC_BASE_ID}/${encodeURIComponent(STANDARDIZED_INTAKE_TABLE)}/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    }
  );
}

async function syncRecordToAtlas(record: AirtableRecord): Promise<SyncResult> {
  const f = record.fields;

  try {
    // Validate required fields
    if (!f.Email && !f.Phone) {
      return {
        success: false,
        recordId: record.id,
        error: "Missing contact info: need email or phone",
      };
    }

    if (!f["Cats Address"]) {
      return {
        success: false,
        recordId: record.id,
        error: "Missing cat location address",
      };
    }

    // Create submission in Atlas
    const submitterName = [f["First Name"], f["Last Name"]]
      .filter(Boolean)
      .join(" ");

    const result = await queryOne<{ submission_id: string }>(
      `INSERT INTO trapper.web_intake_submissions (
        first_name, last_name, email, phone,
        requester_address, requester_city, requester_zip,
        is_third_party_report, third_party_relationship,
        property_owner_name, property_owner_phone, property_owner_email,
        cats_address, cats_city, cats_zip, county,
        ownership_status, cat_count_estimate, cat_count_text,
        peak_count, eartip_count_observed, fixed_status,
        awareness_duration,
        has_kittens, kitten_count, kitten_age_estimate, kitten_age_weeks,
        kitten_mixed_ages, kitten_mixed_ages_description,
        kitten_behavior, kitten_contained,
        mom_present, mom_fixed, can_bring_in, kitten_notes,
        feeds_cat, feeding_frequency, feeding_duration, cat_comes_inside,
        is_emergency, has_medical_concerns, medical_description,
        cats_being_fed, feeder_info, has_property_access, access_notes,
        is_property_owner, situation_description, referral_source,
        source, intake_source, source_record_id,
        submitted_at, submitter_name, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
        $51, $52, $53, $54
      )
      ON CONFLICT (source_record_id) WHERE source_record_id IS NOT NULL
      DO UPDATE SET
        updated_at = NOW(),
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        cats_address = EXCLUDED.cats_address,
        cats_city = EXCLUDED.cats_city,
        cats_zip = EXCLUDED.cats_zip,
        cat_count_estimate = EXCLUDED.cat_count_estimate,
        situation_description = EXCLUDED.situation_description
      RETURNING submission_id`,
      [
        f["First Name"] || null,
        f["Last Name"] || null,
        f.Email || null,
        f.Phone || null,
        f["Requester Address"] || null,
        f["Requester City"] || null,
        f["Requester ZIP"] || null,
        f["Is Third Party Report"] || false,
        f["Third Party Relationship"] || null,
        f["Property Owner Name"] || null,
        f["Property Owner Phone"] || null,
        f["Property Owner Email"] || null,
        f["Cats Address"] || null,
        f["Cats City"] || null,
        f["Cats ZIP"] || null,
        f.County || null,
        f["Ownership Status"] || null,
        f["Cat Count Estimate"] || null,
        f["Cat Count Text"] || null,
        f["Peak Count"] || null,
        f["Eartip Count Observed"] || null,
        f["Fixed Status"] || null,
        f["Awareness Duration"] || null,
        f["Has Kittens"] || false,
        f["Kitten Count"] || null,
        f["Kitten Age Estimate"] || null,
        f["Kitten Age Weeks"] || null,
        f["Kitten Mixed Ages"] || false,
        f["Kitten Mixed Ages Description"] || null,
        f["Kitten Behavior"] || null,
        f["Kitten Contained"] || null,
        f["Mom Present"] || null,
        f["Mom Fixed"] || null,
        f["Can Bring In"] || null,
        f["Kitten Notes"] || null,
        f["Feeds Cat"] || false,
        f["Feeding Frequency"] || null,
        f["Feeding Duration"] || null,
        f["Cat Comes Inside"] || null,
        f["Is Emergency"] || false,
        f["Has Medical Concerns"] || false,
        f["Medical Description"] || null,
        f["Cats Being Fed"] || false,
        f["Feeder Info"] || null,
        f["Has Property Access"] || false,
        f["Access Notes"] || null,
        f["Is Property Owner"] || false,
        f["Situation Description"] || null,
        f["Referral Source"] || null,
        "airtable_sync",
        f.Source || "jotform_website",
        `airtable:${record.id}`,
        f["Submitted At"] ? new Date(f["Submitted At"]) : new Date(record.createdTime),
        submitterName || "Unknown",
        "new",
      ]
    );

    if (!result) {
      return {
        success: false,
        recordId: record.id,
        error: "Failed to insert/update submission",
      };
    }

    return {
      success: true,
      recordId: record.id,
      atlasId: result.submission_id,
    };
  } catch (error) {
    return {
      success: false,
      recordId: record.id,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  // Skip auth check for Vercel Cron requests or if CRON_SECRET matches
  if (
    !cronHeader &&
    CRON_SECRET &&
    authHeader !== `Bearer ${CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!AIRTABLE_PAT) {
    return NextResponse.json(
      { error: "AIRTABLE_PAT not configured" },
      { status: 500 }
    );
  }

  const startTime = Date.now();
  const results: SyncResult[] = [];

  try {
    // Get pending records from Airtable
    const pendingRecords = await getPendingRecords();
    console.log(`Found ${pendingRecords.length} pending records to sync`);

    if (pendingRecords.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending records to sync",
        synced: 0,
        errors: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // Process each record (batch to avoid timeout)
    const batchSize = 50; // Process 50 at a time to stay within Vercel limits
    const recordsToProcess = pendingRecords.slice(0, batchSize);

    for (const record of recordsToProcess) {
      const result = await syncRecordToAtlas(record);
      results.push(result);

      // Update Airtable with sync result
      if (result.success) {
        await updateAirtableRecord(record.id, {
          "Sync Status": "synced",
          "Atlas Submission ID": result.atlasId,
          "Last Synced At": new Date().toISOString(),
          "Sync Error": null,
        });
      } else {
        await updateAirtableRecord(record.id, {
          "Sync Status": "error",
          "Sync Error": result.error,
          "Last Synced At": new Date().toISOString(),
        });
      }
    }

    const synced = results.filter((r) => r.success).length;
    const errors = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `Synced ${synced} records, ${errors} errors`,
      synced,
      errors,
      pending_remaining: pendingRecords.length - recordsToProcess.length,
      duration_ms: Date.now() - startTime,
      results: results.map((r) => ({
        recordId: r.recordId,
        success: r.success,
        atlasId: r.atlasId,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      {
        error: "Sync failed",
        message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers with same logic
export async function POST(request: NextRequest) {
  return GET(request);
}
