import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import {
  apiSuccess,
  apiUnauthorized,
  apiServerError,
  apiBadRequest,
} from "@/lib/api-response";

/**
 * Airtable → Atlas Config-Based Sync Webhook
 *
 * Pipeline: Jotform → Zapier → Airtable → (automation) → THIS endpoint → Atlas
 *
 * Query param `config` determines which Airtable table and processing logic to use.
 *
 * Supported configs:
 *   - trapper-agreement: Community trapper contracts (tblij32JMR7JQXAe3)
 *
 * Auth: Bearer token matching WEBHOOK_SECRET env var.
 */

export const maxDuration = 60;

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.CRON_SECRET;
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_ATLAS_SYNC_BASE_ID || "appwFuRddph1krmcd";

// Table IDs per config
const CONFIG_TABLES: Record<string, string> = {
  "trapper-agreement": process.env.AIRTABLE_TRAPPER_AGREEMENT_TABLE_ID || "tblij32JMR7JQXAe3",
};

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

async function fetchPendingRecords(tableId: string): Promise<AirtableRecord[]> {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`);
  url.searchParams.set("filterByFormula", '{Sync Status} = "pending"');
  url.searchParams.set("maxRecords", "50");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });

  if (!response.ok) {
    throw new Error(`Airtable fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.records || [];
}

async function updateAirtableRecord(
  tableId: string,
  recordId: string,
  status: "synced" | "error",
  details?: string
): Promise<void> {
  const fields: Record<string, unknown> = {
    "Sync Status": status,
    "Synced At": new Date().toISOString(),
  };
  if (details) fields["Sync Notes"] = details.substring(0, 500);

  await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
}

async function processTrapperAgreement(record: AirtableRecord, tableId: string) {
  const f = record.fields;
  const str = (key: string) => (typeof f[key] === "string" ? (f[key] as string).trim() : null) || null;

  const firstName = str("First Name");
  const lastName = str("Last Name");
  const email = str("Email")?.toLowerCase() || null;
  const phone = str("Phone");
  const address = str("Address");
  const availability = str("Availability");
  const signature = str("Signature") || str("E-Signature");
  const submissionId = str("Jotform Submission ID") || str("Submission ID");

  if (!firstName || !lastName) {
    await updateAirtableRecord(tableId, record.id, "error", "Missing first/last name");
    return { status: "error" as const, error: "Missing name" };
  }

  if (!email && !phone) {
    await updateAirtableRecord(tableId, record.id, "error", "Missing email and phone");
    return { status: "error" as const, error: "Missing contact info" };
  }

  // Resolve identity
  const identityResult = await queryOne<{ person_id: string; match_type: string }>(
    `SELECT * FROM sot.data_engine_resolve_identity($1, $2, $3, $4, $5, $6)`,
    [email, phone, firstName, lastName, address, "jotform"]
  );

  if (!identityResult) {
    await updateAirtableRecord(tableId, record.id, "error", "Identity resolution failed");
    return { status: "error" as const, error: "Identity resolution failed" };
  }

  const personId = identityResult.person_id;

  // Add trapper role (idempotent)
  await queryOne(
    `INSERT INTO sot.person_roles (person_id, role, source_system)
     VALUES ($1, 'trapper', 'web_intake')
     ON CONFLICT DO NOTHING`,
    [personId]
  );

  // Create/update trapper profile
  const hasSigned = !!signature;
  const profileNotes = availability ? `Availability: ${availability}` : null;

  await queryOne(
    `INSERT INTO sot.trapper_profiles (
       person_id, trapper_type, is_active,
       has_signed_contract, contract_signed_date,
       notes, source_system
     ) VALUES (
       $1, 'community_trapper', true,
       $2, $3,
       $4, 'web_intake'
     )
     ON CONFLICT (person_id) DO UPDATE SET
       has_signed_contract = EXCLUDED.has_signed_contract OR sot.trapper_profiles.has_signed_contract,
       contract_signed_date = COALESCE(EXCLUDED.contract_signed_date, sot.trapper_profiles.contract_signed_date),
       notes = CASE
         WHEN sot.trapper_profiles.notes IS NULL THEN EXCLUDED.notes
         WHEN EXCLUDED.notes IS NULL THEN sot.trapper_profiles.notes
         ELSE sot.trapper_profiles.notes || E'\n[Agreement Sync] ' || EXCLUDED.notes
       END,
       updated_at = NOW()`,
    [
      personId,
      hasSigned,
      hasSigned ? new Date().toISOString().slice(0, 10) : null,
      profileNotes,
    ]
  );

  // Audit trail
  await queryOne(
    `INSERT INTO sot.entity_edits (
       entity_type, entity_id, edit_type, field_name,
       new_value, edit_source, reason
     ) VALUES (
       'person', $1, 'create', 'trapper_onboarding',
       $2, 'airtable-trapper-sync',
       'Community trapper agreement synced from Airtable'
     )`,
    [
      personId,
      JSON.stringify({
        airtable_record_id: record.id,
        jotform_submission_id: submissionId,
        email,
        match_type: identityResult.match_type,
        has_signature: hasSigned,
        availability: availability || null,
      }),
    ]
  );

  await updateAirtableRecord(tableId, record.id, "synced", `person_id=${personId}`);

  console.log(
    `[AIRTABLE-SYNC:trapper] ${firstName} ${lastName} → person=${personId} (${identityResult.match_type}, signed=${hasSigned})`
  );

  return { status: "synced" as const, person_id: personId, match_type: identityResult.match_type };
}

export async function POST(request: NextRequest) {
  // Auth
  const authHeader = request.headers.get("authorization");
  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return apiUnauthorized("Unauthorized");
  }

  if (!AIRTABLE_PAT) {
    return apiServerError("AIRTABLE_PAT not configured");
  }

  // Determine config
  const { searchParams } = new URL(request.url);
  const config = searchParams.get("config");

  if (!config || !CONFIG_TABLES[config]) {
    return apiBadRequest(`Unknown or missing config. Supported: ${Object.keys(CONFIG_TABLES).join(", ")}`);
  }

  const tableId = CONFIG_TABLES[config];

  try {
    const records = await fetchPendingRecords(tableId);

    if (records.length === 0) {
      return apiSuccess({ message: "No pending records", config, synced: 0, errors: 0 });
    }

    let synced = 0;
    let errors = 0;
    const results: Array<{ airtable_id: string; status: string; person_id?: string; error?: string }> = [];

    for (const record of records) {
      try {
        let result;
        if (config === "trapper-agreement") {
          result = await processTrapperAgreement(record, tableId);
        } else {
          result = { status: "error" as const, error: "No handler for config" };
        }

        if (result.status === "synced") {
          synced++;
          results.push({ airtable_id: record.id, status: "synced", person_id: result.person_id });
        } else {
          errors++;
          results.push({ airtable_id: record.id, status: "error", error: result.error });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[AIRTABLE-SYNC:${config}] Error on record ${record.id}:`, msg);
        await updateAirtableRecord(tableId, record.id, "error", msg).catch(() => {});
        errors++;
        results.push({ airtable_id: record.id, status: "error", error: msg });
      }
    }

    console.log(`[AIRTABLE-SYNC:${config}] Done: ${synced} synced, ${errors} errors / ${records.length} total`);

    return apiSuccess({ config, synced, errors, total: records.length, results });
  } catch (error) {
    console.error(`[AIRTABLE-SYNC:${config}] Fatal:`, error);
    return apiServerError("Sync failed");
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const config = searchParams.get("config");

  return apiSuccess({
    endpoint: "airtable-sync",
    config: config || "(none specified)",
    supported_configs: Object.keys(CONFIG_TABLES),
    description: "Config-driven Airtable → Atlas sync. Each config pulls from a different table with different processing logic.",
    auth: "Bearer token via Authorization header",
  });
}
