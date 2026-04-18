#!/usr/bin/env npx tsx
/**
 * Run CDS-AI classification + matching on clinic dates.
 *
 * Wraps the Next.js CDS-AI pipeline via tsx with tsconfig paths.
 *
 * Usage:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/run-cds-ai.ts 2026-03-23
 *
 * Requires: DATABASE_URL, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import Anthropic from "@anthropic-ai/sdk";
import { Pool } from "pg";

// ── DB ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: 5,
});

async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

// ── Classify prompt (same as cds-ai.ts) ─────────────────────

const CLASSIFY_PROMPT = `You are analyzing photos from a cat spay/neuter clinic (FFSC — Forgotten Felines of Sonoma County).

Classify this image into EXACTLY ONE category:

1. "cat_photo" — A cat visible in a trap, cage, carrier, or on a scale.
2. "waiver_photo" — A paper form/waiver. Usually has a green header with "FFSC" or "Forgotten Felines". Has structured fields like clinic number, owner name, description. The clinic number is a large bold number in the top-right area.
3. "microchip_barcode" — A PetLink or other microchip label/barcode/sticker, often showing a 15-digit number. Sometimes affixed to a waiver form — if so, classify as "waiver_photo" since it contains both.
4. "discard" — Blurry, accidental photo, floor/ceiling shot, completely dark, motion blur, hands only, or otherwise unusable.

If this is a "waiver_photo", also extract ALL visible structured fields from the form into JSON:
{
  "clinic_number": <integer or null>,
  "date": "<date string as written on form>",
  "owner_last_name": "<string or null>",
  "owner_first_name": "<string or null>",
  "owner_address": "<string or null>",
  "owner_phone": "<string or null>",
  "cat_name": "<string or null>",
  "description": "<breed and color>",
  "sex": "<'M' or 'F' or null>",
  "weight_lbs": <number or null>,
  "microchip_number": "<15-digit string or null>",
  "microchip_last4": "<last 4 digits if visible>",
  "spay_or_neuter": "<'spay' or 'neuter' or null>",
  "ear_tip": "<'left' or 'right' or 'both' or null>",
  "felv_fiv_test": "<'positive' or 'negative' or 'not_tested' or null>",
  "vaccines_given": ["<list of vaccine names>"],
  "procedures": ["<list of procedures>"],
  "medical_notes": "<any freeform notes visible>",
  "vet_initials": "<string or null>"
}

If this is a "microchip_barcode", extract:
{ "microchip_number": "<15-digit string>", "microchip_last4": "<last 4 digits>" }

Respond with ONLY valid JSON, no markdown:
{ "role": "<cat_photo|waiver_photo|microchip_barcode|discard>", "confidence": <0.0-1.0>, "extracted_data": {<fields if waiver or barcode>} }`;

// ── Classify stage ──────────────────────────────────────────

async function classifySegments(client: Anthropic, date: string): Promise<{ apiCalls: number; errors: number }> {
  const segments = await queryRows<{
    segment_id: string;
    storage_path: string | null;
    original_filename: string | null;
    sequence_number: number;
  }>(`
    SELECT s.segment_id::text, rm.storage_path, rm.original_filename, s.sequence_number
    FROM ops.evidence_stream_segments s
    LEFT JOIN ops.request_media rm ON rm.media_id = s.source_ref_id AND s.source_kind = 'request_media'
    WHERE s.clinic_date = $1::DATE
      AND s.source_kind = 'request_media'
      AND s.segment_role IS NULL
    ORDER BY s.sequence_number
  `, [date]);

  console.log(`  ${segments.length} segments need classification`);
  let apiCalls = 0;
  let errors = 0;

  for (const seg of segments) {
    if (!seg.storage_path) {
      await queryOne(`UPDATE ops.evidence_stream_segments SET segment_role = 'discard', confidence = 0, assignment_status = 'classified', updated_at = NOW() WHERE segment_id = $1::UUID`, [seg.segment_id]);
      continue;
    }

    try {
      apiCalls++;
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "url", url: seg.storage_path } },
          { type: "text", text: CLASSIFY_PROMPT },
        ]}],
      });

      const text = response.content.find((c) => c.type === "text")?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { errors++; continue; }

      const parsed = JSON.parse(jsonMatch[0]);
      await queryOne(`
        UPDATE ops.evidence_stream_segments
        SET segment_role = $2, confidence = $3, extracted_data = $4::JSONB,
            assignment_status = 'classified', updated_at = NOW()
        WHERE segment_id = $1::UUID
      `, [seg.segment_id, parsed.role, parsed.confidence, parsed.extracted_data ? JSON.stringify(parsed.extracted_data) : null]);

      const label = parsed.role === "waiver_photo" ? `WAIVER #${parsed.extracted_data?.clinic_number || "?"}` : parsed.role.toUpperCase();
      console.log(`  [${seg.sequence_number}] ${seg.original_filename} → ${label} (${(parsed.confidence * 100).toFixed(0)}%)`);

      if (apiCalls % 10 === 0) await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      errors++;
      console.log(`  [${seg.sequence_number}] error: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { apiCalls, errors };
}

// ── Chunk stage ─────────────────────────────────────────────

async function chunkSegments(date: string): Promise<{ chunks: number; orphans: number }> {
  const classified = await queryRows<{
    segment_id: string;
    sequence_number: number;
    segment_role: string;
    extracted_data: Record<string, unknown> | null;
    chunk_id: string | null;
  }>(`
    SELECT s.segment_id::text, s.sequence_number, s.segment_role, s.extracted_data, s.chunk_id::text
    FROM ops.evidence_stream_segments s
    WHERE s.clinic_date = $1::DATE AND s.source_kind = 'request_media' AND s.segment_role IS NOT NULL
    ORDER BY s.sequence_number
  `, [date]);

  const unchunked = classified.filter((s) => !s.chunk_id && s.segment_role !== "discard");
  if (unchunked.length === 0) { console.log("  All already chunked"); return { chunks: 0, orphans: 0 }; }

  const waiverPositions: number[] = [];
  for (let i = 0; i < classified.length; i++) {
    if (classified[i].segment_role === "waiver_photo") waiverPositions.push(i);
  }

  const assigned = new Set<number>();
  let chunksCreated = 0;

  for (let w = 0; w < waiverPositions.length; w++) {
    const wIdx = waiverPositions[w];
    const chunkId = crypto.randomUUID();
    const segmentIds: string[] = [classified[wIdx].segment_id];
    assigned.add(wIdx);

    const prevWaiver = w > 0 ? waiverPositions[w - 1] : -1;
    for (let i = wIdx - 1; i > prevWaiver; i--) {
      if ((classified[i].segment_role === "cat_photo" || classified[i].segment_role === "microchip_barcode") && !assigned.has(i)) {
        segmentIds.unshift(classified[i].segment_id);
        assigned.add(i);
      }
    }
    const nextWaiver = w < waiverPositions.length - 1 ? waiverPositions[w + 1] : classified.length;
    for (let i = wIdx + 1; i < nextWaiver; i++) {
      if ((classified[i].segment_role === "cat_photo" || classified[i].segment_role === "microchip_barcode") && !assigned.has(i)) {
        segmentIds.push(classified[i].segment_id);
        assigned.add(i);
      }
    }

    await queryOne(`UPDATE ops.evidence_stream_segments SET chunk_id = $1::UUID, assignment_status = 'chunked', updated_at = NOW() WHERE segment_id = ANY($2::UUID[])`, [chunkId, segmentIds]);
    chunksCreated++;
  }

  const orphanIds = classified.filter((s, i) => !assigned.has(i) && s.segment_role === "cat_photo").map((o) => o.segment_id);
  if (orphanIds.length > 0) {
    await queryOne(`UPDATE ops.evidence_stream_segments SET assignment_status = 'ambiguous', updated_at = NOW() WHERE segment_id = ANY($1::UUID[])`, [orphanIds]);
  }

  console.log(`  ${chunksCreated} chunks created, ${orphanIds.length} orphans`);
  return { chunks: chunksCreated, orphans: orphanIds.length };
}

// ── Match stage ─────────────────────────────────────────────

async function matchChunks(date: string): Promise<{ matched: number; unmatched: number }> {
  const chunks = await queryRows<{ chunk_id: string; extracted_data: Record<string, unknown> }>(`
    SELECT s.chunk_id::text, s.extracted_data
    FROM ops.evidence_stream_segments s
    WHERE s.clinic_date = $1::DATE AND s.segment_role = 'waiver_photo'
      AND s.chunk_id IS NOT NULL AND s.matched_cat_id IS NULL
    ORDER BY s.sequence_number
  `, [date]);

  console.log(`  ${chunks.length} chunks to match`);
  let matched = 0;
  let unmatched = 0;

  for (const chunk of chunks) {
    const ed = chunk.extracted_data || {};
    const clinicNumber = (ed.clinic_number as number) ?? null;
    const chipLast4 = (ed.microchip_last4 as string) ?? null;
    const chipFull = (ed.microchip_number as string) ?? null;
    const ownerLast = (ed.owner_last_name as string) ?? null;

    let catId: string | null = null;
    let catName: string | null = null;
    let matchedVia: string | null = null;

    // Path A: clinic_number → appointment → cat
    if (clinicNumber) {
      const r = await queryOne<{ cat_id: string; cat_name: string }>(`
        SELECT a.cat_id::text, c.name AS cat_name FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id
        WHERE a.appointment_date = $1::DATE AND a.clinic_day_number = $2
          AND a.merged_into_appointment_id IS NULL AND a.cat_id IS NOT NULL LIMIT 1
      `, [date, clinicNumber]);
      if (r) { catId = r.cat_id; catName = r.cat_name; matchedVia = "clinic_number"; }
    }

    if (clinicNumber && !catId) {
      const entry = await queryOne<{ cat_id: string | null; cat_name: string | null }>(`
        SELECT a.cat_id::text, c.name AS cat_name FROM ops.clinic_day_entries e
        JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
        LEFT JOIN ops.appointments a ON a.appointment_id = e.matched_appointment_id AND a.merged_into_appointment_id IS NULL
        LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
        WHERE cd.clinic_date = $1::DATE AND e.line_number = $2 LIMIT 1
      `, [date, clinicNumber]);
      if (entry?.cat_id) { catId = entry.cat_id; catName = entry.cat_name; matchedVia = "clinic_number_via_entry"; }
    }

    // Path B: chip
    if (!catId && (chipFull || chipLast4)) {
      const q = chipFull
        ? `SELECT ci.cat_id::text, c.name AS cat_name FROM sot.cat_identifiers ci JOIN sot.cats c ON c.cat_id = ci.cat_id WHERE ci.id_type = 'microchip' AND ci.id_value = $1 LIMIT 1`
        : `SELECT ci.cat_id::text, c.name AS cat_name FROM sot.cat_identifiers ci JOIN sot.cats c ON c.cat_id = ci.cat_id JOIN ops.appointments a ON a.cat_id = ci.cat_id WHERE ci.id_type = 'microchip' AND RIGHT(ci.id_value, 4) = $1 AND a.appointment_date = $2::DATE AND a.merged_into_appointment_id IS NULL LIMIT 1`;
      const r = await queryOne<{ cat_id: string; cat_name: string }>(q, chipFull ? [chipFull] : [chipLast4, date]);
      if (r) { catId = r.cat_id; catName = r.cat_name; matchedVia = chipFull ? "chip_full" : "chip_last4"; }
    }

    // Path C: SharePoint waiver
    if (!catId && (ownerLast || chipLast4)) {
      const r = await queryOne<{ matched_cat_id: string; cat_name: string }>(`
        SELECT w.matched_cat_id::text, c.name AS cat_name FROM ops.waiver_scans w
        JOIN sot.cats c ON c.cat_id = w.matched_cat_id
        WHERE w.parsed_date = $1::DATE AND w.matched_cat_id IS NOT NULL
          AND (($2::TEXT IS NOT NULL AND w.parsed_last4_chip = $2) OR ($3::TEXT IS NOT NULL AND LOWER(w.parsed_last_name) = LOWER($3)))
        LIMIT 1
      `, [date, chipLast4, ownerLast]);
      if (r) { catId = r.matched_cat_id; catName = r.cat_name; matchedVia = "sharepoint_waiver"; }
    }

    // Path D: owner name fuzzy
    if (!catId && ownerLast) {
      const r = await queryOne<{ cat_id: string; cat_name: string }>(`
        SELECT a.cat_id::text, c.name AS cat_name FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id
        WHERE a.appointment_date = $1::DATE AND a.merged_into_appointment_id IS NULL
          AND a.cat_id IS NOT NULL AND LOWER(a.client_name) LIKE '%' || LOWER($2) || '%' LIMIT 1
      `, [date, ownerLast]);
      if (r) { catId = r.cat_id; catName = r.cat_name; matchedVia = "owner_name_roster"; }
    }

    if (catId) {
      matched++;
      await queryOne(`SELECT ops.assign_evidence_chunk_cat($1::UUID, $2::UUID, $3, $4)`, [chunk.chunk_id, catId, matchedVia, 0.9]);
      await queryOne(`UPDATE ops.request_media SET cat_id = $1::UUID, cat_identification_confidence = 'high' WHERE media_id IN (SELECT source_ref_id FROM ops.evidence_stream_segments WHERE chunk_id = $2::UUID AND source_kind = 'request_media' AND segment_role = 'cat_photo')`, [catId, chunk.chunk_id]);

      // Bridge clinic_day_number
      if (clinicNumber) {
        await queryOne(`SELECT ops.set_clinic_day_number(a.appointment_id, $2::INTEGER, 'cds_propagation'::ops.clinic_day_number_source, NULL) FROM ops.appointments a WHERE a.cat_id = $1::UUID AND a.appointment_date = $3::DATE AND a.merged_into_appointment_id IS NULL AND a.clinic_day_number IS NULL`, [catId, clinicNumber, date]).catch(() => {});
      }
      console.log(`  #${clinicNumber || "?"} → ${catName} (via ${matchedVia})`);
    } else {
      unmatched++;
      console.log(`  #${clinicNumber || "?"} ${ownerLast || "?"} — no match`);
    }
  }

  return { matched, unmatched };
}

// ── Main ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

if (dates.length === 0) {
  console.error("Usage: npx tsx scripts/run-cds-ai.ts <YYYY-MM-DD> [YYYY-MM-DD ...]");
  process.exit(1);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error("ANTHROPIC_API_KEY not set"); process.exit(1); }
const client = new Anthropic({ apiKey });

for (const date of dates) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`CDS-AI Pipeline — ${date}`);

  // Classify
  console.log("\n1. Classifying...");
  const { apiCalls, errors } = await classifySegments(client, date);
  if (apiCalls > 0) console.log(`  ${apiCalls} API calls, ${errors} errors, ~$${(apiCalls * 0.01).toFixed(2)}`);

  // Chunk
  console.log("\n2. Chunking...");
  await chunkSegments(date);

  // Match
  console.log("\n3. Matching...");
  const { matched, unmatched } = await matchChunks(date);
  console.log(`  Result: ${matched} matched, ${unmatched} unmatched`);
}

console.log("\n\nDone.");
await pool.end();
process.exit(0);
