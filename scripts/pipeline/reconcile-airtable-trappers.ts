#!/usr/bin/env npx tsx
/**
 * One-time reconciliation: Airtable trappers vs Atlas trapper_profiles.
 *
 * Produces a report of:
 * - Matched + active in both (good)
 * - In Airtable but inactive in Atlas (Ben needs to decide)
 * - In Airtable but no Atlas trapper profile (missing)
 * - Duplicates in Airtable
 * - In Atlas but not in Airtable (Atlas-only)
 *
 * FFS-1431
 *
 * Usage:
 *   source apps/web/.env.local && npx tsx scripts/pipeline/reconcile-airtable-trappers.ts
 */

import { Pool, QueryResultRow } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appl6zLrRFDvsz0dh";
const AIRTABLE_TRAPPERS_TABLE_ID = process.env.AIRTABLE_TRAPPERS_TABLE_ID || "tblmPBnkrsfqtnsvD";

if (!DATABASE_URL || !AIRTABLE_PAT) {
  console.error("Required: DATABASE_URL and AIRTABLE_PAT env vars");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  max: 5,
});

async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    client.release();
  }
}

interface AirtableTrapper {
  recordId: string;
  name: string;
  email: string | null;
}

async function fetchAirtableTrappers(): Promise<AirtableTrapper[]> {
  const trappers: AirtableTrapper[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TRAPPERS_TABLE_ID}`);
    url.searchParams.set("maxRecords", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    });
    if (!res.ok) throw new Error(`Airtable API error: ${res.status}`);
    const data = await res.json();
    for (const r of data.records || []) {
      trappers.push({
        recordId: r.id,
        name: r.fields?.Name?.trim() || "",
        email: r.fields?.Email?.trim() || null,
      });
    }
    offset = data.offset;
  } while (offset);
  return trappers;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Airtable ↔ Atlas Trapper Reconciliation");
  console.log("=".repeat(60));
  console.log("");

  // Fetch both sides
  const atTrappers = await fetchAirtableTrappers();
  console.log(`Airtable: ${atTrappers.length} records`);

  const atlasTrappers = await query<{
    person_id: string;
    display_name: string;
    trapper_type: string;
    is_active: boolean;
    email: string | null;
    source_system: string;
  }>(`
    SELECT tp.person_id, p.display_name, tp.trapper_type, tp.is_active,
           sot.get_email(p.person_id) AS email, p.source_system
    FROM sot.trapper_profiles tp
    JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
    ORDER BY p.display_name
  `);
  console.log(`Atlas: ${atlasTrappers.length} trapper profiles (${atlasTrappers.filter(t => t.is_active).length} active)`);

  // Build lookup maps
  const atlasMap = new Map<string, typeof atlasTrappers[0]>();
  for (const t of atlasTrappers) {
    atlasMap.set(t.display_name.toLowerCase().trim(), t);
  }

  // Detect Airtable duplicates
  const atNameCounts = new Map<string, number>();
  for (const t of atTrappers) {
    const key = t.name.toLowerCase().trim();
    atNameCounts.set(key, (atNameCounts.get(key) || 0) + 1);
  }
  const atDuplicates = [...atNameCounts.entries()].filter(([, c]) => c > 1);

  // Categorize
  const matched: { at: AirtableTrapper; atlas: typeof atlasTrappers[0] }[] = [];
  const inactiveInAtlas: { at: AirtableTrapper; atlas: typeof atlasTrappers[0] }[] = [];
  const missingFromAtlas: AirtableTrapper[] = [];
  const placeholders: AirtableTrapper[] = [];

  const atMatchedNames = new Set<string>();

  for (const at of atTrappers) {
    if (!at.name || at.name === "Client Trapping") {
      placeholders.push(at);
      continue;
    }

    const key = at.name.toLowerCase().trim();
    const atlas = atlasMap.get(key);

    if (atlas) {
      atMatchedNames.add(key);
      if (atlas.is_active) {
        matched.push({ at, atlas });
      } else {
        inactiveInAtlas.push({ at, atlas });
      }
    } else {
      missingFromAtlas.push(at);
    }
  }

  // Atlas-only (not in Airtable)
  const atlasOnly = atlasTrappers.filter(
    t => t.is_active && !atMatchedNames.has(t.display_name.toLowerCase().trim())
  );

  // Print report
  console.log("\n" + "=".repeat(60));
  console.log("RECONCILIATION REPORT");
  console.log("=".repeat(60));

  console.log(`\n--- Matched & Active (${matched.length}) --- OK, no action needed`);
  for (const m of matched) {
    console.log(`  ${m.at.name} — ${m.atlas.trapper_type}`);
  }

  console.log(`\n--- In Airtable but INACTIVE in Atlas (${inactiveInAtlas.length}) --- NEEDS DECISION`);
  console.log("  These people are getting your email blasts but are inactive in Atlas.");
  console.log("  Decision: reactivate in Atlas, OR remove from Airtable.");
  for (const m of inactiveInAtlas) {
    console.log(`  ${m.at.name} — Atlas type: ${m.atlas.trapper_type}, email: ${m.at.email || "(none)"}`);
  }

  console.log(`\n--- In Airtable but NO Atlas trapper profile (${missingFromAtlas.length}) --- NEEDS DECISION`);
  console.log("  These may need trapper_profiles created, or they may be non-trappers.");
  for (const m of missingFromAtlas) {
    console.log(`  ${m.name} — email: ${m.email || "(none)"}`);
  }

  console.log(`\n--- Active in Atlas but NOT in Airtable (${atlasOnly.length}) ---`);
  console.log("  These are Atlas-only trappers. Airtable is stale for them (this is fine).");
  for (const t of atlasOnly) {
    console.log(`  ${t.display_name} — ${t.trapper_type}, source: ${t.source_system}`);
  }

  if (atDuplicates.length > 0) {
    console.log(`\n--- Airtable Duplicates (${atDuplicates.length}) --- CLEANUP NEEDED`);
    for (const [name, count] of atDuplicates) {
      console.log(`  "${name}" appears ${count} times`);
    }
  }

  if (placeholders.length > 0) {
    console.log(`\n--- Airtable Placeholders (${placeholders.length}) --- SKIP`);
    for (const p of placeholders) {
      console.log(`  "${p.name || "(empty)"}"`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Matched & active:           ${matched.length}`);
  console.log(`  Inactive in Atlas (decide):  ${inactiveInAtlas.length}`);
  console.log(`  Missing from Atlas (decide): ${missingFromAtlas.length}`);
  console.log(`  Atlas-only (fine):           ${atlasOnly.length}`);
  console.log(`  Airtable duplicates:         ${atDuplicates.length}`);
  console.log(`  Placeholders:                ${placeholders.length}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
