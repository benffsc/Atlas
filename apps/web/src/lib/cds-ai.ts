/**
 * CDS-AI Shared Library
 *
 * Classify photos via Claude vision, chunk by waiver boundaries,
 * match chunks to cats via 4-path fallback. Used by both the manual
 * script (scripts/cds-ai-process.ts) and the cron route.
 *
 * Linear: FFS-1219 (extract + cron), FFS-1089 (classify+chunk), FFS-1090 (match)
 */

import Anthropic from "@anthropic-ai/sdk";
import { queryOne, queryRows } from "@/lib/db";
import { randomUUID } from "crypto";
import { runWaiverAudit, type AuditSummary } from "@/lib/waiver-audit";

// ── Types ────────────────────────────────────────────────────

export interface Segment {
  segment_id: string;
  source_kind: string;
  source_ref_id: string;
  sequence_number: number;
  segment_role: string | null;
  assignment_status: string;
  storage_path: string | null;
  original_filename: string | null;
}

export interface ClassifyResult {
  role: "cat_photo" | "waiver_photo" | "microchip_barcode" | "discard" | "unknown";
  confidence: number;
  extracted_data?: Record<string, unknown>;
}

export interface Chunk {
  chunk_id: string;
  waiver_segment_id: string | null;
  segment_ids: string[];
  extracted_data: Record<string, unknown> | null;
}

export interface MatchResult {
  chunk_id: string;
  clinic_number: number | null;
  cat_id: string | null;
  cat_name: string | null;
  matched_via: string | null;
  sharepoint_cat_id: string | null;
  agreement: string;
}

export interface CdsAiRunResult {
  date: string;
  segments_total: number;
  classified: number;
  classification_errors: number;
  chunks_formed: number;
  orphan_photos: number;
  matched: number;
  unmatched: number;
  agreements: number;
  disagreements: number;
  match_results: MatchResult[];
  elapsed_ms: number;
  stopped_early: boolean;
  audit?: AuditSummary;
}

export interface CdsAiOptions {
  /** Actually write to DB (default: false = dry run) */
  apply: boolean;
  /** Stop after classification (default: false) */
  classifyOnly?: boolean;
  /** Time budget in ms — stop before this (default: no limit) */
  timeBudgetMs?: number;
  /** Log function (default: console.log) */
  log?: (msg: string) => void;
}

// ── Prompt ──────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are analyzing photos from a cat spay/neuter clinic (FFSC — Forgotten Felines of Sonoma County).

Classify this image into EXACTLY ONE category:

1. "cat_photo" — A cat visible in a trap, cage, carrier, or on a scale. May show the cat from different angles.
2. "waiver_photo" — A paper form/waiver. Usually has a green header with "FFSC" or "Forgotten Felines". Has structured fields like clinic number, owner name, description. The clinic number is a large bold number in the top-right area.
3. "microchip_barcode" — A PetLink or other microchip label/barcode/sticker, often showing a 15-digit number. Sometimes affixed to a waiver form — if so, classify as "waiver_photo" since it contains both.
4. "discard" — Blurry, accidental photo, floor/ceiling shot, completely dark, motion blur, hands only, or otherwise unusable.

If this is a "waiver_photo", also extract ALL visible structured fields from the form into JSON. Extract EVERYTHING you can read, even if partially obscured:

{
  "clinic_number": <integer or null>,
  "date": "<date string as written on form, e.g. '3/18/26' or 'March 18, 2026'>",
  "owner_last_name": "<string or null>",
  "owner_first_name": "<string or null>",
  "owner_address": "<string or null>",
  "owner_phone": "<string or null>",
  "cat_name": "<string or null>",
  "description": "<breed and color, e.g. 'DSH Grey Tabby'>",
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
{
  "microchip_number": "<15-digit string>",
  "microchip_last4": "<last 4 digits>"
}

Respond with ONLY valid JSON, no markdown:
{
  "role": "<cat_photo|waiver_photo|microchip_barcode|discard>",
  "confidence": <0.0-1.0>,
  "extracted_data": {<fields if waiver or barcode, omit for cat_photo/discard>}
}`;

// ── Load segments ───────────────────────────────────────────

export async function loadSegments(date: string): Promise<Segment[]> {
  return queryRows<Segment>(`
    SELECT
      s.segment_id::text,
      s.source_kind,
      s.source_ref_id::text,
      s.sequence_number,
      s.segment_role,
      s.assignment_status,
      rm.storage_path,
      rm.original_filename
    FROM ops.evidence_stream_segments s
    LEFT JOIN ops.request_media rm
      ON rm.media_id = s.source_ref_id AND s.source_kind = 'request_media'
    WHERE s.clinic_date = $1::DATE
      AND s.source_kind = 'request_media'
    ORDER BY s.ingest_batch_id, s.sequence_number
  `, [date]);
}

// ── Stage 1: Classify + Extract ─────────────────────────────

export async function classifySegments(
  client: Anthropic,
  segments: Segment[],
  opts: CdsAiOptions,
): Promise<{ results: Map<string, ClassifyResult>; apiCalls: number; errors: number }> {
  const log = opts.log ?? console.log;
  const results = new Map<string, ClassifyResult>();
  let apiCalls = 0;
  let errors = 0;
  const startTime = Date.now();

  const needsClassify = segments.filter((s) => !s.segment_role);

  for (const seg of needsClassify) {
    // Time budget check
    if (opts.timeBudgetMs && (Date.now() - startTime) > opts.timeBudgetMs) {
      log(`  Time budget reached after ${apiCalls} API calls. Stopping classification.`);
      break;
    }

    if (!seg.storage_path) {
      log(`  [${seg.sequence_number}] no storage path — marking discard`);
      results.set(seg.segment_id, { role: "discard", confidence: 0 });
      if (opts.apply) {
        await queryOne(`
          UPDATE ops.evidence_stream_segments
          SET segment_role = 'discard', confidence = 0,
              assignment_status = 'classified', updated_at = NOW()
          WHERE segment_id = $1::UUID
        `, [seg.segment_id]);
      }
      continue;
    }

    if (!opts.apply) {
      log(`  [${seg.sequence_number}] would classify: ${seg.original_filename}`);
      continue;
    }

    try {
      apiCalls++;
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: seg.storage_path } },
              { type: "text", text: CLASSIFY_PROMPT },
            ],
          },
        ],
      });

      const text = response.content.find((c) => c.type === "text")?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log(`  [${seg.sequence_number}] no JSON in response`);
        errors++;
        results.set(seg.segment_id, { role: "unknown", confidence: 0 });
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]) as ClassifyResult;
      results.set(seg.segment_id, parsed);

      await queryOne(`
        UPDATE ops.evidence_stream_segments
        SET
          segment_role = $2,
          confidence = $3,
          extracted_data = $4::JSONB,
          assignment_status = 'classified',
          updated_at = NOW()
        WHERE segment_id = $1::UUID
      `, [
        seg.segment_id,
        parsed.role,
        parsed.confidence,
        parsed.extracted_data ? JSON.stringify(parsed.extracted_data) : null,
      ]);

      const label = parsed.role === "waiver_photo"
        ? `WAIVER #${(parsed.extracted_data as Record<string, unknown>)?.clinic_number || "?"}`
        : parsed.role.toUpperCase();
      log(`  [${seg.sequence_number}] ${seg.original_filename} → ${label} (${(parsed.confidence * 100).toFixed(0)}%)`);

      // Rate limit: pause every 10 calls
      if (apiCalls % 10 === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      errors++;
      const detail = err instanceof Error ? err.message : String(err);
      log(`  [${seg.sequence_number}] classify error: ${detail}`);
      results.set(seg.segment_id, { role: "unknown", confidence: 0 });
    }
  }

  return { results, apiCalls, errors };
}

// ── Stage 2: Chunk ──────────────────────────────────────────

interface ClassifiedSegment {
  segment_id: string;
  sequence_number: number;
  segment_role: string;
  extracted_data: Record<string, unknown> | null;
  original_filename: string;
  chunk_id: string | null;
}

export async function chunkSegments(
  date: string,
  opts: CdsAiOptions,
): Promise<{ chunks: Chunk[]; orphanCount: number }> {
  const log = opts.log ?? console.log;

  const classified = await queryRows<ClassifiedSegment>(`
    SELECT
      s.segment_id::text,
      s.sequence_number,
      s.segment_role,
      s.extracted_data,
      rm.original_filename,
      s.chunk_id::text
    FROM ops.evidence_stream_segments s
    LEFT JOIN ops.request_media rm
      ON rm.media_id = s.source_ref_id AND s.source_kind = 'request_media'
    WHERE s.clinic_date = $1::DATE
      AND s.source_kind = 'request_media'
      AND s.segment_role IS NOT NULL
    ORDER BY s.sequence_number
  `, [date]);

  // Already chunked?
  const unchunked = classified.filter((s) => !s.chunk_id && s.segment_role !== "discard");
  if (unchunked.length === 0) {
    log("All segments already chunked.");
    // Count existing chunks
    const existing = await queryOne<{ chunk_count: number }>(`
      SELECT COUNT(DISTINCT chunk_id)::int AS chunk_count
      FROM ops.evidence_stream_segments
      WHERE clinic_date = $1::DATE AND chunk_id IS NOT NULL
    `, [date]);
    return { chunks: [], orphanCount: 0 };
  }

  // Find waiver positions
  const waiverPositions: number[] = [];
  for (let i = 0; i < classified.length; i++) {
    if (classified[i].segment_role === "waiver_photo") {
      waiverPositions.push(i);
    }
  }

  log(`Waivers: ${waiverPositions.length}, Cat photos: ${classified.filter((s) => s.segment_role === "cat_photo").length}`);

  // Build chunks: each waiver claims surrounding cat photos
  const chunks: Chunk[] = [];
  const assigned = new Set<number>();

  for (let w = 0; w < waiverPositions.length; w++) {
    const wIdx = waiverPositions[w];
    const chunkId = randomUUID();
    const segmentIds: string[] = [classified[wIdx].segment_id];
    assigned.add(wIdx);

    // Scan backward
    const prevWaiver = w > 0 ? waiverPositions[w - 1] : -1;
    for (let i = wIdx - 1; i > prevWaiver; i--) {
      if ((classified[i].segment_role === "cat_photo" || classified[i].segment_role === "microchip_barcode") && !assigned.has(i)) {
        segmentIds.unshift(classified[i].segment_id);
        assigned.add(i);
      }
    }

    // Scan forward
    const nextWaiver = w < waiverPositions.length - 1 ? waiverPositions[w + 1] : classified.length;
    for (let i = wIdx + 1; i < nextWaiver; i++) {
      if ((classified[i].segment_role === "cat_photo" || classified[i].segment_role === "microchip_barcode") && !assigned.has(i)) {
        segmentIds.push(classified[i].segment_id);
        assigned.add(i);
      }
    }

    chunks.push({
      chunk_id: chunkId,
      waiver_segment_id: classified[wIdx].segment_id,
      segment_ids: segmentIds,
      extracted_data: classified[wIdx].extracted_data,
    });
  }

  // Orphan cat photos
  const orphans = classified.filter((s, i) =>
    !assigned.has(i) && s.segment_role === "cat_photo"
  );

  log(`Chunks: ${chunks.length}, Orphans: ${orphans.length}`);

  // Write to DB
  if (opts.apply) {
    for (const chunk of chunks) {
      await queryOne(`
        UPDATE ops.evidence_stream_segments
        SET chunk_id = $1::UUID, assignment_status = 'chunked', updated_at = NOW()
        WHERE segment_id = ANY($2::UUID[])
      `, [chunk.chunk_id, chunk.segment_ids]);
    }

    if (orphans.length > 0) {
      const orphanIds = orphans.map((o) => o.segment_id);
      await queryOne(`
        UPDATE ops.evidence_stream_segments
        SET assignment_status = 'ambiguous', updated_at = NOW()
        WHERE segment_id = ANY($1::UUID[])
      `, [orphanIds]);
    }
  }

  return { chunks, orphanCount: orphans.length };
}

// ── Stage 3: Match ──────────────────────────────────────────

export async function matchChunks(
  date: string,
  opts: CdsAiOptions,
): Promise<{ matched: number; unmatched: number; results: MatchResult[] }> {
  const log = opts.log ?? console.log;

  const chunksToMatch = await queryRows<{
    chunk_id: string;
    extracted_data: Record<string, unknown>;
    segment_count: number;
  }>(`
    SELECT
      s.chunk_id::text,
      s.extracted_data,
      (SELECT COUNT(*)::INT FROM ops.evidence_stream_segments s2 WHERE s2.chunk_id = s.chunk_id) AS segment_count
    FROM ops.evidence_stream_segments s
    WHERE s.clinic_date = $1::DATE
      AND s.segment_role = 'waiver_photo'
      AND s.chunk_id IS NOT NULL
      AND s.matched_cat_id IS NULL
    ORDER BY s.sequence_number
  `, [date]);

  log(`Chunks to match: ${chunksToMatch.length}`);

  let matched = 0;
  let unmatched = 0;
  const matchResults: MatchResult[] = [];

  for (const chunk of chunksToMatch) {
    const ed = chunk.extracted_data as Record<string, unknown> | null;
    const clinicNumber = (ed?.clinic_number as number) ?? null;
    const chipLast4 = (ed?.microchip_last4 as string) ?? null;
    const chipFull = (ed?.microchip_number as string) ?? null;
    const ownerLast = (ed?.owner_last_name as string) ?? null;

    let catId: string | null = null;
    let catName: string | null = null;
    let matchedVia: string | null = null;

    // Path A: clinic_number → appointment → cat_id
    if (clinicNumber && !catId) {
      const r = await queryOne<{ cat_id: string; cat_name: string }>(`
        SELECT a.cat_id::text, c.name AS cat_name
        FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id
        WHERE a.appointment_date = $1::DATE
          AND a.clinic_day_number = $2
          AND a.merged_into_appointment_id IS NULL
          AND a.cat_id IS NOT NULL
        LIMIT 1
      `, [date, clinicNumber]);
      if (r) {
        catId = r.cat_id;
        catName = r.cat_name;
        matchedVia = "clinic_number";
      }
    }

    // Path B: chip → cat_identifiers → cat_id
    if (!catId && (chipFull || chipLast4)) {
      const chipQuery = chipFull
        ? `SELECT ci.cat_id::text, c.name AS cat_name
           FROM sot.cat_identifiers ci
           JOIN sot.cats c ON c.cat_id = ci.cat_id
           WHERE ci.id_type = 'microchip' AND ci.id_value = $1
           LIMIT 1`
        : `SELECT ci.cat_id::text, c.name AS cat_name
           FROM sot.cat_identifiers ci
           JOIN sot.cats c ON c.cat_id = ci.cat_id
           JOIN ops.appointments a ON a.cat_id = ci.cat_id
           WHERE ci.id_type = 'microchip'
             AND RIGHT(ci.id_value, 4) = $1
             AND a.appointment_date = $2::DATE
             AND a.merged_into_appointment_id IS NULL
           LIMIT 1`;
      const params = chipFull ? [chipFull] : [chipLast4, date];
      const r = await queryOne<{ cat_id: string; cat_name: string }>(chipQuery, params);
      if (r) {
        catId = r.cat_id;
        catName = r.cat_name;
        matchedVia = chipFull ? "chip_full" : "chip_last4";
      }
    }

    // Path C: SharePoint waiver pool
    if (!catId && (ownerLast || chipLast4)) {
      const r = await queryOne<{ matched_cat_id: string; cat_name: string }>(`
        SELECT w.matched_cat_id::text, c.name AS cat_name
        FROM ops.waiver_scans w
        JOIN sot.cats c ON c.cat_id = w.matched_cat_id
        WHERE w.parsed_date = $1::DATE
          AND w.matched_cat_id IS NOT NULL
          AND (
            ($2::TEXT IS NOT NULL AND w.parsed_last4_chip = $2::TEXT)
            OR ($3::TEXT IS NOT NULL AND LOWER(w.parsed_last_name) = LOWER($3::TEXT))
          )
        LIMIT 1
      `, [date, chipLast4, ownerLast]);
      if (r) {
        catId = r.matched_cat_id;
        catName = r.cat_name;
        matchedVia = "sharepoint_waiver";
      }
    }

    // Path D: owner name fuzzy match against day's roster
    if (!catId && ownerLast) {
      const r = await queryOne<{ cat_id: string; cat_name: string }>(`
        SELECT a.cat_id::text, c.name AS cat_name
        FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id
        WHERE a.appointment_date = $1::DATE
          AND a.merged_into_appointment_id IS NULL
          AND a.cat_id IS NOT NULL
          AND LOWER(a.client_name) LIKE '%' || LOWER($2) || '%'
        LIMIT 1
      `, [date, ownerLast]);
      if (r) {
        catId = r.cat_id;
        catName = r.cat_name;
        matchedVia = "owner_name_roster";
      }
    }

    // Cross-reference with SharePoint for validation
    let sharepointCatId: string | null = null;
    if (chipLast4 || ownerLast) {
      const sp = await queryOne<{ matched_cat_id: string }>(`
        SELECT w.matched_cat_id::text
        FROM ops.waiver_scans w
        WHERE w.parsed_date = $1::DATE
          AND w.matched_cat_id IS NOT NULL
          AND (
            ($2::TEXT IS NOT NULL AND w.parsed_last4_chip = $2::TEXT)
            OR ($3::TEXT IS NOT NULL AND LOWER(w.parsed_last_name) = LOWER($3::TEXT))
          )
        LIMIT 1
      `, [date, chipLast4, ownerLast]);
      sharepointCatId = sp?.matched_cat_id || null;
    }

    const agreement = !catId ? "no_match"
      : !sharepointCatId ? "no_sharepoint"
      : catId === sharepointCatId ? "AGREE"
      : "DISAGREE";

    if (catId) {
      matched++;
      if (opts.apply) {
        await queryOne(`SELECT ops.assign_evidence_chunk_cat($1::UUID, $2::UUID, $3, $4)`,
          [chunk.chunk_id, catId, matchedVia, 0.9]);

        // Write cat_id to request_media for cat_photo segments in the chunk
        await queryOne(`
          UPDATE ops.request_media
          SET cat_id = $1::UUID, cat_identification_confidence = 'high'
          WHERE media_id IN (
            SELECT source_ref_id FROM ops.evidence_stream_segments
            WHERE chunk_id = $2::UUID AND source_kind = 'request_media' AND segment_role = 'cat_photo'
          )
        `, [catId, chunk.chunk_id]);
      }
      log(`  #${clinicNumber || "?"} → ${catName} (via ${matchedVia}) [${agreement}]`);
    } else {
      unmatched++;
      log(`  #${clinicNumber || "?"} ${ownerLast || "?"} — no match`);
    }

    matchResults.push({
      chunk_id: chunk.chunk_id,
      clinic_number: clinicNumber,
      cat_id: catId,
      cat_name: catName,
      matched_via: matchedVia,
      sharepoint_cat_id: sharepointCatId,
      agreement,
    });
  }

  return { matched, unmatched, results: matchResults };
}

// ── Full pipeline ───────────────────────────────────────────

/**
 * Run the full CDS-AI pipeline for a single clinic date:
 * classify → chunk → match.
 *
 * Time-budgeted: if timeBudgetMs is set, classification stops
 * early and the date resumes on the next invocation.
 */
export async function runCdsAi(
  date: string,
  opts: CdsAiOptions,
): Promise<CdsAiRunResult> {
  const log = opts.log ?? console.log;
  const startTime = Date.now();

  log(`CDS-AI Pipeline — ${date} (${opts.apply ? "APPLY" : "DRY RUN"})`);

  // Load segments
  const segments = await loadSegments(date);
  log(`Segments: ${segments.length} photos`);

  const needsClassify = segments.filter((s) => !s.segment_role);
  const alreadyClassified = segments.filter((s) => s.segment_role);
  log(`  Already classified: ${alreadyClassified.length}, Needs: ${needsClassify.length}`);

  // Classify
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });

  const classifyBudget = opts.timeBudgetMs
    ? Math.max(0, opts.timeBudgetMs - (Date.now() - startTime) - 30_000) // Reserve 30s for chunk+match
    : undefined;

  const { apiCalls, errors: classErrors } = await classifySegments(
    client,
    segments,
    { ...opts, timeBudgetMs: classifyBudget },
  );

  const stoppedEarly = classifyBudget !== undefined && apiCalls < needsClassify.length && opts.apply;

  if (apiCalls > 0) {
    log(`Classification: ${apiCalls} calls, ${classErrors} errors, ~$${(apiCalls * 0.01).toFixed(2)}`);
  }

  if (opts.classifyOnly) {
    return {
      date,
      segments_total: segments.length,
      classified: apiCalls,
      classification_errors: classErrors,
      chunks_formed: 0,
      orphan_photos: 0,
      matched: 0,
      unmatched: 0,
      agreements: 0,
      disagreements: 0,
      match_results: [],
      elapsed_ms: Date.now() - startTime,
      stopped_early: stoppedEarly,
    };
  }

  // Don't chunk/match if we still have unclassified segments (incomplete)
  const remainingUnclassified = await queryOne<{ cnt: number }>(`
    SELECT COUNT(*)::int AS cnt
    FROM ops.evidence_stream_segments
    WHERE clinic_date = $1::DATE
      AND source_kind = 'request_media'
      AND segment_role IS NULL
  `, [date]);

  if ((remainingUnclassified?.cnt ?? 0) > 0 && stoppedEarly) {
    log(`${remainingUnclassified!.cnt} segments still unclassified — skipping chunk/match (will resume next tick).`);
    return {
      date,
      segments_total: segments.length,
      classified: apiCalls,
      classification_errors: classErrors,
      chunks_formed: 0,
      orphan_photos: 0,
      matched: 0,
      unmatched: 0,
      agreements: 0,
      disagreements: 0,
      match_results: [],
      elapsed_ms: Date.now() - startTime,
      stopped_early: true,
    };
  }

  // Chunk
  log(`\nChunking...`);
  const { chunks, orphanCount } = await chunkSegments(date, opts);

  // Match
  log(`\nMatching...`);
  const matchResult = await matchChunks(date, opts);

  const agreements = matchResult.results.filter((r) => r.agreement === "AGREE").length;
  const disagreements = matchResult.results.filter((r) => r.agreement === "DISAGREE").length;

  // Run waiver cross-reference audit after matching
  let audit: AuditSummary | undefined;
  if (opts.apply && matchResult.matched > 0) {
    try {
      log(`\nRunning waiver audit...`);
      audit = await runWaiverAudit(date);
      log(`Audit: ${audit.critical} critical, ${audit.warning} warning, ${audit.info} info`);
    } catch (err) {
      log(`Audit failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    date,
    segments_total: segments.length,
    classified: apiCalls,
    classification_errors: classErrors,
    chunks_formed: chunks.length,
    orphan_photos: orphanCount,
    matched: matchResult.matched,
    unmatched: matchResult.unmatched,
    agreements,
    disagreements,
    match_results: matchResult.results,
    elapsed_ms: Date.now() - startTime,
    stopped_early: stoppedEarly,
    audit,
  };
}

// ── Find dates with pending work ────────────────────────────

/**
 * Find clinic dates that have evidence segments needing processing.
 * Returns dates with unclassified photos or unchunked/unmatched segments.
 */
export async function findPendingDates(limit = 2): Promise<string[]> {
  const rows = await queryRows<{ clinic_date: string }>(`
    SELECT DISTINCT clinic_date::text
    FROM ops.evidence_stream_segments
    WHERE source_kind = 'request_media'
      AND (
        segment_role IS NULL                              -- unclassified
        OR (segment_role != 'discard'
            AND chunk_id IS NULL
            AND assignment_status NOT IN ('assigned', 'rejected'))  -- unchunked
        OR (chunk_id IS NOT NULL
            AND matched_cat_id IS NULL
            AND assignment_status NOT IN ('assigned', 'rejected', 'ambiguous'))  -- unmatched
      )
    ORDER BY clinic_date DESC
    LIMIT $1
  `, [limit]);

  return rows.map((r) => r.clinic_date);
}
