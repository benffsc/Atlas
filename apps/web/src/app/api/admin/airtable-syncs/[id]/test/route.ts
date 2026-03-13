import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiError, apiNotFound, apiServerError } from "@/lib/api-response";
import { requireValidUUID } from "@/lib/api-validation";

interface TestConfigRow {
  config_id: string;
  name: string;
  airtable_base_id: string;
  airtable_table_name: string;
  filter_formula: string;
  page_size: number;
}

/** POST /api/admin/airtable-syncs/[id]/test — Test Airtable connection (read-only) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) return apiError("Authentication required", 401);

    const { id } = await params;
    requireValidUUID(id, "sync_config");

    const pat = process.env.AIRTABLE_PAT;
    if (!pat) {
      return apiError("AIRTABLE_PAT environment variable is not configured", 503);
    }

    const config = await queryOne<TestConfigRow>(
      `SELECT config_id, name, airtable_base_id, airtable_table_name,
              filter_formula, page_size
       FROM ops.airtable_sync_configs
       WHERE config_id = $1`,
      [id]
    );

    if (!config) return apiNotFound("Sync config", id);

    // Fetch first page from Airtable (read-only, no processing)
    const url = new URL(
      `https://api.airtable.com/v0/${config.airtable_base_id}/${encodeURIComponent(config.airtable_table_name)}`
    );
    url.searchParams.set("filterByFormula", config.filter_formula);
    url.searchParams.set("pageSize", String(Math.min(config.page_size, 10)));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();

    if (data.error) {
      return apiError(
        `Airtable API error: ${data.error.type || "unknown"} — ${data.error.message || JSON.stringify(data.error)}`,
        422
      );
    }

    const records = data.records || [];

    // Extract all field names from returned records
    const fieldNames = new Set<string>();
    for (const record of records) {
      if (record.fields) {
        for (const key of Object.keys(record.fields)) {
          fieldNames.add(key);
        }
      }
    }

    return apiSuccess({
      connection: "ok",
      config_name: config.name,
      base_id: config.airtable_base_id,
      table_name: config.airtable_table_name,
      records_found: records.length,
      has_more: !!data.offset,
      field_names: Array.from(fieldNames).sort(),
      sample_record: records[0]?.fields || null,
    });
  } catch (error) {
    console.error("[ADMIN] Error testing sync connection:", error);
    return apiServerError("Failed to test Airtable connection");
  }
}
