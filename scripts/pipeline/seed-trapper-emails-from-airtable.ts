#!/usr/bin/env npx tsx
/**
 * One-time seed: backfill missing trapper emails from Airtable.
 *
 * NOT an ongoing sync. Airtable is a starting point that will go stale.
 * Confidence 0.6 so it gets outranked by VolunteerHub (0.7) or Atlas UI (0.9).
 *
 * Also produces a discrepancy report for emails that differ between systems.
 *
 * FFS-1428
 *
 * Usage:
 *   source apps/web/.env.local && npx tsx scripts/pipeline/seed-trapper-emails-from-airtable.ts [--dry-run]
 */

import { Pool, QueryResultRow } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appl6zLrRFDvsz0dh";
const AIRTABLE_TRAPPERS_TABLE_ID = process.env.AIRTABLE_TRAPPERS_TABLE_ID || "tblmPBnkrsfqtnsvD";

if (!DATABASE_URL || !AIRTABLE_PAT) {
  console.error("Required: DATABASE_URL and AIRTABLE_PAT env vars");
  console.error("Run: source apps/web/.env.local first");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");

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

async function queryOne<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

async function execute(sql: string, params: unknown[] = []): Promise<number> {
  const client = await pool.connect();
  try {
    return (await client.query(sql, params)).rowCount || 0;
  } finally {
    client.release();
  }
}

// ============================================================================
// Airtable fetch
// ============================================================================

interface AirtableTrapper {
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

    if (!res.ok) {
      throw new Error(`Airtable API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    for (const record of data.records || []) {
      const name = record.fields?.Name?.trim();
      const email = record.fields?.Email?.trim() || null;
      if (name && name !== "Client Trapping") {
        trappers.push({ name, email });
      }
    }

    offset = data.offset;
  } while (offset);

  return trappers;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("Trapper Email Seed from Airtable (one-time)");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log("");

  // Fetch Airtable trappers
  console.log("Fetching Airtable trappers...");
  const atTrappers = await fetchAirtableTrappers();
  console.log(`  ${atTrappers.length} trappers found`);
  console.log(`  ${atTrappers.filter((t) => t.email).length} with email`);

  // Get Atlas active trappers
  console.log("\nFetching Atlas active trappers...");
  const atlasTrappers = await query<{
    person_id: string;
    display_name: string;
    trapper_type: string;
    emails: string[];
  }>(`
    SELECT tp.person_id, p.display_name, tp.trapper_type,
           COALESCE(
             ARRAY_AGG(pi.id_value_raw) FILTER (WHERE pi.id_type = 'email'),
             '{}'
           ) AS emails
    FROM sot.trapper_profiles tp
    JOIN sot.people p ON p.person_id = tp.person_id AND p.merged_into_person_id IS NULL
    LEFT JOIN sot.person_identifiers pi ON pi.person_id = tp.person_id AND pi.id_type = 'email'
    WHERE tp.is_active = TRUE
    GROUP BY tp.person_id, p.display_name, tp.trapper_type
    ORDER BY p.display_name
  `);
  console.log(`  ${atlasTrappers.length} active trappers`);

  // Match by name (case-insensitive)
  const atlasMap = new Map(atlasTrappers.map((t) => [t.display_name.toLowerCase().trim(), t]));

  const stats = { seeded: 0, discrepancies: 0, alreadyHas: 0, noMatch: 0, noEmail: 0 };
  const discrepancies: { name: string; airtableEmail: string; atlasEmails: string[] }[] = [];
  const seeded: { name: string; email: string }[] = [];
  const noMatch: string[] = [];

  for (const at of atTrappers) {
    if (!at.email) {
      stats.noEmail++;
      continue;
    }

    const atlas = atlasMap.get(at.name.toLowerCase().trim());
    if (!atlas) {
      stats.noMatch++;
      noMatch.push(at.name);
      continue;
    }

    const atlasEmailsLower = atlas.emails.map((e) => e.toLowerCase());
    const atEmailLower = at.email.toLowerCase();

    if (atlasEmailsLower.includes(atEmailLower)) {
      // Atlas already has this exact email
      stats.alreadyHas++;
      continue;
    }

    if (atlas.emails.length === 0) {
      // Atlas has NO email — seed it
      if (!dryRun) {
        await execute(
          `INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
           VALUES ($1, 'email', $2, LOWER($2), 0.6, 'airtable')
           ON CONFLICT (id_type, id_value_norm) DO NOTHING`,
          [atlas.person_id, at.email]
        );
      }
      stats.seeded++;
      seeded.push({ name: at.name, email: at.email });
    } else {
      // Atlas has a DIFFERENT email — flag as discrepancy
      stats.discrepancies++;
      discrepancies.push({
        name: at.name,
        airtableEmail: at.email,
        atlasEmails: atlas.emails,
      });
    }
  }

  // Results
  console.log("\n" + "=".repeat(60));
  console.log("Results");
  console.log("=".repeat(60));
  console.log(`  Already has email:  ${stats.alreadyHas}`);
  console.log(`  Seeded (new):       ${stats.seeded}`);
  console.log(`  Discrepancies:      ${stats.discrepancies}`);
  console.log(`  No match in Atlas:  ${stats.noMatch}`);
  console.log(`  No email in AT:     ${stats.noEmail}`);

  if (seeded.length > 0) {
    console.log("\n--- Seeded Emails ---");
    for (const s of seeded) {
      console.log(`  ${s.name}: ${s.email}`);
    }
  }

  if (discrepancies.length > 0) {
    console.log("\n--- Email Discrepancies (review needed) ---");
    for (const d of discrepancies) {
      console.log(`  ${d.name}:`);
      console.log(`    Airtable: ${d.airtableEmail}`);
      console.log(`    Atlas:    ${d.atlasEmails.join(", ")}`);
    }
  }

  if (noMatch.length > 0) {
    console.log("\n--- In Airtable but no active Atlas trapper profile ---");
    for (const n of noMatch) {
      console.log(`  ${n}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
