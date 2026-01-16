import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows, query } from "@/lib/db";

// Airtable Sync Cron Job
//
// Runs every 30 minutes on Vercel to sync intake submissions from
// the Atlas Sync Airtable base into Atlas.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/airtable-sync", "schedule": "every-30-min" }]
//
// Environment Variables Required:
//   - AIRTABLE_PAT: Airtable Personal Access Token
//   - CRON_SECRET: Optional secret for manual trigger security

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const ATLAS_SYNC_BASE_ID = "appwFuRddph1krmcd";
const STANDARDIZED_INTAKE_TABLE = "Public Intake Submissions";
const CRON_SECRET = process.env.CRON_SECRET;

interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: {
    // Contact info
    "First Name"?: string;
    "Last Name"?: string;
    Email?: string;
    Phone?: string;
    "Requester Address"?: string;
    "Requester City"?: string;
    "Requester ZIP"?: string;
    // Third party
    "Is Third Party Report"?: boolean;
    "Third Party Relationship"?: string;
    "Property Owner Name"?: string;
    "Property Owner Phone"?: string;
    "Property Owner Email"?: string;
    // Cat location
    "Street Address"?: string;
    City?: string;
    ZIP?: string;
    County?: string;
    // Cat details
    "Call Type"?: string;
    "Cat Name"?: string;
    "Cat Description"?: string;
    "Cat Count"?: number;
    "Cat Count Text"?: string;
    "Peak Count"?: number;
    "Eartip Count"?: number;
    "Feeding Situation"?: string;
    Handleability?: string;
    "Fixed Status"?: string;
    // Kittens
    "Has Kittens"?: boolean;
    "Kitten Count"?: number;
    "Kitten Age"?: string;
    "Kitten Socialization"?: string;
    "Mom Present"?: string;
    // Medical
    "Has Medical Concerns"?: boolean;
    "Medical Description"?: string;
    "Is Emergency"?: boolean;
    "Emergency Acknowledged"?: boolean;
    // Property access
    "Is Property Owner"?: string;  // yes/no/unsure
    "Has Property Access"?: string; // yes/no/unsure
    // Notes
    Notes?: string;
    "Referral Source"?: string;
    // Metadata
    "Submitted At"?: string;
    "Jotform Submission ID"?: string;
    // Sync tracking
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

    if (!f["Street Address"]) {
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

    // Build situation description from call type, cat name/description, and notes
    const situationParts = [
      f["Call Type"] ? `Call type: ${f["Call Type"]}` : null,
      f["Cat Name"] ? `Cat name: ${f["Cat Name"]}` : null,
      f["Cat Description"] ? `Description: ${f["Cat Description"]}` : null,
      f["Feeding Situation"] ? `Feeding: ${f["Feeding Situation"]}` : null,
      f.Notes,
    ].filter(Boolean).join("\n");

    // Map ownership status from call type
    const ownershipStatus =
      f["Call Type"] === "pet_spay_neuter" ? "my_cat" :
      f["Call Type"] === "colony_tnr" ? "community_colony" :
      f["Call Type"] === "single_stray" ? "unknown_stray" :
      f["Call Type"] === "kitten_rescue" ? "unknown_stray" :
      "unknown_stray";

    const result = await queryOne<{ submission_id: string }>(
      `INSERT INTO trapper.web_intake_submissions (
        first_name, last_name, email, phone,
        requester_address, requester_city, requester_zip,
        is_third_party_report, third_party_relationship,
        property_owner_name, property_owner_phone, property_owner_email,
        cats_address, cats_city, cats_zip, county,
        ownership_status, cat_count_estimate, cat_count_text,
        peak_count, eartip_count_observed, fixed_status,
        handleability,
        has_kittens, kitten_count, kitten_age_estimate,
        kitten_behavior, mom_present,
        is_emergency, emergency_acknowledged,
        has_medical_concerns, medical_description,
        has_property_access, is_property_owner,
        situation_description, referral_source,
        source, intake_source, source_record_id,
        submitted_at, submitter_name, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42
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
        f["First Name"] || null,                           // $1
        f["Last Name"] || null,                            // $2
        f.Email || null,                                   // $3
        f.Phone || null,                                   // $4
        f["Requester Address"] || null,                    // $5
        f["Requester City"] || null,                       // $6
        f["Requester ZIP"] || null,                        // $7
        f["Is Third Party Report"] || false,               // $8
        f["Third Party Relationship"] || null,             // $9
        f["Property Owner Name"] || null,                  // $10
        f["Property Owner Phone"] || null,                 // $11
        f["Property Owner Email"] || null,                 // $12
        f["Street Address"] || null,                       // $13 (was Cats Address)
        f.City || null,                                    // $14 (was Cats City)
        f.ZIP || null,                                     // $15 (was Cats ZIP)
        f.County || null,                                  // $16
        ownershipStatus,                                   // $17 (derived from Call Type)
        f["Cat Count"] || null,                            // $18 (was Cat Count Estimate)
        f["Cat Count Text"] || null,                       // $19
        f["Peak Count"] || null,                           // $20
        f["Eartip Count"] || null,                         // $21 (was Eartip Count Observed)
        f["Fixed Status"] || null,                         // $22
        f.Handleability || null,                           // $23
        f["Has Kittens"] || false,                         // $24
        f["Kitten Count"] || null,                         // $25
        f["Kitten Age"] || null,                           // $26 (was Kitten Age Estimate)
        f["Kitten Socialization"] || null,                 // $27 (maps to kitten_behavior)
        f["Mom Present"] || null,                          // $28
        f["Is Emergency"] || false,                        // $29
        f["Emergency Acknowledged"] || false,              // $30
        f["Has Medical Concerns"] || false,                // $31
        f["Medical Description"] || null,                  // $32
        f["Has Property Access"] === "yes",                // $33 (convert string to boolean)
        f["Is Property Owner"] === "yes",                  // $34 (convert string to boolean)
        situationParts || null,                            // $35
        f["Referral Source"] || null,                      // $36
        "airtable_sync",                                   // $37 source
        "jotform_website",                                 // $38 intake_source
        `airtable:${record.id}`,                           // $39 source_record_id
        f["Submitted At"] ? new Date(f["Submitted At"]) : new Date(record.createdTime), // $40
        submitterName || "Unknown",                        // $41
        "new",                                             // $42 status
      ]
    );

    if (!result) {
      return {
        success: false,
        recordId: record.id,
        error: "Failed to insert/update submission",
      };
    }

    // Post-insert: Match to person and link to place (fire-and-forget)
    // These are the same triggers used by the regular intake API
    try {
      await query("SELECT trapper.match_intake_to_person($1)", [result.submission_id]);
    } catch (err) {
      console.error("Person matching error for", result.submission_id, err);
    }

    try {
      await query("SELECT trapper.link_intake_submission_to_place($1)", [result.submission_id]);
    } catch (err) {
      console.error("Place linking error for", result.submission_id, err);
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
          "Synced At": new Date().toISOString(),
          "Sync Error": null,
        });
      } else {
        await updateAirtableRecord(record.id, {
          "Sync Status": "error",
          "Sync Error": result.error,
          "Synced At": new Date().toISOString(),
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
