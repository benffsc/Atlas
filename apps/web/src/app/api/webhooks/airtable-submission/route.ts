import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import {
  apiSuccess,
  apiUnauthorized,
  apiServerError,
} from "@/lib/api-response";

/**
 * Airtable → Atlas Intake Sync Webhook
 *
 * Pipeline: Jotform → Zapier → Airtable → (automation script) → THIS endpoint → Atlas
 *
 * The Airtable automation calls this endpoint when a new record lands.
 * This endpoint pulls all "pending" records from Airtable, inserts them
 * into ops.intake_submissions, then marks them as "synced" in Airtable.
 *
 * Airtable table: Public Intake Submissions (tblGQDVELZBhnxvUm)
 * Airtable base: appwFuRddph1krmcd
 *
 * Auth: Bearer token matching WEBHOOK_SECRET env var.
 */

export const maxDuration = 60;

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.CRON_SECRET;
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_ATLAS_SYNC_BASE_ID || "appwFuRddph1krmcd";
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_PUBLIC_INTAKE_TABLE_ID || "tblGQDVELZBhnxvUm";

// Jotform call type labels → Atlas call_type values
const CALL_TYPE_MAP: Record<string, string> = {
  "Pet Spay/Neuter - My cat needs to be fixed": "pet_spay_neuter",
  "pet_spay_neuter": "pet_spay_neuter",
  "Single Stray - One unfamiliar cat showed up": "single_stray",
  "single_stray": "single_stray",
  "Colony/FFR - Multiple outdoor cats need help": "colony_tnr",
  "colony_tnr": "colony_tnr",
  "Kitten Situation - Found kittens, need help": "kitten_rescue",
  "Kitten Situation - Found kittens": "kitten_rescue",
  "kitten_rescue": "kitten_rescue",
  "Medical Concern - Cat appears injured or sick": "medical_concern",
  "medical_concern": "medical_concern",
  "Wellness Check - Already fixed cat needs medical care": "wellness_check",
  "wellness_check": "wellness_check",
};

const OWNERSHIP_MAP: Record<string, string> = {
  pet_spay_neuter: "my_cat",
  wellness_check: "my_cat",
  colony_tnr: "community_colony",
  single_stray: "unknown_stray",
  kitten_rescue: "unknown_stray",
  medical_concern: "unknown_stray",
};

const HANDLEABILITY_MAP: Record<string, string> = {
  "friendly_carrier": "friendly_carrier",
  "shy_handleable": "shy_handleable",
  "feral_trap": "unhandleable_trap",
  "some_friendly": "some_friendly",
  "all_feral": "all_unhandleable",
  "unknown": "unknown",
  // Jotform labels (in case Zapier passes them through)
  "Friendly - can use a carrier": "friendly_carrier",
  "Shy but handleable": "shy_handleable",
  "Feral - will need a trap": "unhandleable_trap",
  "Some are friendly, some feral": "some_friendly",
  "All are feral (need traps)": "all_unhandleable",
  "Unknown / Haven't tried": "unknown",
};

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

/** Fetch pending records from Airtable */
async function fetchPendingRecords(): Promise<AirtableRecord[]> {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`);
  url.searchParams.set("filterByFormula", '{Sync Status} = "pending"');
  url.searchParams.set("maxRecords", "50");
  url.searchParams.set("sort[0][field]", "Submitted At");
  url.searchParams.set("sort[0][direction]", "asc");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });

  if (!response.ok) {
    throw new Error(`Airtable fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.records || [];
}

/** Mark a record as synced (or errored) in Airtable */
async function updateAirtableRecord(
  recordId: string,
  status: "synced" | "error",
  atlasSubmissionId?: string,
  error?: string
): Promise<void> {
  const fields: Record<string, unknown> = {
    "Sync Status": status,
    "Synced At": new Date().toISOString(),
  };
  if (atlasSubmissionId) fields["Atlas Submission ID"] = atlasSubmissionId;
  if (error) fields["Sync Error"] = error.substring(0, 500);

  await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
}

/** Map an Airtable record to Atlas intake_submissions columns */
function mapRecord(f: Record<string, unknown>) {
  const str = (key: string) => (typeof f[key] === "string" ? (f[key] as string).trim() : null) || null;
  const num = (key: string) => (typeof f[key] === "number" ? f[key] as number : null);
  const bool = (key: string) => {
    const v = f[key];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v.toLowerCase() === "yes" || v === "true" || v === "1";
    return false;
  };

  const callTypeRaw = str("Call Type") || "";
  const callType = CALL_TYPE_MAP[callTypeRaw] || "info_only";
  const ownership = OWNERSHIP_MAP[callType] || "unknown_stray";
  const handleabilityRaw = str("Handleability") || "";
  const handleability = HANDLEABILITY_MAP[handleabilityRaw] || handleabilityRaw || null;

  // Fixed status: DB constraint requires lowercase ('none_fixed', 'some_fixed', etc.)
  const FIXED_STATUS_MAP: Record<string, string> = {
    "none_fixed": "none_fixed", "some_fixed": "some_fixed", "most_fixed": "most_fixed",
    "all_fixed": "all_fixed", "unknown": "unknown",
    "None are fixed": "none_fixed", "Some are fixed": "some_fixed",
    "All are fixed": "all_fixed", "Unknown": "unknown",
  };
  const fixedStatusRaw = str("Fixed Status") || "";
  const fixedStatus = FIXED_STATUS_MAP[fixedStatusRaw] || fixedStatusRaw?.toLowerCase() || null;

  // Feeding: DB may have constraint too
  const FEEDING_MAP: Record<string, string> = {
    "caller_feeds_daily": "caller_feeds_daily", "caller_feeds_sometimes": "caller_feeds_sometimes",
    "someone_else_feeds": "someone_else_feeds", "no_feeding": "no_feeding", "unknown": "unknown",
    "I feed them daily": "caller_feeds_daily", "I feed them sometimes": "caller_feeds_sometimes",
    "Someone else feeds them": "someone_else_feeds", "No regular feeding": "no_feeding", "Unknown": "unknown",
  };
  const feedingRaw = str("Feeding Situation") || "";
  const feedingSituation = FEEDING_MAP[feedingRaw] || feedingRaw || null;

  // Mom present: lowercase
  const MOM_MAP: Record<string, string> = {
    "yes": "yes", "no": "no", "unsure": "unsure",
    "Yes": "yes", "No": "no", "Unsure": "unsure",
  };
  const momRaw = str("Mom Present") || "";
  const momPresent = MOM_MAP[momRaw] || momRaw?.toLowerCase() || null;

  // Property owner: lowercase
  const isPropertyOwnerRaw = str("Is Property Owner") || "";
  const isPropertyOwner = isPropertyOwnerRaw ? isPropertyOwnerRaw.toLowerCase().replace("unsure", "unsure") : null;

  // Property access: lowercase + map
  const ACCESS_MAP: Record<string, string> = {
    "yes": "yes", "no": "no", "need_permission": "need_permission",
    "Yes": "yes", "No": "no", "Need permission first": "need_permission",
  };
  const accessRaw = str("Has Property Access") || "";
  const hasPropertyAccess = ACCESS_MAP[accessRaw] || accessRaw?.toLowerCase() || null;

  // Address: use Street Address, or fall back to Requester Address if same-as-requester
  const sameAsRequester = str("Same As Requester")?.includes("Yes") || false;
  const catsAddress = str("Street Address") || (sameAsRequester ? str("Requester Address") : null);
  const catsCity = str("City") || (sameAsRequester ? str("Requester City") : null);
  const catsZip = str("ZIP") || (sameAsRequester ? str("Requester ZIP") : null);

  return {
    source_raw_id: str("Jotform Submission ID"),
    first_name: str("First Name"),
    last_name: str("Last Name"),
    email: str("Email"),
    phone: str("Phone"),
    requester_address: str("Requester Address"),
    requester_city: str("Requester City"),
    requester_zip: str("Requester ZIP"),
    cats_at_requester_address: sameAsRequester,
    is_third_party_report: bool("Is Third Party Report"),
    third_party_relationship: str("Third Party Relationship"),
    property_owner_name: str("Property Owner Name"),
    property_owner_phone: str("Property Owner Phone"),
    property_owner_email: str("Property Owner Email"),
    cats_address: catsAddress,
    cats_city: catsCity,
    cats_zip: catsZip,
    county: str("County"),
    ownership_status: ownership,
    call_type: callType,
    cat_name: str("Cat Name"),
    cat_count: num("Cat Count"),
    cat_description: str("Cat Description"),
    handleability,
    fixed_status: fixedStatus,
    peak_count: num("Peak Count"),
    eartip_count: num("Eartip Count"),
    feeding_situation: feedingSituation,
    has_kittens: bool("Has Kittens"),
    kitten_count: num("Kitten Count"),
    kitten_age: str("Kitten Age"),
    kitten_behavior: str("Kitten Socialization"),
    mom_present: momPresent,
    has_medical_concerns: bool("Has Medical Concerns"),
    medical_description: str("Medical Description"),
    is_emergency: bool("Is Emergency"),
    is_property_owner: isPropertyOwner,
    has_property_access: hasPropertyAccess,
    notes: str("Notes"),
    referral_source: str("Referral Source"),
  };
}

export async function POST(request: NextRequest) {
  // Verify auth
  const authHeader = request.headers.get("authorization");
  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return apiUnauthorized("Unauthorized");
  }

  if (!AIRTABLE_PAT) {
    return apiServerError("AIRTABLE_PAT not configured");
  }

  try {
    // Pull all pending records from Airtable
    const records = await fetchPendingRecords();

    if (records.length === 0) {
      return apiSuccess({ message: "No pending records", synced: 0, errors: 0 });
    }

    let synced = 0;
    let errors = 0;
    const results: Array<{ airtable_id: string; status: string; submission_id?: string; error?: string }> = [];

    for (const record of records) {
      try {
        const m = mapRecord(record.fields);

        // Validate minimum required fields
        if (!m.first_name || !m.last_name) {
          await updateAirtableRecord(record.id, "error", undefined, "Missing first/last name");
          errors++;
          results.push({ airtable_id: record.id, status: "error", error: "Missing name" });
          continue;
        }

        if (!m.email && !m.phone) {
          await updateAirtableRecord(record.id, "error", undefined, "Missing email and phone");
          errors++;
          results.push({ airtable_id: record.id, status: "error", error: "Missing contact" });
          continue;
        }

        // Dedup by Jotform submission ID stored in custom_fields
        // (source_raw_id is UUID type — Jotform IDs are numeric, so we use custom_fields)
        if (m.source_raw_id) {
          const existing = await queryOne<{ submission_id: string }>(
            `SELECT submission_id FROM ops.intake_submissions
             WHERE custom_fields->>'jotform_submission_id' = $1 LIMIT 1`,
            [m.source_raw_id]
          );
          if (existing) {
            await updateAirtableRecord(record.id, "synced", existing.submission_id);
            synced++;
            results.push({ airtable_id: record.id, status: "duplicate", submission_id: existing.submission_id });
            continue;
          }

          // Also dedup by email + name within 30 minutes
          if (m.email) {
            const recentDup = await queryOne<{ submission_id: string }>(
              `SELECT submission_id FROM ops.intake_submissions
               WHERE LOWER(email) = LOWER($1) AND LOWER(first_name) = LOWER($2)
               AND submitted_at > NOW() - INTERVAL '30 minutes' LIMIT 1`,
              [m.email, m.first_name]
            );
            if (recentDup) {
              await updateAirtableRecord(record.id, "synced", recentDup.submission_id);
              synced++;
              results.push({ airtable_id: record.id, status: "duplicate", submission_id: recentDup.submission_id });
              continue;
            }
          }
        }

        // Build custom_fields JSON with Jotform tracking
        const customFields = JSON.stringify({
          jotform_submission_id: m.source_raw_id,
          source: "jotform_airtable_sync",
        });

        // Insert into Atlas
        const result = await queryOne<{ submission_id: string; triage_category: string }>(
          `INSERT INTO ops.intake_submissions (
            intake_source, source_system,
            first_name, last_name, email, phone,
            requester_address, requester_city, requester_zip,
            cats_at_requester_address,
            is_third_party_report, third_party_relationship,
            property_owner_name, property_owner_phone, property_owner_email,
            cats_address, cats_city, cats_zip, county,
            ownership_status, call_type,
            cat_name, cat_count_estimate, cat_description,
            handleability, fixed_status, peak_count, eartip_count_observed,
            feeding_situation,
            has_kittens, kitten_count, kitten_age_estimate, kitten_behavior,
            mom_present,
            has_medical_concerns, medical_description, is_emergency,
            is_property_owner, has_property_access,
            situation_description, referral_source,
            custom_fields
          ) VALUES (
            'jotform', 'jotform_airtable_sync',
            $1, $2, $3, $4,
            $5, $6, $7,
            $8,
            $9, $10,
            $11, $12, $13,
            $14, $15, $16, $17,
            $18, $19,
            $20, $21, $22,
            $23, $24, $25, $26,
            $27,
            $28, $29, $30, $31,
            $32,
            $33, $34, $35,
            $36, $37,
            $38, $39,
            $40::JSONB
          )
          RETURNING submission_id, triage_category::TEXT`,
          [
            m.first_name,               // $1
            m.last_name,                // $2
            m.email,                    // $3
            m.phone,                    // $4
            m.requester_address,        // $5
            m.requester_city,           // $6
            m.requester_zip,            // $7
            m.cats_at_requester_address, // $8
            m.is_third_party_report,    // $9
            m.third_party_relationship, // $10
            m.property_owner_name,      // $11
            m.property_owner_phone,     // $12
            m.property_owner_email,     // $13
            m.cats_address,             // $14
            m.cats_city,                // $15
            m.cats_zip,                 // $16
            m.county,                   // $17
            m.ownership_status,         // $18
            m.call_type,                // $19
            m.cat_name,                 // $20
            m.cat_count,                // $21
            m.cat_description,          // $22
            m.handleability,            // $23
            m.fixed_status,             // $24
            m.peak_count,               // $25
            m.eartip_count,             // $26
            m.feeding_situation,        // $27
            m.has_kittens,              // $28
            m.kitten_count,             // $29
            m.kitten_age,               // $30
            m.kitten_behavior,          // $31
            m.mom_present,              // $32
            m.has_medical_concerns,     // $33
            m.medical_description,      // $34
            m.is_emergency,             // $35
            m.is_property_owner,        // $36
            m.has_property_access,      // $37
            m.notes,                    // $38
            m.referral_source,          // $39
            customFields,              // $40
          ]
        );

        if (!result) {
          await updateAirtableRecord(record.id, "error", undefined, "Insert returned null");
          errors++;
          results.push({ airtable_id: record.id, status: "error", error: "Insert failed" });
          continue;
        }

        // Async: person matching + place linking
        queryOne("SELECT sot.match_intake_to_person($1)", [result.submission_id])
          .catch((err) => console.error(`[AIRTABLE-SYNC] Person match error for ${result.submission_id}:`, err));
        queryOne("SELECT sot.link_intake_to_place($1)", [result.submission_id])
          .catch((err) => console.error(`[AIRTABLE-SYNC] Place link error for ${result.submission_id}:`, err));

        // Mark synced in Airtable
        await updateAirtableRecord(record.id, "synced", result.submission_id);
        synced++;
        results.push({
          airtable_id: record.id,
          status: "synced",
          submission_id: result.submission_id,
        });

        console.log(
          `[AIRTABLE-SYNC] Synced: ${m.first_name} ${m.last_name} (${m.call_type}) → ${result.submission_id}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[AIRTABLE-SYNC] Error syncing record ${record.id}:`, msg);
        await updateAirtableRecord(record.id, "error", undefined, msg).catch(() => {});
        errors++;
        results.push({ airtable_id: record.id, status: "error", error: msg });
      }
    }

    console.log(`[AIRTABLE-SYNC] Complete: ${synced} synced, ${errors} errors out of ${records.length} records`);

    return apiSuccess({
      message: `Processed ${records.length} records`,
      synced,
      errors,
      results,
    });
  } catch (error) {
    console.error("[AIRTABLE-SYNC] Fatal error:", error);
    return apiServerError("Sync failed");
  }
}

// Health check
export async function GET() {
  return apiSuccess({
    endpoint: "airtable-submission",
    description: "Pulls pending Jotform submissions from Airtable and syncs to Atlas intake queue",
    pipeline: "Jotform → Zapier → Airtable → THIS → ops.intake_submissions",
    airtable_base: AIRTABLE_BASE_ID,
    airtable_table: AIRTABLE_TABLE_ID,
    auth: "Bearer token via Authorization header",
  });
}
