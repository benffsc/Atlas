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
    "Is Third Party Report"?: string | boolean;
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
    "Has Kittens"?: string | boolean;
    "Kitten Count"?: number;
    "Kitten Age"?: string;
    "Kitten Socialization"?: string;
    "Mom Present"?: string;
    // Medical
    "Has Medical Concerns"?: string | boolean;
    "Medical Description"?: string;
    "Is Emergency"?: string | boolean;
    "Emergency Acknowledged"?: string | boolean;
    // Property access
    "Is Property Owner"?: string;  // yes/no/unsure
    "Has Property Access"?: string; // yes/no/unsure
    // Notes
    Notes?: string;
    "Referral Source"?: string;
    "Same As Requester"?: string;
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

// Convert string/boolean to boolean (handles "Yes", "No", "Yes - ...", etc.)
function toBool(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase().startsWith("yes");
  }
  return false;
}

// Parse Jotform structured address format into components
// Format: "Street name: X House number: Y City: Z State: S Postal code: P Country: C"
function parseJotformAddress(rawAddress: string): {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  if (!rawAddress) return { street: null, city: null, state: null, zip: null };

  // Try to extract components using regex
  const streetName = rawAddress.match(/Street name:\s*([^H]+?)(?=\s*House number:|$)/i)?.[1]?.trim() || null;
  const houseNumber = rawAddress.match(/House number:\s*(\d+)/i)?.[1]?.trim() || null;
  const city = rawAddress.match(/City:\s*([^S]+?)(?=\s*State:|$)/i)?.[1]?.trim() || null;
  const state = rawAddress.match(/State:\s*([A-Z]{2})/i)?.[1]?.trim() || null;
  const zip = rawAddress.match(/Postal code:\s*(\d{5})/i)?.[1]?.trim() || null;

  // Build street address
  let street: string | null = null;
  if (houseNumber && streetName) {
    street = `${houseNumber} ${streetName}`.trim();
  } else if (streetName) {
    street = streetName;
  }

  // If parsing failed, just use the raw address as street
  if (!street && rawAddress && !rawAddress.includes("Street name:")) {
    street = rawAddress;
  }

  return { street, city, state, zip };
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

    // Determine cat location address:
    // 1. Use "Street Address" if filled (cats at different location)
    // 2. Otherwise use "Requester Address" (cats at requester's address)
    const rawCatAddress = f["Street Address"] || f["Requester Address"];

    if (!rawCatAddress) {
      return {
        success: false,
        recordId: record.id,
        error: "Missing cat location address (no Street Address or Requester Address)",
      };
    }

    // Parse the address (handles Jotform structured format)
    const parsedCatAddress = parseJotformAddress(rawCatAddress);
    const parsedRequesterAddress = parseJotformAddress(f["Requester Address"] || "");

    // Use parsed cat address, fall back to Airtable fields, then parsed requester address
    const catsAddress = parsedCatAddress.street || f["Street Address"] || parsedRequesterAddress.street;
    const catsCity = f.City || parsedCatAddress.city || parsedRequesterAddress.city;
    const catsZip = f.ZIP || parsedCatAddress.zip || parsedRequesterAddress.zip;

    if (!catsAddress) {
      return {
        success: false,
        recordId: record.id,
        error: "Could not parse cat location address",
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

    // Build notes combining all relevant info
    const isThirdParty = typeof f["Is Third Party Report"] === "string"
      ? !f["Is Third Party Report"].toLowerCase().includes("no")
      : f["Is Third Party Report"];
    const notesContent = [
      situationParts,
      f.Notes,  // Additional notes from Jotform
      f["Cat Description"] ? `Cat: ${f["Cat Description"]}` : null,
      f.Handleability ? `Handleability: ${f.Handleability}` : null,
      f["Mom Present"] ? `Mom present: ${f["Mom Present"]}` : null,
      isThirdParty ? `Third party report: ${f["Third Party Relationship"] || "yes"}` : null,
      f["Same As Requester"] ? `Same address: ${f["Same As Requester"]}` : null,
    ].filter(Boolean).join("\n");

    const result = await queryOne<{ submission_id: string }>(
      `INSERT INTO trapper.web_intake_submissions (
        first_name, last_name, email, phone,
        requester_address, requester_city, requester_zip,
        cats_address, cats_city, cats_zip, county,
        ownership_status, cat_count_estimate, cat_count_text,
        fixed_status,
        has_kittens, kitten_count, kitten_age_estimate,
        is_emergency,
        has_medical_concerns, medical_description,
        has_property_access, is_property_owner,
        situation_description, referral_source,
        submitted_at, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27
      )
      RETURNING submission_id`,
      [
        f["First Name"] || "Unknown",                      // $1
        f["Last Name"] || "",                              // $2
        f.Email || "",                                     // $3
        f.Phone || null,                                   // $4
        f["Requester Address"] || null,                    // $5
        f["Requester City"] || null,                       // $6
        f["Requester ZIP"] || null,                        // $7
        catsAddress,                                       // $8 - parsed cat location address
        catsCity || null,                                  // $9 - parsed city
        catsZip || null,                                   // $10 - parsed zip
        f.County || null,                                  // $11
        ownershipStatus,                                   // $12 (derived from Call Type)
        f["Cat Count"] || null,                            // $13
        f["Cat Count Text"] || null,                       // $14
        f["Fixed Status"] || "unknown",                    // $15
        toBool(f["Has Kittens"]),                          // $16
        f["Kitten Count"] || null,                         // $17
        f["Kitten Age"] || null,                           // $18
        toBool(f["Is Emergency"]),                         // $19
        toBool(f["Has Medical Concerns"]),                 // $20
        f["Medical Description"] || null,                  // $21
        toBool(f["Has Property Access"]),                  // $22
        toBool(f["Is Property Owner"]),                    // $23
        notesContent || null,                              // $24
        f["Referral Source"] || null,                      // $25
        f["Submitted At"] ? new Date(f["Submitted At"]) : new Date(record.createdTime), // $26
        "new",                                             // $27 status
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
